import Phaser from 'phaser'
import { getEnabledCardIds } from './cards'
import { Deck } from './deck'
import { resolveRound } from './resolveRound'
import type { CardDef, RoundResolution } from './types'

const LOG_W = 176
const MAIN_X = LOG_W + 8
const GOLD = 0xc9a227
const BG = 0x0b0b12
/** Сколько карточек в одной горизонтальной линии (как в «Джаггернауте»). */
const SLOTS_PER_ROW = 4

const TYPE_COLOR: Record<CardDef['type'], number> = {
  attack: 0xcc4444,
  defense: 0x4488cc,
  skill: 0xaa66cc,
}

type Phase = 'select' | 'resolve' | 'ended'

export class CardCombatScene extends Phaser.Scene {
  private playerDeck!: Deck
  private enemyDeck!: Deck
  private maxHp = 100
  private turnSeconds = 15
  private playerHp = 100
  private enemyHp = 100

  private playerHand: [CardDef, CardDef] | null = null
  private enemyHand: [CardDef, CardDef] | null = null

  private phase: Phase = 'select'
  private choiceLocked = false
  private remainingSec = 15

  private logLines: string[] = []
  private logText!: Phaser.GameObjects.Text
  private timerText!: Phaser.GameObjects.Text
  private arenaText!: Phaser.GameObjects.Text
  private playerHpText!: Phaser.GameObjects.Text
  private enemyHpText!: Phaser.GameObjects.Text
  private playerHpBar!: Phaser.GameObjects.Graphics
  private enemyHpBar!: Phaser.GameObjects.Graphics

  private cardContainers: Phaser.GameObjects.Container[] = []
  private playerSprite!: Phaser.GameObjects.Image
  private enemySprite!: Phaser.GameObjects.Image
  private menuBtn?: Phaser.GameObjects.Text
  /** В какой колонке (0…3) лежит играбельная карта в верхнем и нижнем ряду — каждый раунд случайно. */
  private handSlotCol: [number, number] = [1, 2]

  constructor() {
    super({ key: 'CardCombat' })
  }

  init(data?: { startHp?: number; turnSeconds?: number }): void {
    this.maxHp = Math.round(Phaser.Math.Clamp(data?.startHp ?? 12, 4, 48))
    this.turnSeconds = Math.round(Phaser.Math.Clamp(data?.turnSeconds ?? 15, 5, 60))
    this.remainingSec = this.turnSeconds
  }

  preload(): void {
    const px = this.add.graphics({ x: -200, y: -200 })
    px.fillStyle(0xffffff, 1)
    px.fillRect(0, 0, 6, 6)
    px.generateTexture('fx_pixel', 6, 6)
    px.destroy()

    const pl = this.add.graphics({ x: -200, y: -200 })
    pl.fillStyle(0x4a9eff, 1)
    pl.fillRoundedRect(8, 28, 56, 52, 6)
    pl.fillCircle(36, 22, 14)
    pl.fillStyle(0x2a6ecc, 1)
    pl.fillRoundedRect(22, 48, 28, 36, 4)
    pl.generateTexture('spr_player', 72, 96)
    pl.destroy()

    const en = this.add.graphics({ x: -200, y: -200 })
    en.fillStyle(0xcc5533, 1)
    en.fillRoundedRect(8, 28, 56, 52, 6)
    en.fillCircle(36, 22, 14)
    en.fillStyle(0x992211, 1)
    en.fillRoundedRect(18, 40, 36, 42, 4)
    en.generateTexture('spr_enemy', 72, 96)
    en.destroy()
  }

  create(): void {
    this.playerHp = this.maxHp
    this.enemyHp = this.maxHp
    this.phase = 'select'

    this.cameras.main.setBackgroundColor(BG)

    this.add.rectangle(LOG_W / 2, 280, LOG_W - 4, 548, 0x12121a, 0.95).setStrokeStyle(1, 0x2a2a38)

    this.logText = this.add
      .text(8, 12, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '11px',
        color: '#b8b0c4',
        wordWrap: { width: LOG_W - 20 },
      })
      .setOrigin(0, 0)

    this.enemyHpText = this.add
      .text(MAIN_X, 10, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '14px',
        color: '#e8e4f0',
      })
      .setOrigin(0, 0)

    this.enemyHpBar = this.add.graphics()
    this.playerHpText = this.add
      .text(MAIN_X, 242, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '14px',
        color: '#e8e4f0',
      })
      .setOrigin(0, 0)

    this.playerHpBar = this.add.graphics()

    this.timerText = this.add
      .text(780, 12, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '22px',
        color: '#c9a227',
      })
      .setOrigin(1, 0)

    this.arenaText = this.add
      .text(450, 118, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '14px',
        color: '#9a93a8',
        align: 'center',
        wordWrap: { width: 420 },
      })
      .setOrigin(0.5, 0)

    this.playerSprite = this.add.image(MAIN_X + 130, 155, 'spr_player').setDepth(2)
    this.enemySprite = this.add.image(MAIN_X + 560, 155, 'spr_enemy').setDepth(2)
    this.enemySprite.setFlipX(true)

    this.appendLog('Карточный бой: выберите верхнюю или нижнюю карту до конца таймера.')
    this.appendLog('Две линии по четыре слота: открытая карта и рубашки колоды в духе референса.')

    const pool = [...getEnabledCardIds()]
    this.playerDeck = new Deck(pool, () => Math.random())
    this.enemyDeck = new Deck(pool, () => Math.random())

    this.startRound()
  }

  update(_time: number, delta: number): void {
    if (this.phase !== 'select' || this.choiceLocked) return
    this.remainingSec -= delta / 1000
    if (this.remainingSec <= 0) {
      this.remainingSec = 0
      this.updateTimerDisplay()
      this.onTimeout()
      return
    }
    this.updateTimerDisplay()
  }

  private appendLog(line: string): void {
    this.logLines.push(line)
    if (this.logLines.length > 42) {
      this.logLines.splice(0, this.logLines.length - 42)
    }
    this.logText.setText(this.logLines.join('\n'))
  }

  private updateTimerDisplay(): void {
    const s = Math.max(0, this.remainingSec)
    const whole = Math.floor(s)
    const frac = Math.floor((s - whole) * 100)
    this.timerText.setText(
      `${whole.toString().padStart(2, '0')}:${frac.toString().padStart(2, '0')}`
    )
  }

  private redrawHpBars(): void {
    const maxW = 420
    const h = 10
    const ex = MAIN_X
    const ey = 36
    this.enemyHpBar.clear()
    this.enemyHpBar.fillStyle(0x2a1818, 1)
    this.enemyHpBar.fillRect(ex, ey, maxW, h)
    const ew = (maxW * Math.max(0, this.enemyHp)) / this.maxHp
    this.enemyHpBar.fillStyle(0xcc3333, 1)
    this.enemyHpBar.fillRect(ex, ey, ew, h)
    this.enemyHpBar.lineStyle(1, GOLD, 0.6)
    this.enemyHpBar.strokeRect(ex, ey, maxW, h)

    const py = 268
    this.playerHpBar.clear()
    this.playerHpBar.fillStyle(0x182a18, 1)
    this.playerHpBar.fillRect(ex, py, maxW, h)
    const pw = (maxW * Math.max(0, this.playerHp)) / this.maxHp
    this.playerHpBar.fillStyle(0x33aa55, 1)
    this.playerHpBar.fillRect(ex, py, pw, h)
    this.playerHpBar.lineStyle(1, GOLD, 0.6)
    this.playerHpBar.strokeRect(ex, py, maxW, h)

    this.enemyHpText.setText(`Противник — ${this.enemyHp} / ${this.maxHp}`)
    this.playerHpText.setText(`Вы — ${this.playerHp} / ${this.maxHp}`)
  }

  private clearCardPanel(): void {
    for (const c of this.cardContainers) {
      c.destroy(true)
    }
    this.cardContainers = []
  }

  private panelWidth(): number {
    return 900 - MAIN_X - 8
  }

  private startRound(): void {
    if (this.phase === 'ended') return

    this.menuBtn?.destroy()
    this.menuBtn = undefined

    this.phase = 'select'
    this.choiceLocked = false
    this.remainingSec = this.turnSeconds
    this.updateTimerDisplay()

    this.playerHand = this.playerDeck.drawTwo()
    this.enemyHand = this.enemyDeck.drawTwo()
    this.pickHandSlotColumns()

    this.clearCardPanel()
    this.arenaText.setText('Выберите карту.\nКарты противника скрыты.')

    this.layoutPlayerCards()
    this.redrawHpBars()
  }

  /** Две линейки по SLOTS_PER_ROW слотов; играбельная карта — в handSlotCol[row], остальное — рубашки. */
  private layoutPlayerCards(): void {
    if (!this.playerHand) return
    const panelW = this.panelWidth()
    const gap = 6
    const slotW = Math.floor((panelW - gap * (SLOTS_PER_ROW - 1)) / SLOTS_PER_ROW)
    const slotH = 102
    const baseY = 276
    const rowGap = 10

    for (let row = 0; row < 2; row++) {
      const y = baseY + row * (slotH + rowGap)
      const playCol = this.handSlotCol[row]!
      for (let col = 0; col < SLOTS_PER_ROW; col++) {
        const x = MAIN_X + col * (slotW + gap)
        if (col === playCol) {
          const card = this.playerHand[row]!
          this.cardContainers.push(
            this.buildCardButton(card, x, y, slotW, slotH, row as 0 | 1)
          )
        } else {
          this.cardContainers.push(this.buildDeckBackSlot(x, y, slotW, slotH, row, col))
        }
      }
    }
  }

  private pickHandSlotColumns(): void {
    const c0 = Phaser.Math.Between(0, SLOTS_PER_ROW - 1)
    let c1 = Phaser.Math.Between(0, SLOTS_PER_ROW - 1)
    if (c1 === c0) {
      c1 = (c0 + 1 + Phaser.Math.Between(0, SLOTS_PER_ROW - 2)) % SLOTS_PER_ROW
    }
    this.handSlotCol = [c0, c1]
  }

  private buildDeckBackSlot(
    x: number,
    y: number,
    w: number,
    h: number,
    row: number,
    col: number
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y)
    const g = this.add.graphics()
    g.fillStyle(0x14101c, 1)
    g.fillRoundedRect(0, 0, w, h, 8)
    g.lineStyle(2, 0x7a6630, 0.95)
    g.strokeRoundedRect(0, 0, w, h, 8)
    g.lineStyle(1, 0x4a3a22, 0.35)
    for (let i = -h; i < w + h; i += 10) {
      g.lineBetween(i, 0, i + h, h)
    }
    const mark = this.add
      .text(w / 2, h / 2 - 6, '✦', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: `${Math.min(26, w / 5)}px`,
        color: '#8a7540',
      })
      .setOrigin(0.5, 0.5)
    const lab = this.add
      .text(w / 2, h - 20, 'рубашка', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '9px',
        color: '#5a5468',
      })
      .setOrigin(0.5, 0)
    const tag = this.add
      .text(6, 4, `${row + 1} · ${col + 1}`, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '9px',
        color: '#4a4558',
      })
      .setOrigin(0, 0)
    c.add([g, mark, lab, tag])
    c.setSize(w, h)
    return c
  }

  private buildCardButton(
    card: CardDef,
    x: number,
    y: number,
    w: number,
    h: number,
    index: 0 | 1
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y)

    const bg = this.add.graphics()
    const drawBg = (hover: boolean) => {
      bg.clear()
      bg.fillStyle(hover ? 0x242432 : 0x1a1a24, 1)
      bg.fillRoundedRect(0, 0, w, h, 8)
      bg.lineStyle(3, TYPE_COLOR[card.type], 1)
      bg.strokeRoundedRect(0, 0, w, h, 8)
    }
    drawBg(false)

    const compact = w < 190
    const typeLabel =
      card.type === 'attack' ? 'Атака' : card.type === 'defense' ? 'Защита' : 'Навык'
    const stat =
      card.type === 'attack'
        ? `Урон ${card.damage ?? 0}`
        : card.type === 'defense'
          ? `Блок ${card.block ?? 0}`
          : `+${card.heal ?? 0} HP`

    const title = this.add
      .text(6, 4, card.name, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: compact ? '12px' : '13px',
        color: '#f0ecf8',
        wordWrap: { width: w - 12 },
      })
      .setOrigin(0, 0)

    const meta = this.add
      .text(6, compact ? 22 : 24, `${typeLabel} · ${stat}`, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: compact ? '10px' : '11px',
        color: '#a8a0b8',
        wordWrap: { width: w - 12 },
      })
      .setOrigin(0, 0)

    const desc = this.add
      .text(6, compact ? 38 : 40, card.description, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: compact ? '9px' : '10px',
        color: '#8a8298',
        wordWrap: { width: w - 12 },
        maxLines: compact ? 3 : 3,
      })
      .setOrigin(0, 0)

    const rowTag = this.add
      .text(w - 4, 4, `Ряд ${index + 1}`, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '9px',
        color: '#c9a227',
      })
      .setOrigin(1, 0)

    const hit = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0)
    hit.setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => drawBg(true))
    hit.on('pointerout', () => drawBg(false))
    hit.on('pointerdown', () => this.onPlayerPick(index))

    container.add([bg, title, meta, desc, rowTag, hit])
    container.setSize(w, h)
    return container
  }

  private onTimeout(): void {
    if (this.phase !== 'select' || this.choiceLocked) return
    const pick = (Math.random() < 0.5 ? 0 : 1) as 0 | 1
    this.appendLog(`Тайм-аут: случайная карта (ряд ${pick + 1}).`)
    this.finishRound(pick)
  }

  private onPlayerPick(index: 0 | 1): void {
    if (this.phase !== 'select' || this.choiceLocked) return
    this.finishRound(index)
  }

  private finishRound(playerPick: 0 | 1): void {
    if (this.phase !== 'select' || this.choiceLocked || !this.playerHand || !this.enemyHand) {
      return
    }
    this.choiceLocked = true
    this.phase = 'resolve'

    const pCard = this.playerHand[playerPick]!
    const ePick = (Math.random() < 0.5 ? 0 : 1) as 0 | 1
    const eCard = this.enemyHand[ePick]!

    this.playerDeck.afterRound(this.playerHand[0]!, this.playerHand[1]!)
    this.enemyDeck.afterRound(this.enemyHand[0]!, this.enemyHand[1]!)

    const res = resolveRound(pCard, eCard)

    const nextPlayerHp = Math.max(
      0,
      this.playerHp - res.dmgToPlayer + res.healPlayer
    )
    const nextEnemyHp = Math.max(
      0,
      this.enemyHp - res.dmgToEnemy + res.healEnemy
    )

    this.arenaText.setText(
      `Раскрытие:\nВы — «${pCard.name}»\nПротивник — «${eCard.name}»`
    )

    for (const line of res.lines) {
      this.appendLog(line)
    }

    this.playRoundFx(pCard, eCard, res, () => {
      this.playerHp = nextPlayerHp
      this.enemyHp = nextEnemyHp
      this.redrawHpBars()

      this.appendLog(`Итог по HP: вы ${this.playerHp}, противник ${this.enemyHp}.`)

      if (this.playerHp <= 0 || this.enemyHp <= 0) {
        this.phase = 'ended'
        const outcome =
          this.playerHp <= 0 && this.enemyHp <= 0
            ? 'Ничья (оба повержены).'
            : this.enemyHp <= 0
              ? 'Победа!'
              : 'Поражение.'
        this.appendLog(`Бой окончен: ${outcome}`)
        this.arenaText.setText(outcome)
        this.showMenuButton()
        return
      }

      this.time.delayedCall(1600, () => {
        this.startRound()
      })
    })
  }

  private showMenuButton(): void {
    this.menuBtn = this.add
      .text(450, 500, 'В меню', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '18px',
        color: '#c9a227',
        backgroundColor: '#1a1528',
        padding: { left: 24, right: 24, top: 10, bottom: 10 },
      })
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(20)

    this.menuBtn.on('pointerover', () =>
      this.menuBtn?.setStyle({ backgroundColor: '#2a2040' })
    )
    this.menuBtn.on('pointerout', () =>
      this.menuBtn?.setStyle({ backgroundColor: '#1a1528' })
    )
    this.menuBtn.on('pointerdown', () => {
      this.scene.start('MainMenu')
    })
  }

  private playRoundFx(
    pCard: CardDef,
    eCard: CardDef,
    res: RoundResolution,
    done: () => void
  ): void {
    let acc = 0
    const add = (delay: number, fn: () => void) => {
      acc += delay
      this.time.delayedCall(acc, fn)
    }

    add(0, () => {
      this.fxForCard('player', pCard, res)
    })
    add(140, () => {
      this.fxForCard('enemy', eCard, res)
    })
    add(160, () => {
      if (res.dmgToEnemy > 0) {
        this.fxDamageLine(this.playerSprite, this.enemySprite, 0xff6644)
        this.flashSprite(this.enemySprite, 0xff4444)
        this.shakeSprite(this.enemySprite)
        this.floatNumber(this.enemySprite.x, this.enemySprite.y - 50, `-${res.dmgToEnemy}`, '#ff6666')
      }
    })
    add(120, () => {
      if (res.dmgToPlayer > 0) {
        this.fxDamageLine(this.enemySprite, this.playerSprite, 0xff8844)
        this.flashSprite(this.playerSprite, 0xff4444)
        this.shakeSprite(this.playerSprite)
        this.floatNumber(this.playerSprite.x, this.playerSprite.y - 50, `-${res.dmgToPlayer}`, '#ff6666')
      }
    })
    add(120, () => {
      if (res.healPlayer > 0) {
        this.fxHealBurst(this.playerSprite.x, this.playerSprite.y)
        this.flashSprite(this.playerSprite, 0x44ff88)
        this.floatNumber(this.playerSprite.x, this.playerSprite.y - 70, `+${res.healPlayer}`, '#88ffaa')
      }
    })
    add(100, () => {
      if (res.healEnemy > 0) {
        this.fxHealBurst(this.enemySprite.x, this.enemySprite.y)
        this.flashSprite(this.enemySprite, 0x44ff88)
        this.floatNumber(this.enemySprite.x, this.enemySprite.y - 70, `+${res.healEnemy}`, '#88ffaa')
      }
    })

    this.time.delayedCall(acc + 120, done)
  }

  private fxForCard(side: 'player' | 'enemy', card: CardDef, res: RoundResolution): void {
    const spr = side === 'player' ? this.playerSprite : this.enemySprite
    if (card.type === 'attack') {
      this.fxSwingWeapon(spr)
    } else if (card.type === 'defense') {
      this.fxShield(spr.x, spr.y)
    } else {
      this.fxSkillCast(spr.x, spr.y)
    }
    if (card.type === 'attack' && side === 'player' && res.dmgToEnemy > 0) {
      this.cameras.main.shake(80, 0.002)
    }
    if (card.type === 'attack' && side === 'enemy' && res.dmgToPlayer > 0) {
      this.cameras.main.shake(80, 0.002)
    }
  }

  private fxSwingWeapon(spr: Phaser.GameObjects.Image): void {
    const base = spr.rotation
    this.tweens.add({
      targets: spr,
      rotation: base + 0.35,
      duration: 70,
      yoyo: true,
      ease: 'Sine.easeInOut',
    })
  }

  private fxShield(cx: number, cy: number): void {
    const g = this.add.graphics()
    g.lineStyle(3, 0x66aaff, 0.85)
    g.strokeCircle(0, 0, 48)
    g.setPosition(cx, cy)
    g.setDepth(5)
    g.setScale(0.3)
    g.setAlpha(0.9)
    this.tweens.add({
      targets: g,
      scale: 1.15,
      alpha: 0,
      duration: 420,
      ease: 'Sine.easeOut',
      onComplete: () => g.destroy(),
    })
  }

  private fxSkillCast(cx: number, cy: number): void {
    const p = this.add.particles(0, 0, 'fx_pixel', {
      speed: { min: 40, max: 120 },
      angle: { min: 200, max: 340 },
      scale: { start: 1, end: 0 },
      lifespan: 500,
      tint: [0xaa66ff, 0x6688ff],
      quantity: 16,
      emitting: false,
    })
    p.setDepth(6)
    p.explode(16, cx, cy - 10)
    this.time.delayedCall(600, () => p.destroy())
  }

  private fxHealBurst(cx: number, cy: number): void {
    const p = this.add.particles(0, 0, 'fx_pixel', {
      speed: { min: 20, max: 60 },
      angle: { min: 240, max: 300 },
      scale: { start: 1.2, end: 0 },
      lifespan: 700,
      tint: [0x44ff88, 0x88ffcc],
      quantity: 22,
      emitting: false,
    })
    p.setDepth(6)
    p.explode(22, cx, cy + 20)
    this.time.delayedCall(700, () => p.destroy())
  }

  private fxDamageLine(
    from: Phaser.GameObjects.Image,
    to: Phaser.GameObjects.Image,
    color: number
  ): void {
    const g = this.add.graphics()
    g.lineStyle(5, color, 0.85)
    g.lineBetween(from.x + 30, from.y, to.x - 30, to.y)
    g.setDepth(4)
    g.setAlpha(0)
    this.tweens.add({
      targets: g,
      alpha: 1,
      duration: 60,
      yoyo: true,
      onComplete: () => g.destroy(),
    })
  }

  private flashSprite(spr: Phaser.GameObjects.Image, tint: number): void {
    spr.setTint(tint)
    this.tweens.add({
      targets: spr,
      duration: 100,
      yoyo: true,
      onComplete: () => {
        spr.clearTint()
      },
    })
  }

  private shakeSprite(spr: Phaser.GameObjects.Image): void {
    const ox = spr.x
    this.tweens.add({
      targets: spr,
      x: ox + 6,
      duration: 40,
      yoyo: true,
      repeat: 3,
      onComplete: () => {
        spr.setX(ox)
      },
    })
  }

  private floatNumber(x: number, y: number, text: string, color: string): void {
    const t = this.add
      .text(x, y, text, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '18px',
        color,
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(10)
    this.tweens.add({
      targets: t,
      y: y - 42,
      alpha: 0,
      duration: 900,
      ease: 'Sine.easeOut',
      onComplete: () => t.destroy(),
    })
  }
}
