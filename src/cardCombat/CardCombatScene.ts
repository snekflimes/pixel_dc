import Phaser from 'phaser'
import Peer, { type DataConnection } from 'peerjs'
import { getCardById, getEnabledCardIds } from './cards'
import { Deck } from './deck'
import { resolveRound } from './resolveRound'
import type { CardDef, RoundResolution } from './types'
import {
  createClientAndConnect,
  createHostPeer,
  formatPvpError,
  parsePvpData,
  waitForConnection,
  type PvpPickMsg,
} from '../net/pvpPeer'

const LOG_W = 176
const MAIN_X = LOG_W + 8
const GOLD = 0xc9a227
const BG = 0x0b0b12
const SLOTS_PER_ROW = 4

const TYPE_COLOR: Record<CardDef['type'], number> = {
  attack: 0xcc4444,
  defense: 0x4488cc,
  skill: 0xaa66cc,
}

type Phase = 'select' | 'resolve' | 'ended'
type BattleMode = 'ai' | 'pvp_host' | 'pvp_client'

export class CardCombatScene extends Phaser.Scene {
  private playerDeck!: Deck
  private enemyDeck!: Deck
  private maxHp = 100
  private turnSeconds = 15
  private playerHp = 100
  private enemyHp = 100

  private playerGrid: CardDef[][] | null = null
  private enemyGrid: CardDef[][] | null = null

  /** Номер раунда; активный столбец = roundIndex % 4 (слева направо). */
  private roundIndex = 0

  private phase: Phase = 'select'
  private choiceLocked = false
  private remainingSec = 15

  private mode: BattleMode = 'ai'
  private hostPeerIdForClient = ''

  private peer: Peer | null = null
  private pvpConn: DataConnection | null = null
  /** Локальный выбор строки в PvP (ожидание соперника). */
  private pvpLocalRow: 0 | 1 | null = null
  private pvpRemote: { row: 0 | 1; cardId: string } | null = null

  private logLines: string[] = []
  private logText!: Phaser.GameObjects.Text
  private timerText!: Phaser.GameObjects.Text
  private arenaText!: Phaser.GameObjects.Text
  private playerHpText!: Phaser.GameObjects.Text
  private enemyHpText!: Phaser.GameObjects.Text
  private playerHpBar!: Phaser.GameObjects.Graphics
  private enemyHpBar!: Phaser.GameObjects.Graphics

  private cardContainers: Phaser.GameObjects.Container[] = []
  private columnHighlight: Phaser.GameObjects.Graphics | null = null
  private playerSprite!: Phaser.GameObjects.Image
  private enemySprite!: Phaser.GameObjects.Image
  private menuBtn?: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'CardCombat' })
  }

  private get activeCol(): number {
    return this.roundIndex % SLOTS_PER_ROW
  }

  init(data?: {
    startHp?: number
    turnSeconds?: number
    mode?: BattleMode
    hostPeerId?: string
  }): void {
    this.maxHp = Math.round(Phaser.Math.Clamp(data?.startHp ?? 12, 4, 48))
    this.turnSeconds = Math.round(Phaser.Math.Clamp(data?.turnSeconds ?? 15, 5, 60))
    this.remainingSec = this.turnSeconds
    this.mode = data?.mode ?? 'ai'
    this.hostPeerIdForClient = data?.hostPeerId ?? ''
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
    this.roundIndex = 0

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

    this.appendLog('Карточный бой: сетка 2×4 — все карты открыты.')
    this.appendLog(
      'Активный столбец идёт слева направо (1 → 4). Выберите верхнюю или нижнюю карту в подсвеченном столбце.'
    )

    if (this.mode !== 'ai') {
      this.appendLog(
        this.mode === 'pvp_host'
          ? 'PvP: создаётся комната… Дождитесь кода и второго игрока.'
          : 'PvP: подключение к хосту…'
      )
    }

    const pool = [...getEnabledCardIds()]
    this.playerDeck = new Deck(pool, () => Math.random())
    this.enemyDeck = new Deck(pool, () => Math.random())

    this.events.once('shutdown', () => this.destroyPvpPeer())

    void this.bootPvpIfNeeded().then(() => {
      this.startRound()
    })
  }

  private destroyPvpPeer(): void {
    try {
      this.pvpConn?.removeAllListeners?.('data')
    } catch {
      /* ignore */
    }
    this.pvpConn?.close()
    this.pvpConn = null
    this.peer?.destroy()
    this.peer = null
  }

  private async bootPvpIfNeeded(): Promise<void> {
    if (this.mode === 'ai') return
    try {
      if (this.mode === 'pvp_host') {
        const { peer, id } = await createHostPeer()
        this.peer = peer
        this.appendLog(`PvP: ваш код комнаты (отдайте второму игроку): ${id}`)
        this.arenaText.setText(`Код комнаты: ${id}\nОжидаем подключения…`)
        const conn = await waitForConnection(peer)
        this.pvpConn = conn
        this.setupPvpDataHandler(conn)
        this.appendLog('PvP: соперник подключён.')
        this.arenaText.setText('Соперник на связи.\nВыберите карту в активном столбце.')
      } else {
        if (!this.hostPeerIdForClient.trim()) {
          throw new Error('Не указан код комнаты хоста')
        }
        const { peer, conn } = await createClientAndConnect(this.hostPeerIdForClient)
        this.peer = peer
        this.pvpConn = conn
        this.setupPvpDataHandler(conn)
        this.appendLog('PvP: подключено к хосту.')
        this.arenaText.setText('Подключено.\nВыберите карту в активном столбце.')
      }
    } catch (e) {
      console.error('[PvP]', e)
      const msg = formatPvpError(e)
      window.alert(`PvP: ошибка — ${msg}`)
      this.scene.start('MainMenu')
    }
  }

  private setupPvpDataHandler(conn: DataConnection): void {
    conn.on('data', (data: unknown) => {
      const raw = typeof data === 'string' ? (JSON.parse(data) as unknown) : data
      const m = parsePvpData(raw)
      if (!m) return
      if (m.round !== this.roundIndex) return
      this.pvpRemote = { row: m.row, cardId: m.cardId }
      this.tryFinishPvpRound()
    })
  }

  private sendPvpPick(msg: PvpPickMsg): void {
    const s = JSON.stringify(msg)
    this.pvpConn?.send(s)
  }

  update(_time: number, delta: number): void {
    if (this.phase !== 'select' || this.choiceLocked) return
    if (this.mode !== 'ai' && this.pvpLocalRow !== null && this.pvpRemote === null) {
      return
    }
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
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    this.timerText.setText(`${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`)
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
    this.columnHighlight?.destroy()
    this.columnHighlight = null
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

    this.pvpLocalRow = null
    this.pvpRemote = null

    const pFlat = this.playerDeck.drawEight()
    const eFlat = this.enemyDeck.drawEight()
    this.playerGrid = this.playerDeck.toGrid(pFlat)
    this.enemyGrid = this.enemyDeck.toGrid(eFlat)

    this.clearCardPanel()

    const col = this.activeCol
    this.arenaText.setText(
      `Столбец ${col + 1} из 4 (ход слева направо).\nВыберите верхнюю или нижнюю карту в золотой подсветке.`
    )

    this.layoutPlayerCards()
    this.redrawHpBars()
  }

  private layoutPlayerCards(): void {
    if (!this.playerGrid) return
    const panelW = this.panelWidth()
    const gap = 6
    const slotW = Math.floor((panelW - gap * (SLOTS_PER_ROW - 1)) / SLOTS_PER_ROW)
    const slotH = 102
    const baseY = 276
    const rowGap = 10
    const ac = this.activeCol

    const hl = this.add.graphics()
    const x0 = MAIN_X + ac * (slotW + gap)
    hl.fillStyle(0xc9a227, 0.16)
    hl.fillRoundedRect(x0 - 3, baseY - 3, slotW + 6, (slotH + rowGap) * 2 + slotH + 6, 10)
    hl.lineStyle(2, GOLD, 0.55)
    hl.strokeRoundedRect(x0 - 3, baseY - 3, slotW + 6, (slotH + rowGap) * 2 + slotH + 6, 10)
    hl.setDepth(0)
    this.columnHighlight = hl

    for (let row = 0; row < 2; row++) {
      const y = baseY + row * (slotH + rowGap)
      for (let col = 0; col < SLOTS_PER_ROW; col++) {
        const x = MAIN_X + col * (slotW + gap)
        const card = this.playerGrid[row]![col]!
        const playable = col === ac
        this.cardContainers.push(
          this.buildCardButton(card, x, y, slotW, slotH, row as 0 | 1, col, playable)
        )
      }
    }
  }

  private buildCardButton(
    card: CardDef,
    x: number,
    y: number,
    w: number,
    h: number,
    row: 0 | 1,
    col: number,
    playable: boolean
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y)
    if (!playable) {
      container.setAlpha(0.38)
    }

    const bg = this.add.graphics()
    const drawBg = (hover: boolean) => {
      bg.clear()
      const fill = !playable ? 0x121018 : hover ? 0x242432 : 0x1a1a24
      bg.fillStyle(fill, 1)
      bg.fillRoundedRect(0, 0, w, h, 8)
      const lineW = playable ? 3 : 1
      const colStroke = playable ? TYPE_COLOR[card.type] : 0x3a3a48
      bg.lineStyle(lineW, colStroke, playable ? 1 : 0.5)
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
        maxLines: 3,
      })
      .setOrigin(0, 0)

    const rowTag = this.add
      .text(w - 4, 4, `Ряд ${row + 1} · ${col + 1}`, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '9px',
        color: playable ? '#c9a227' : '#5a5468',
      })
      .setOrigin(1, 0)

    const hit = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0)
    if (playable) {
      hit.setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => drawBg(true))
      hit.on('pointerout', () => drawBg(false))
      hit.on('pointerdown', () => this.onPlayerPick(row))
    }

    container.add([bg, title, meta, desc, rowTag, hit])
    container.setSize(w, h)
    return container
  }

  private onTimeout(): void {
    if (this.phase !== 'select' || this.choiceLocked) return
    if (this.mode !== 'ai' && this.pvpLocalRow !== null) return
    const pick = (Math.random() < 0.5 ? 0 : 1) as 0 | 1
    this.appendLog(`Тайм-аут: случайный ряд ${pick + 1}.`)
    this.commitPlayerPick(pick)
  }

  private onPlayerPick(row: 0 | 1): void {
    if (this.phase !== 'select') return
    if (this.mode !== 'ai') {
      if (this.pvpLocalRow !== null || !this.pvpConn) return
    } else if (this.choiceLocked) {
      return
    }
    this.commitPlayerPick(row)
  }

  private commitPlayerPick(row: 0 | 1): void {
    if (this.mode !== 'ai') {
      if (!this.playerGrid || !this.pvpConn) return
      this.pvpLocalRow = row
      const card = this.playerGrid[row]![this.activeCol]!
      this.sendPvpPick({
        type: 'pick',
        round: this.roundIndex,
        row,
        cardId: card.id,
      })
      this.tryFinishPvpRound()
      return
    }
    if (this.choiceLocked) return
    this.finishRoundAi(row)
  }

  private tryFinishPvpRound(): void {
    if (this.mode === 'ai') return
    if (this.phase !== 'select') return
    if (this.pvpLocalRow === null || !this.pvpRemote || !this.playerGrid || !this.enemyGrid) {
      return
    }
    if (this.choiceLocked) return
    this.choiceLocked = true
    this.phase = 'resolve'

    const pCard = this.playerGrid[this.pvpLocalRow]![this.activeCol]!
    let eCard: CardDef
    try {
      eCard = getCardById(this.pvpRemote.cardId)
    } catch {
      this.choiceLocked = false
      this.phase = 'select'
      this.appendLog('Некорректные данные соперника.')
      return
    }

    const flatP = [...this.playerGrid[0]!, ...this.playerGrid[1]!]
    const flatE = [...this.enemyGrid[0]!, ...this.enemyGrid[1]!]
    this.playerDeck.afterRound(flatP)
    this.enemyDeck.afterRound(flatE)

    this.applyResolvedRound(pCard, eCard)
  }

  private finishRoundAi(playerPick: 0 | 1): void {
    if (!this.playerGrid || !this.enemyGrid) return
    this.choiceLocked = true
    this.phase = 'resolve'

    const pCard = this.playerGrid[playerPick]![this.activeCol]!
    const ePick = (Math.random() < 0.5 ? 0 : 1) as 0 | 1
    const eCard = this.enemyGrid[ePick]![this.activeCol]!

    const flatP = [...this.playerGrid[0]!, ...this.playerGrid[1]!]
    const flatE = [...this.enemyGrid[0]!, ...this.enemyGrid[1]!]
    this.playerDeck.afterRound(flatP)
    this.enemyDeck.afterRound(flatE)

    this.applyResolvedRound(pCard, eCard)
  }

  private applyResolvedRound(pCard: CardDef, eCard: CardDef): void {
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
        this.destroyPvpPeer()
        return
      }

      this.roundIndex += 1
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
      this.destroyPvpPeer()
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
