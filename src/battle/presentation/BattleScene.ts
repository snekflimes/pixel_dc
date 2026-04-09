import Phaser from 'phaser'
import type { Ability, AbilityId, BattleEvent, BattleSnapshot, MissionConfig, UnitId, UnitInstance } from '../engine/types'
import { BattleEngine } from '../engine/BattleEngine'
import { DEMO_MISSIONS_MODES, getAbilitiesRegistry, getMissionConfig } from '../data/demoMissions'

/** Слои: фон и декор не перехватывают клики; интерактив только сверху. */
const DEPTH_BG = 0
const DEPTH_SCHEMATIC = 5
const DEPTH_DECOR = 8
const DEPTH_HUD = 20
const DEPTH_TOKEN = 100
const DEPTH_UI = 250
const DEPTH_OVERLAY = 500

type Token = {
  root: Phaser.GameObjects.Container
  body: Phaser.GameObjects.Arc
  name: Phaser.GameObjects.Text
  hpBg: Phaser.GameObjects.Graphics
  hpFill: Phaser.GameObjects.Graphics
  selectedRing: Phaser.GameObjects.Graphics
  hit: Phaser.GameObjects.Rectangle
  unitId: UnitId
}

type Button = {
  root: Phaser.GameObjects.Container
  rect: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
  abilityId?: AbilityId
  /** false = слот не даёт категорию; кнопка серая */
  abilityUsable?: boolean
  denyReason?: string
  visualWidth: number
  visualHeight: number
}

/**
 * ТЗ: «друг за другом» — цепочка в глубину к центру поля (не столбик!).
 * Игрок слева: p1 тыл (дальше от боя), p2 середина, p3 передовой (ближе к центру) — один Y, разный X.
 * Враг справа зеркально: e1 тыл у правого края, e3 передовой ближе к центру.
 */
function getBattleLayout(w: number, h: number): {
  midY: number
  playerPos: (slotIndex: number) => { x: number; y: number }
  enemyPos: (slotIndex: number) => { x: number; y: number }
  e4: { x: number; y: number }
  /** Кто ближе к центру — рисуется поверх (перекрывает стоящих сзади). */
  lineDepthBoost: (slotIndex: number) => number
} {
  const midY = h * 0.48
  const clampI = (i: number) => Math.min(2, Math.max(0, i))
  const px: [number, number, number] = [w * 0.09, w * 0.18, w * 0.29]
  const ex: [number, number, number] = [w * 0.91, w * 0.82, w * 0.71]
  return {
    midY,
    playerPos: (i) => ({ x: px[clampI(i)], y: midY }),
    enemyPos: (i) => ({ x: ex[clampI(i)], y: midY }),
    e4: { x: w * 0.5, y: h * 0.22 },
    lineDepthBoost: (i) => clampI(i),
  }
}

function makeText(scene: Phaser.Scene, text: string, x: number, y: number, style?: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: 'system-ui, Segoe UI, Roboto, Arial',
    fontSize: '14px',
    color: '#e9e9ff',
    stroke: '#000000',
    strokeThickness: 4,
    ...style,
  })
}

function makeButton(
  scene: Phaser.Scene,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  depth = DEPTH_UI,
): Button {
  const root = scene.add.container(x, y)
  root.setDepth(depth)

  const rect = scene.add.rectangle(0, 0, width, height, 0x9b5cff, 1)
  rect.setStrokeStyle(2, 0xffffff, 0.45)
  rect.setInteractive({ useHandCursor: true })

  const labelObj = scene.add.text(0, 0, label, {
    fontFamily: 'system-ui, Segoe UI, Roboto, Arial',
    fontSize: '16px',
    color: '#0b0b12',
  })
  labelObj.setOrigin(0.5)

  root.add([rect, labelObj])
  return { root, rect, label: labelObj, abilityId: undefined, visualWidth: width, visualHeight: height }
}

function setButtonGlow(btn: Button, on: boolean): void {
  if (!on) {
    btn.rect.setFillStyle(0x9b5cff, 1)
    btn.rect.setStrokeStyle(2, 0xffffff, 0.45)
    return
  }
  btn.rect.setFillStyle(0xc6ff3a, 1)
  btn.rect.setStrokeStyle(3, 0xffef7a, 0.95)
}

function formatAbilityEffectHint(ability: Ability): string {
  const e = ability.effect
  switch (e.type) {
    case 'damage':
      return `Урон ${e.min}–${e.max}`
    case 'healPercent':
      return `Лечение ${Math.round(e.percent * 100)}% от max HP`
    case 'applyShieldPercent':
      return `Щит ${Math.round(e.percent * 100)}% от max HP`
    case 'applyPoison': {
      const ini = e.initialDamage ? ` + удар ${e.initialDamage.min}–${e.initialDamage.max}` : ''
      return `Яд ${e.dotPerTurn}/ход, ${e.turns} х.${ini}`
    }
    case 'ultimateDamage':
      return `Урон по всем врагам: сумма ${e.minTotal}–${e.maxTotal}`
    default: {
      const _x: never = e
      return _x
    }
  }
}

/** Доступная кнопка: обычный вид + подсветка выбора. Недоступная: серая, без клика. */
function setAbilityButtonVisual(btn: Button, opts: { usable: boolean; selected: boolean }): void {
  if (!opts.usable) {
    btn.root.setAlpha(0.5)
    btn.rect.setFillStyle(0x3a3a48, 1)
    btn.rect.setStrokeStyle(1, 0x5a5a70, 0.45)
    btn.label.setStyle({ color: '#9a9ab0' })
    if (btn.rect.input) btn.rect.input.cursor = 'default'
    return
  }
  btn.root.setAlpha(1)
  btn.rect.setInteractive({ useHandCursor: true })
  btn.label.setStyle({ color: '#0b0b12' })
  setButtonGlow(btn, opts.selected)
  if (btn.rect.input) btn.rect.input.cursor = 'pointer'
}

export class BattleScene extends Phaser.Scene {
  private engine: BattleEngine | null = null
  private abilities: Record<AbilityId, Ability> | null = null
  private snapshot: BattleSnapshot | null = null

  private mode: MissionConfig['mode'] = '3v3'

  private tokenByUnitId: Partial<Record<UnitId, Token>> = {}

  private currentSelectedAbilityId: AbilityId | null = null
  private currentSelectedTargetId: UnitId | null = null

  // UI elements.
  private abilityButtons: Button[] = []
  private moveLeftBtn: Button | null = null
  private moveRightBtn: Button | null = null
  private surrenderBtn: Button | null = null

  private titleText!: Phaser.GameObjects.Text
  private queueText!: Phaser.GameObjects.Text
  private actorInfoText!: Phaser.GameObjects.Text

  private centralBg!: Phaser.GameObjects.Graphics
  private centralName!: Phaser.GameObjects.Text
  private centralHp!: Phaser.GameObjects.Text

  private selectedTargetRing: Phaser.GameObjects.Graphics | null = null

  /** Один слой на конец боя — иначе каждый вызов создавал новые Graphics/Text (утечка). */
  private battleEndRoot: Phaser.GameObjects.Container | null = null

  /** Блокирует параллельные ходы от спама кликов (стек таймеров delayedCall + лишняя перерисовка). */
  private playerActionLocked = false

  private battleLogText!: Phaser.GameObjects.Text
  private readonly battleLogMaxLines = 10
  private battleLogLines: string[] = []

  private unitTooltipRoot: Phaser.GameObjects.Container | null = null
  private unitTooltipText: Phaser.GameObjects.Text | null = null
  private unitTooltipBg: Phaser.GameObjects.Graphics | null = null

  /** Полное название способности при наведении на кнопку (ТЗ: имена из данных). */
  private abilityCaptionText: Phaser.GameObjects.Text | null = null

  constructor() {
    super('BattleScene')
  }

  create(): void {
    if (this.input) {
      this.input.setTopOnly(true)
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.time.removeAllEvents()
      this.tweens.killAll()
      this.clearTokens()
      this.clearTurnUi()
      this.clearBattleEndUi()
    })

    const abilities = getAbilitiesRegistry()
    this.abilities = abilities
    this.engine = new BattleEngine({ abilities })

    this.createBackground()
    this.createTopHud()
    this.showModeSelect()
  }

  private createBackground(): void {
    const g = this.add.graphics()
    g.setDepth(DEPTH_BG)
    const w = this.scale.gameSize.width
    const h = this.scale.gameSize.height

    // Планы по ТЗ: левая половина — отряд игрока, правая — противник, центр — служебная зона.
    const splitL = w * 0.36
    const splitR = w * 0.64
    g.fillStyle(0x1a3a6e, 0.35)
    g.fillRect(0, 0, splitL, h)
    g.fillStyle(0x6e1a4a, 0.32)
    g.fillRect(splitR, 0, w - splitR, h)
    g.fillStyle(0x161620, 0.5)
    g.fillRect(splitL, 0, splitR - splitL, h)

    this.drawBattleSchematic(w, h)

    makeText(this, 'Игрок: p1→p2→p3 в глубину к центру', splitL * 0.5, h * 0.08, { fontSize: '12px', color: '#b8d4ff' }).setOrigin(0.5, 0.5).setDepth(DEPTH_DECOR)
    makeText(this, 'Враг: e1→e2→e3 в глубину к центру', splitR + (w - splitR) * 0.5, h * 0.08, { fontSize: '12px', color: '#ffb8d4' }).setOrigin(0.5, 0.5).setDepth(DEPTH_DECOR)

    this.centralBg = this.add.graphics()
    this.centralBg.setDepth(DEPTH_DECOR)
    const cx = w / 2
    const cy = h * 0.5
    this.centralBg.fillStyle(0x16171f, 0.65)
    this.centralBg.fillRoundedRect(cx - 155, cy - 90, 310, 180, 26)
    this.centralBg.lineStyle(2, 0x9b5cff, 0.6)
    this.centralBg.strokeRoundedRect(cx - 155, cy - 90, 310, 180, 26)

    this.centralName = makeText(this, '—', cx, cy - 20, { fontSize: '18px' })
    this.centralName.setOrigin(0.5)
    this.centralName.setDepth(DEPTH_DECOR + 1)
    this.centralHp = makeText(this, 'HP —', cx, cy + 20, { fontSize: '16px' })
    this.centralHp.setOrigin(0.5)
    this.centralHp.setDepth(DEPTH_DECOR + 1)

    this.battleLogText = makeText(this, '', cx, cy + 98, {
      fontSize: '11px',
      color: '#aeb8e8',
      align: 'center',
      wordWrap: { width: 300 },
    })
    this.battleLogText.setOrigin(0.5, 0)
    this.battleLogText.setDepth(DEPTH_DECOR + 1)
    this.battleLogText.setAlpha(0.92)
  }

  /** Рамки слотов: цепочки вдоль X (в глубину), не вертикальный столбик. */
  private drawBattleSchematic(w: number, h: number): void {
    const layout = getBattleLayout(w, h)
    const frame = this.add.graphics()
    frame.setDepth(DEPTH_SCHEMATIC)
    frame.lineStyle(2, 0xffffff, 0.2)

    const splitL = w * 0.36
    const splitR = w * 0.64
    frame.strokeLineShape(new Phaser.Geom.Line(splitL, 0, splitL, h))
    frame.strokeLineShape(new Phaser.Geom.Line(splitR, 0, splitR, h))

    frame.lineStyle(1, 0xffffff, 0.12)
    frame.strokeLineShape(new Phaser.Geom.Line(w * 0.06, layout.midY, w * 0.34, layout.midY))
    frame.strokeLineShape(new Phaser.Geom.Line(w * 0.66, layout.midY, w * 0.94, layout.midY))
    makeText(this, '← тыл … передовой →', w * 0.2, layout.midY - 62, { fontSize: '10px', color: '#7a9dcc' }).setOrigin(0.5, 0.5).setDepth(DEPTH_SCHEMATIC + 1)
    makeText(this, '← передовой … тыл →', w * 0.8, layout.midY - 62, { fontSize: '10px', color: '#cc7a9d' }).setOrigin(0.5, 0.5).setDepth(DEPTH_SCHEMATIC + 1)

    frame.fillStyle(0x000000, 0.35)
    frame.fillRoundedRect(splitL + 8, 10, splitR - splitL - 16, 28, 8)
    makeText(this, 'Очередь хода', w / 2, 24, { fontSize: '12px', color: '#b8c4ff' }).setOrigin(0.5).setDepth(DEPTH_SCHEMATIC + 1)

    const slotW = 88
    const slotH = 100
    const plabels = ['p1 тыл', 'p2', 'p3 перед']
    const elabels = ['e1 тыл', 'e2', 'e3 перед']
    for (let i = 0; i < 3; i++) {
      const pp = layout.playerPos(i)
      frame.strokeRoundedRect(pp.x - slotW / 2, pp.y - slotH / 2, slotW, slotH, 10)
      makeText(this, plabels[i], pp.x, pp.y - slotH / 2 - 8, { fontSize: '10px', color: '#9ec5ff' }).setOrigin(0.5, 1).setDepth(DEPTH_SCHEMATIC + 1)

      const ep = layout.enemyPos(i)
      frame.strokeRoundedRect(ep.x - slotW / 2, ep.y - slotH / 2, slotW, slotH, 10)
      makeText(this, elabels[i], ep.x, ep.y - slotH / 2 - 8, { fontSize: '10px', color: '#ffaac8' }).setOrigin(0.5, 1).setDepth(DEPTH_SCHEMATIC + 1)
    }

    const e4x = layout.e4.x
    const e4y = layout.e4.y
    frame.strokeRoundedRect(e4x - 72, e4y - 50, 144, 100, 12)
    makeText(this, 'e4 босс/толпа', e4x, e4y - 58, { fontSize: '10px', color: '#c8d0ff' }).setOrigin(0.5, 1).setDepth(DEPTH_SCHEMATIC + 1)

    makeText(this, 'Центр: ход / характеристики', w / 2, layout.midY + 86, { fontSize: '10px', color: '#9aa6ff' }).setOrigin(0.5).setDepth(DEPTH_SCHEMATIC + 1)
  }

  private createTopHud(): void {
    const w = this.scale.gameSize.width
    this.titleText = makeText(this, 'Twilight Wars — Battle MVP', w / 2, 20, { fontSize: '18px', color: '#ffffff' })
    this.titleText.setOrigin(0.5)
    this.titleText.setDepth(DEPTH_HUD)
    this.queueText = makeText(this, '', w / 2, 44, { fontSize: '14px', color: '#d9e1ff' })
    this.queueText.setOrigin(0.5)
    this.queueText.setDepth(DEPTH_HUD)
    this.actorInfoText = makeText(this, '', w / 2, 64, { fontSize: '14px', color: '#d9e1ff' })
    this.actorInfoText.setOrigin(0.5)
    this.actorInfoText.setDepth(DEPTH_HUD)
  }

  private showModeSelect(): void {
    // Simple mode buttons.
    const w = this.scale.gameSize.width
    const h = this.scale.gameSize.height
    const labels: Record<typeof this.mode, string> = {
      '3v3': 'Миссия: 3v3',
      '2v3gg': 'Миссия: 2v3 + ГГ',
      'bossSlot4': 'Миссия: Босс',
      'crowdSlot4': 'Миссия: Толпа',
    }

    const startY = h * 0.26
    let x = w / 2
    const buttons: Button[] = []
    const modes = DEMO_MISSIONS_MODES
    const cols = 2
    const cellW = w / cols
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i]
      const col = i % cols
      const row = Math.floor(i / cols)
      x = col * cellW + cellW / 2
      const y = startY + row * 70
      const btn = makeButton(this, labels[m], x, y, 240, 46)
      btn.rect.on('pointerdown', () => {
        this.mode = m
        // Visual feedback: rebuild selection quickly.
        for (const b of buttons) setButtonGlow(b, b === btn)
      })
      buttons.push(btn)
    }

    // Start button
    const startBtn = makeButton(this, 'Начать миссию', w / 2, h * 0.62, 280, 52)
    startBtn.rect.on('pointerdown', () => {
      this.startBattle()
      // Remove mode buttons.
      for (const b of buttons) b.root.destroy(true)
      startBtn.root.destroy(true)
    })
    // Default highlight.
    setButtonGlow(buttons[0] as Button, true)
  }

  private startBattle(): void {
    if (!this.engine) return
    this.playerActionLocked = false
    this.clearBattleEndUi()
    this.clearBattleLog()
    const mission = getMissionConfig(this.mode)
    this.engine.start(mission)
    this.snapshot = this.engine.getSnapshot()
    this.clearTokens()
    this.createBattleTokens()
    this.updateHudFromSnapshot()
    this.preparePlayerTurnIfNeeded().catch(() => undefined)
  }

  private clearTokens(): void {
    for (const t of Object.values(this.tokenByUnitId)) {
      if (t) t.root.destroy(true)
    }
    this.tokenByUnitId = {}
  }

  private createBattleTokens(): void {
    if (!this.snapshot) return
    const w = this.scale.gameSize.width
    const h = this.scale.gameSize.height
    const layout = getBattleLayout(w, h)

    const unitList = Object.values(this.snapshot.units).filter((u) => u.hp > 0)
    for (const u of unitList) {
      const isPlayer = u.slot === 'p1' || u.slot === 'p2' || u.slot === 'p3'
      const isSlot4 = u.slot === 'e4'
      const idx = Number(u.slot[1]) - 1
      const pos = isSlot4
        ? layout.e4
        : isPlayer
          ? layout.playerPos(idx)
          : layout.enemyPos(idx)

      const lineBoost = isSlot4 ? 2 : layout.lineDepthBoost(idx)
      this.tokenByUnitId[u.instanceId] = this.createToken(u, pos.x, pos.y, isSlot4, lineBoost)
      if (!u.enabled) this.tokenByUnitId[u.instanceId]?.root.setVisible(false)
    }

  }

  private createToken(u: UnitInstance, x: number, y: number, isSlot4: boolean, lineDepthBoost: number): Token {
    const root = this.add.container(x, y)
    // Передовая линия рисуется поверх задней (как «ближе к камере»).
    root.setDepth(DEPTH_TOKEN + lineDepthBoost * 3)

    const radius = isSlot4 ? 52 : 42
    const fill = u.side === 'player' ? 0xff3b86 : 0x7c4dff
    const body = this.add.circle(0, 0, radius, fill, 1)
    body.setStrokeStyle(3, 0xffffff, 0.4)

    const selectedRing = this.add.graphics()
    selectedRing.lineStyle(5, 0xc6ff3a, 0.9)
    selectedRing.strokeCircle(0, 0, radius + 6)
    selectedRing.setVisible(false)

    const name = this.add.text(0, radius + 14, u.name, {
      fontFamily: 'system-ui, Segoe UI, Roboto, Arial',
      fontSize: isSlot4 ? '15px' : '12px',
      color: '#f1f2ff',
      stroke: '#000000',
      strokeThickness: 3,
      align: 'center',
    })
    name.setOrigin(0.5, 0)

    const hpBg = this.add.graphics()
    const barW = isSlot4 ? 140 : 110
    hpBg.fillStyle(0x0b0b12, 0.7)
    hpBg.fillRoundedRect(-barW / 2, radius + 34, barW, 10, 6)
    const hpFill = this.add.graphics()
    hpFill.fillStyle(0xc6ff3a, 1)
    hpFill.fillRoundedRect(-barW / 2, radius + 34, barW, 10, 6)

    // Прозрачная hit-пластина сверху стека — клики не перехватываются графикой под ней.
    const hitW = barW + 56
    const hitH = radius * 2 + 92
    const hit = this.add.rectangle(0, radius + 18, hitW, hitH, 0x000000, 0.003)
    hit.setInteractive({ useHandCursor: true })

    const token: Token = { root, body, name, hpBg, hpFill, selectedRing, hit, unitId: u.instanceId }
    root.add([body, selectedRing, hpBg, hpFill, name, hit])

    hit.on('pointerdown', () => {
      this.onTokenPointerDown(u.instanceId).catch(() => undefined)
    })
    hit.on('pointerover', () => {
      this.showUnitTooltip(u.instanceId)
    })
    hit.on('pointerout', () => {
      this.hideUnitTooltip()
    })

    // Initial hp.
    this.updateTokenHp(token, u)
    return token
  }

  private updateTokenHp(token: Token, u: UnitInstance): void {
    const isSlot4 = u.slot === 'e4'
    const barW = isSlot4 ? 140 : 110
    const hpPct = u.maxHp <= 0 ? 0 : u.hp / u.maxHp
    token.hpFill.clear()
    token.hpFill.fillStyle(0xc6ff3a, 1)
    const radius = isSlot4 ? 52 : 42
    const y = radius + 34
    token.hpFill.fillRoundedRect(-barW / 2, y, barW * clamp(hpPct, 0, 1), 10, 6)
    // Text update on target ring is handled elsewhere.
  }

  private updateHudFromSnapshot(): void {
    if (!this.snapshot || !this.engine) return
    this.queueText.setText(`Очередь: ${this.snapshot.turnOrder.slice(0, 6).join(' → ')}`)
    const actor = this.snapshot.actorId ? this.snapshot.units[this.snapshot.actorId] : undefined
    this.actorInfoText.setText(actor ? `Ход: ${actor.name}` : '')
    if (actor) {
      this.centralName.setText(actor.name)
      this.centralHp.setText(`HP ${actor.hp}/${actor.maxHp}`)
    }
  }

  private async preparePlayerTurnIfNeeded(): Promise<void> {
    if (!this.engine) return
    if (!this.snapshot) this.snapshot = this.engine.getSnapshot()
    this.clearTurnUi()
    while (this.snapshot && this.snapshot.phase !== 'ended' && this.snapshot.actorId) {
      if (this.snapshot.phase === 'player') {
        this.renderPlayerTurnUi()
        return
      }

      if (this.snapshot.phase === 'enemy') {
        await this.performEnemyTurnOnce()
      } else {
        return
      }
    }
  }

  private clearTurnUi(): void {
    for (const btn of this.abilityButtons) btn.root.destroy(true)
    this.abilityButtons = []
    if (this.moveLeftBtn) this.moveLeftBtn.root.destroy(true)
    if (this.moveRightBtn) this.moveRightBtn.root.destroy(true)
    if (this.surrenderBtn) this.surrenderBtn.root.destroy(true)
    this.moveLeftBtn = null
    this.moveRightBtn = null
    this.surrenderBtn = null
    if (this.selectedTargetRing) this.selectedTargetRing.destroy()
    this.selectedTargetRing = null
    this.currentSelectedAbilityId = null
    this.currentSelectedTargetId = null
    this.abilityCaptionText?.setText('')
  }

  private renderPlayerTurnUi(): void {
    if (!this.snapshot || !this.engine) return
    const actorId = this.snapshot.actorId
    if (!actorId) return

    const actor = this.snapshot.units[actorId]
    if (actor.side !== 'player') return

    const buttons = this.buildAbilityButtons(actorId)

    // Bottom UI layout: 2 distinct rows to avoid overlap on FIT scaling.
    const w = this.scale.gameSize.width
    const h = this.scale.gameSize.height
    const bottomPad = Math.max(24, Math.round(h * 0.03))
    const actionRowY = h - bottomPad - 24
    const abilityRowY = actionRowY - 62

    // Reposition ability buttons to the upper row.
    for (const btn of buttons) btn.root.setY(abilityRowY)

    if (!this.abilityCaptionText) {
      this.abilityCaptionText = makeText(this, '', w / 2, abilityRowY + 52, {
        fontSize: '12px',
        color: '#b8c8ff',
        align: 'center',
        wordWrap: { width: Math.min(420, w - 40) },
      })
      this.abilityCaptionText.setOrigin(0.5)
      this.abilityCaptionText.setDepth(DEPTH_UI + 1)
    } else {
      this.abilityCaptionText.setY(abilityRowY + 52)
      this.abilityCaptionText.setText('')
    }

    const moves = this.engine.getAvailableMovesForPlayerActor(actorId)
    if (moves.canLeft) this.moveLeftBtn = makeButton(this, 'Влево', w * 0.54, actionRowY, 140, 44)
    if (moves.canRight) this.moveRightBtn = makeButton(this, 'Вправо', w * 0.70, actionRowY, 160, 44)
    if (this.moveLeftBtn) {
      this.moveLeftBtn.rect.on('pointerdown', () => {
        this.onMove('left').catch(() => undefined)
      })
    }
    if (this.moveRightBtn) {
      this.moveRightBtn.rect.on('pointerdown', () => {
        this.onMove('right').catch(() => undefined)
      })
    }

    this.surrenderBtn = makeButton(this, 'Покинуть бой', w * 0.20, actionRowY, 180, 44)
    this.surrenderBtn.rect.on('pointerdown', () => {
      this.onSurrender().catch(() => undefined)
    })

    // Auto-target/auto-action highlight.
    const auto = this.engine.computeAutoSelectionForPlayerTurn()
    if (auto) {
      this.currentSelectedAbilityId = auto.abilityId
      this.currentSelectedTargetId = auto.targetId
      this.highlightSelected(buttons, auto.abilityId, auto.targetId)
    }
  }

  private buildAbilityButtons(actorId: UnitId): Button[] {
    const actor = this.snapshot!.units[actorId]
    const abilityIds = [...actor.abilities]
    const w = this.scale.gameSize.width
    const y = this.scale.gameSize.height * 0.80
    const n = abilityIds.length
    const spacing = n <= 1 ? 0 : Math.min(168, Math.floor((w * 0.7) / Math.max(1, n - 1)))
    const startX = w / 2 - ((n - 1) * spacing) / 2

    const btns: Button[] = []
    for (let i = 0; i < n; i++) {
      const abilityId = abilityIds[i]
      const ability = this.abilities![abilityId]
      const label = ability.category === 'support' ? 'Поддержка' :
        ability.category === 'defense' ? 'Защита' :
          ability.category === 'ultimate' ? 'Ультимейт' :
            ability.category === 'attack' ? 'Атака' :
              ability.name

      const btn = makeButton(this, label, startX + i * spacing, y, 152, 48)
      btn.abilityId = abilityId
      const deny = this.engine!.getAbilityDenyReason(actorId, abilityId)
      const usable = deny === null
      btn.abilityUsable = usable
      btn.denyReason = deny ?? undefined

      const hint = formatAbilityEffectHint(ability)
      btn.rect.on('pointerdown', () => {
        if (!usable) return
        this.onAbilityButtonPressed(abilityId).catch(() => undefined)
      })
      btn.rect.on('pointerover', () => {
        if (usable) this.abilityCaptionText?.setText(`${ability.name}\n${hint}`)
        else this.abilityCaptionText?.setText(`${ability.name}\n⚠ ${deny}\n${hint}`)
      })
      btn.rect.on('pointerout', () => {
        this.abilityCaptionText?.setText('')
      })

      setAbilityButtonVisual(btn, { usable, selected: false })
      this.abilityButtons.push(btn)
      btns.push(btn)
    }

    return btns
  }

  private highlightSelected(abilityButtons: Button[], abilityId: AbilityId, targetId: UnitId): void {
    for (const btn of abilityButtons) {
      if (!btn.abilityId) continue
      const usable = btn.abilityUsable !== false
      if (!usable) {
        setAbilityButtonVisual(btn, { usable: false, selected: false })
        continue
      }
      setAbilityButtonVisual(btn, { usable: true, selected: btn.abilityId === abilityId })
    }
    this.updateTargetHighlight(targetId)
  }

  private updateTargetHighlight(targetId: UnitId): void {
    if (this.selectedTargetRing) this.selectedTargetRing.setVisible(false)
    const token = this.tokenByUnitId[targetId]
    if (!token) return

    token.selectedRing.setVisible(true)
    // Ensure others hide.
    for (const t of Object.values(this.tokenByUnitId)) {
      if (t && t.unitId !== targetId) t.selectedRing.setVisible(false)
    }
    this.selectedTargetRing = token.selectedRing
  }

  private async onAbilityButtonPressed(abilityId: AbilityId): Promise<void> {
    if (this.playerActionLocked) return
    if (!this.engine || !this.snapshot || !this.snapshot.actorId) return
    if (this.snapshot.phase !== 'player') return
    const actorId = this.snapshot.actorId

    if (this.engine.getAbilityDenyReason(actorId, abilityId)) return

    // Одно нажатие = применить способность (цель: выбранный токен или авто по ТЗ).
    const targetId = this.resolveAbilityTarget(abilityId, actorId)
    if (!targetId) return

    this.playerActionLocked = true
    try {
      this.currentSelectedAbilityId = abilityId
      this.currentSelectedTargetId = targetId
      this.highlightSelected(this.abilityButtons, abilityId, targetId)

      const ev = this.engine.takeAction({
        kind: 'ability',
        abilityId,
        targetId,
      })
      this.snapshot = this.engine.getSnapshot()
      await this.playBattleEvents(ev)
      await this.preparePlayerTurnIfNeeded()
    } finally {
      this.playerActionLocked = false
    }
  }

  /** Ручной клик по токену + авто-таргет, если ручная цель не подходит. */
  private resolveAbilityTarget(abilityId: AbilityId, actorId: UnitId): UnitId | undefined {
    if (!this.engine || !this.snapshot || !this.abilities) return undefined
    const ability = this.abilities[abilityId]
    const manual = this.currentSelectedTargetId
    const uManual = manual ? this.snapshot.units[manual] : undefined

    if (manual && uManual && uManual.hp > 0 && uManual.enabled) {
      if (ability.targeting.mode === 'singleEnemy' && uManual.side === 'enemy') return manual
      if (ability.targeting.mode === 'singleAlly' && uManual.side === 'player') return manual
    }
    return this.engine.computeAutoTargetForAbilityId(abilityId, actorId)
  }

  private async onTokenPointerDown(unitId: UnitId): Promise<void> {
    if (this.playerActionLocked) return
    if (!this.engine || !this.snapshot || this.snapshot.phase !== 'player') return
    if (!this.tokenByUnitId[unitId]) return
    const snapUnit = this.snapshot.units[unitId]
    if (!snapUnit || snapUnit.hp <= 0) return

    const actor = this.snapshot.actorId ? this.snapshot.units[this.snapshot.actorId] : undefined
    if (!actor) return

    // Смена цели до нажатия способности: подсветка по любому живому юниту.
    const abilityId = this.currentSelectedAbilityId ?? this.engine.computeAutoSelectionForPlayerTurn()?.abilityId
    if (!abilityId) {
      this.currentSelectedTargetId = unitId
      this.updateTargetHighlight(unitId)
      return
    }
    const ability = this.abilities![abilityId]
    const canSelect =
      ability.targeting.mode === 'singleEnemy'
        ? snapUnit.side === 'enemy' && snapUnit.enabled
        : ability.targeting.mode === 'singleAlly'
          ? snapUnit.side === 'player' && snapUnit.enabled
          : ability.targeting.mode === 'allEnemies'
            ? snapUnit.side === 'enemy' && snapUnit.hp > 0
            : false

    if (!canSelect) return

    this.currentSelectedTargetId = unitId
    this.updateTargetHighlight(unitId)
  }

  private async onMove(direction: 'left' | 'right'): Promise<void> {
    if (this.playerActionLocked) return
    if (!this.engine || !this.snapshot || this.snapshot.phase !== 'player' || !this.snapshot.actorId) return
    this.playerActionLocked = true
    try {
      const ev = this.engine.takeAction({ kind: 'move', direction })
      this.snapshot = this.engine.getSnapshot()
      await this.playBattleEvents(ev)
      await this.preparePlayerTurnIfNeeded()
    } finally {
      this.playerActionLocked = false
    }
  }

  private async onSurrender(): Promise<void> {
    if (this.playerActionLocked) return
    if (!this.engine) return
    this.playerActionLocked = true
    try {
      const ev = this.engine.takeAction({ kind: 'surrender' })
      this.snapshot = this.engine.getSnapshot()
      await this.playBattleEvents(ev)
    } finally {
      this.playerActionLocked = false
    }
  }

  private async performEnemyTurnOnce(): Promise<void> {
    if (!this.engine || !this.snapshot || !this.snapshot.actorId) return
    const actorId = this.snapshot.actorId
    const action = this.engine.chooseEnemyAction(actorId)
    if (!action) {
      console.warn('[BattleScene] chooseEnemyAction returned null — пропуск хода')
      const ev = this.engine.skipCurrentActorTurn()
      this.snapshot = this.engine.getSnapshot()
      await this.playBattleEvents(ev)
      return
    }
    const ev = this.engine.takeAction(action)
    this.snapshot = this.engine.getSnapshot()
    await this.playBattleEvents(ev)
  }

  private async playBattleEvents(ev: BattleEvent[]): Promise<void> {
    for (const e of ev) {
      if (e.kind === 'battleEnded') {
        this.clearTurnUi()
        const endLine = this.formatBattleLogLine(e)
        if (endLine) this.pushBattleLog(endLine)
        this.renderBattleEndedIfNeeded()
        continue
      }
      const line = this.formatBattleLogLine(e)
      if (line) this.pushBattleLog(line)
      await this.flashEvent(e)
      this.refreshTokenVisuals()
    }
    this.refreshTokenVisuals()
    this.updateHudFromSnapshot()
  }

  private refreshTokenVisuals(): void {
    if (!this.snapshot) return
    const w = this.scale.gameSize.width
    const h = this.scale.gameSize.height
    const layout = getBattleLayout(w, h)
    // Hide tokens whose unit died or became disabled (crowd).
    for (const token of Object.values(this.tokenByUnitId)) {
      if (!token) continue
      const u = this.snapshot.units[token.unitId]
      if (!u || u.hp <= 0 || !u.enabled) {
        token.root.setVisible(false)
        token.selectedRing.setVisible(false)
        continue
      }
      token.root.setVisible(true)
      const isPlayer = u.slot === 'p1' || u.slot === 'p2' || u.slot === 'p3'
      const isSlot4 = u.slot === 'e4'
      const idx = Number(u.slot[1]) - 1
      const pos = isSlot4 ? layout.e4 : isPlayer ? layout.playerPos(idx) : layout.enemyPos(idx)
      token.root.setPosition(pos.x, pos.y)
      const lineBoost = isSlot4 ? 2 : layout.lineDepthBoost(Math.min(2, Math.max(0, idx)))
      token.root.setDepth(DEPTH_TOKEN + lineBoost * 3)
      this.updateTokenHp(token, u)
    }
    // HUD обновляем один раз в конце playBattleEvents — меньше лишних перерисовок текста.
  }

  private async flashEvent(e: BattleEvent): Promise<void> {
    if (e.kind === 'damage') {
      this.spawnDamageNumber(e.targetId, e.amount)
      const token = this.tokenByUnitId[e.targetId]
      if (token) {
        token.root.setScale(1.05)
        await this.sleep(80)
        token.root.setScale(1)
      }
      return
    }
    if (e.kind === 'heal') {
      this.spawnHealNumber(e.targetId, e.amount)
      const token = this.tokenByUnitId[e.targetId]
      if (token) {
        token.root.setScale(1.03)
        await this.sleep(70)
        token.root.setScale(1)
      }
      return
    }
    if (e.kind === 'shield') {
      this.spawnShieldNumber(e.targetId, e.shieldHp)
      const token = this.tokenByUnitId[e.targetId]
      if (token) {
        token.root.setAlpha(0.95)
        await this.sleep(60)
        token.root.setAlpha(1)
      }
      return
    }
    if (e.kind === 'poison') {
      const token = this.tokenByUnitId[e.targetId]
      if (token) {
        token.root.setScale(1.04)
        token.root.setAlpha(0.92)
        await this.sleep(80)
        token.root.setScale(1)
        token.root.setAlpha(1)
      }
      return
    }
    if (e.kind === 'poisonTick') {
      const token = this.tokenByUnitId[e.targetId]
      if (token) {
        token.root.setScale(1.06)
        await this.sleep(70)
        token.root.setScale(1)
      }
      return
    }
    if (e.kind === 'death') {
      const token = this.tokenByUnitId[e.unitId]
      if (token) token.root.setVisible(false)
      await this.sleep(120)
      return
    }
    if (e.kind === 'crowdReplace') {
      // Re-create token visibility will happen in refreshTokenVisuals.
      await this.sleep(120)
      return
    }
    if (e.kind === 'turnChanged') {
      await this.sleep(40)
      return
    }
    await this.sleep(20)
  }

  private clearBattleEndUi(): void {
    if (this.battleEndRoot) {
      this.battleEndRoot.destroy(true)
      this.battleEndRoot = null
    }
  }

  private renderBattleEndedIfNeeded(): void {
    if (!this.snapshot) return
    if (this.snapshot.phase !== 'ended' || !this.snapshot.result) return
    if (this.battleEndRoot) return

    const res = this.snapshot.result
    const w = this.scale.gameSize.width
    const h = this.scale.gameSize.height
    const txt = res === 'win' ? 'Победа!' : res === 'surrender' ? 'Вы отступили' : 'Поражение!'

    const root = this.add.container(0, 0)
    root.setDepth(DEPTH_OVERLAY)

    const overlay = this.add.graphics()
    overlay.fillStyle(0x000000, 0.55)
    overlay.fillRect(0, 0, w, h)

    const label = makeText(this, txt, w / 2, h / 2, { fontSize: '30px', color: '#ffffff' })
    label.setOrigin(0.5)
    const hint = makeText(this, 'Можно вернуться к выбору миссии без перезагрузки.', w / 2, h / 2 + 36, { fontSize: '13px', color: '#d9e1ff' })
    hint.setOrigin(0.5)

    const restartBtn = makeButton(this, 'К выбору миссии', w / 2, h / 2 + 82, 268, 48)
    restartBtn.root.setDepth(DEPTH_OVERLAY + 5)
    restartBtn.rect.on('pointerdown', () => {
      this.returnToMissionMenu()
    })

    root.add([overlay, label, hint, restartBtn.root])
    this.battleEndRoot = root
  }

  private returnToMissionMenu(): void {
    this.hideUnitTooltip()
    this.clearBattleEndUi()
    this.clearTurnUi()
    this.clearTokens()
    this.tokenByUnitId = {}
    this.snapshot = null
    this.playerActionLocked = false
    const abilities = getAbilitiesRegistry()
    this.abilities = abilities
    this.engine = new BattleEngine({ abilities })
    this.centralName.setText('—')
    this.centralHp.setText('HP —')
    this.queueText.setText('')
    this.actorInfoText.setText('')
    this.clearBattleLog()
    this.showModeSelect()
  }

  private clearBattleLog(): void {
    this.battleLogLines = []
    if (this.battleLogText) this.battleLogText.setText('')
  }

  private pushBattleLog(line: string): void {
    const t = line.trim()
    if (!t) return
    this.battleLogLines.push(t)
    while (this.battleLogLines.length > this.battleLogMaxLines) this.battleLogLines.shift()
    this.battleLogText.setText(this.battleLogLines.join('\n'))
  }

  private formatBattleLogLine(e: BattleEvent): string | null {
    if (!this.snapshot) return null
    const unitName = (id: UnitId) => this.snapshot!.units[id]?.name ?? id
    switch (e.kind) {
      case 'damage': {
        const sh = e.shieldAbsorbed > 0 ? ` · щит −${e.shieldAbsorbed}` : ''
        return `${unitName(e.targetId)}: урон ${e.amount}${sh}`
      }
      case 'heal':
        return `${unitName(e.targetId)}: +${e.amount} HP`
      case 'shield':
        return `${unitName(e.targetId)}: щит +${e.shieldHp}`
      case 'poison':
        return `${unitName(e.targetId)}: яд ${e.dotPerTurn}/ход ×${e.turns}`
      case 'poisonTick':
        return `${unitName(e.targetId)}: тик яда ${e.amount}`
      case 'death':
        return `${unitName(e.unitId)} погиб`
      case 'crowdReplace':
        return `Толпа: выходит ${unitName(e.newUnitId)}`
      case 'turnChanged':
        return `→ Ход: ${unitName(e.actorId)}`
      case 'battleEnded':
        if (e.result === 'win') return '★ Победа'
        if (e.result === 'surrender') return 'Бой: отступление'
        return 'Бой: поражение'
      default:
        return null
    }
  }

  private ensureUnitTooltip(): void {
    if (this.unitTooltipRoot) return
    const root = this.add.container(0, 0)
    root.setDepth(DEPTH_UI + 40)
    const bg = this.add.graphics()
    const txt = this.add.text(8, 8, '', {
      fontFamily: 'system-ui, Segoe UI, Roboto, Arial',
      fontSize: '12px',
      color: '#f0f2ff',
      wordWrap: { width: 214 },
    })
    txt.setOrigin(0, 0)
    root.add([bg, txt])
    root.setVisible(false)
    this.unitTooltipRoot = root
    this.unitTooltipBg = bg
    this.unitTooltipText = txt
  }

  private showUnitTooltip(unitId: UnitId): void {
    if (!this.snapshot || this.playerActionLocked) return
    const u = this.snapshot.units[unitId]
    if (!u || !u.enabled || u.hp <= 0) return
    const token = this.tokenByUnitId[unitId]
    if (!token) return
    this.ensureUnitTooltip()
    if (!this.unitTooltipText || !this.unitTooltipBg) return

    let status = ''
    for (const s of u.statuses) {
      if (s.statusId === 'poison') status += `\nЯд: ${s.dotPerTurn}/ход, ходов: ${s.remainingTurns}`
      if (s.statusId === 'shield') status += `\nЩит: ${s.shieldHpRemaining} HP`
    }
    const ab = u.abilities.map((id) => this.abilities?.[id]?.name ?? id).join(', ')
    this.unitTooltipText.setText(
      `${u.name}\nСлот ${u.slot} · HP ${u.hp}/${u.maxHp} · Инициатива ${u.initiative}${status}\nСпособности: ${ab}`,
    )

    const pad = 10
    const tw = 232
    const th = this.unitTooltipText.height + pad * 2
    this.unitTooltipBg.clear()
    this.unitTooltipBg.fillStyle(0x0c0c18, 0.94)
    this.unitTooltipBg.fillRoundedRect(0, 0, tw, th, 10)
    this.unitTooltipBg.lineStyle(1, 0x8b7cff, 0.55)
    this.unitTooltipBg.strokeRoundedRect(0, 0, tw, th, 10)

    const w = this.scale.gameSize.width
    const h = this.scale.gameSize.height
    const tx = token.root.x - tw / 2
    const ty = token.root.y - th - 52
    this.unitTooltipRoot!.setPosition(Phaser.Math.Clamp(tx, 6, w - tw - 6), Phaser.Math.Clamp(ty, 6, h - th - 6))
    this.unitTooltipRoot!.setVisible(true)
  }

  private hideUnitTooltip(): void {
    this.unitTooltipRoot?.setVisible(false)
  }

  private spawnDamageNumber(targetId: UnitId, amount: number): void {
    const token = this.tokenByUnitId[targetId]
    if (!token) return
    const { x, y } = token.root
    const t = this.add.text(x, y - 26, `−${amount}`, {
      fontFamily: 'system-ui, Segoe UI, Roboto, Arial',
      fontSize: '22px',
      color: '#ff5566',
      stroke: '#000000',
      strokeThickness: 4,
    })
    t.setOrigin(0.5)
    t.setDepth(DEPTH_UI + 25)
    this.tweens.add({
      targets: t,
      y: y - 64,
      alpha: 0,
      duration: 720,
      ease: Phaser.Math.Easing.Cubic.Out,
      onComplete: () => {
        t.destroy()
      },
    })
  }

  private spawnHealNumber(targetId: UnitId, amount: number): void {
    const token = this.tokenByUnitId[targetId]
    if (!token) return
    const { x, y } = token.root
    const t = this.add.text(x, y - 22, `+${amount}`, {
      fontFamily: 'system-ui, Segoe UI, Roboto, Arial',
      fontSize: '20px',
      color: '#6bff9e',
      stroke: '#000000',
      strokeThickness: 4,
    })
    t.setOrigin(0.5)
    t.setDepth(DEPTH_UI + 25)
    this.tweens.add({
      targets: t,
      y: y - 58,
      alpha: 0,
      duration: 680,
      ease: Phaser.Math.Easing.Cubic.Out,
      onComplete: () => t.destroy(),
    })
  }

  private spawnShieldNumber(targetId: UnitId, shieldHp: number): void {
    const token = this.tokenByUnitId[targetId]
    if (!token) return
    const { x, y } = token.root
    const t = this.add.text(x, y - 18, `Щит +${shieldHp}`, {
      fontFamily: 'system-ui, Segoe UI, Roboto, Arial',
      fontSize: '15px',
      color: '#7ddbff',
      stroke: '#000000',
      strokeThickness: 3,
    })
    t.setOrigin(0.5)
    t.setDepth(DEPTH_UI + 25)
    this.tweens.add({
      targets: t,
      y: y - 52,
      alpha: 0,
      duration: 700,
      ease: Phaser.Math.Easing.Cubic.Out,
      onComplete: () => t.destroy(),
    })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.time || !this.scene.isActive()) {
        resolve()
        return
      }
      this.time.delayedCall(ms, () => resolve())
    })
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

