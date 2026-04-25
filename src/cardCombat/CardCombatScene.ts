import Phaser from 'phaser'
import Peer, { type DataConnection } from 'peerjs'
import { getCardById, getEnabledCardIds } from './cards'
import { Deck, seedStringToRng } from './deck'
import { withStatBonus } from './cardBonus'
import { resolveTurn } from './resolveTurn'
import type { BattleSnapshot, CardDef, MinionState, TurnFxTotals, TurnResolution } from './types'
import { CardCombatTutorial } from './tutorial/CardCombatTutorial'
import {
  createClientAndConnect,
  createHostPeer,
  formatPvpError,
  parsePvpData,
  waitForConnection,
  type PvpPickMsg,
} from '../net/pvpPeer'

const GOLD = 0xc9a227
const BG = 0x0b0b12
const SLOTS_PER_ROW = 4
/** После сдвига колоды активный столбец всегда слева (индекс 0). */
const ACTIVE_COL = 0

const TYPE_COLOR: Record<CardDef['type'], number> = {
  attack: 0xcc4444,
  defense: 0x4488cc,
  skill: 0xaa66cc,
}

type Phase = 'select' | 'resolve' | 'ended'
type BattleMode = 'ai' | 'pvp_host' | 'pvp_client'

export class CardCombatScene extends Phaser.Scene {
  // keep refs for future relayout (responsive)
  private logPanelBg!: Phaser.GameObjects.Rectangle
  private topBarBg!: Phaser.GameObjects.Rectangle

  private playerDeck!: Deck
  private enemyDeck!: Deck
  private maxHp = 100
  private turnSeconds = 15
  private playerHp = 100
  private enemyHp = 100
  private playerArmor = 0
  private enemyArmor = 0
  private playerBoard: MinionState[] = []
  private enemyBoard: MinionState[] = []
  private uidSeq = 0
  /** Одинаковый сид для PvP (код комнаты) — синхронный RNG в resolveTurn. */
  private pvpSyncSeed = ''

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
  private pvpRemote: { row: 0 | 1; cardId: string; cardBp: number } | null = null

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
  private turnStatusText!: Phaser.GameObjects.Text
  private bpPips!: Phaser.GameObjects.Graphics
  private minionStripEnemy!: Phaser.GameObjects.Container
  private minionStripPlayer!: Phaser.GameObjects.Container
  private tutorial?: CardCombatTutorial

  /** Очки тактики на весь матч (5). Тратятся в активном столбце, до +2 на карту за раунд. */
  private static readonly BP_MATCH = 5
  private static readonly BP_MAX_ON_CARD = 2
  private matchBpPlayer = CardCombatScene.BP_MATCH
  private matchBpEnemy = CardCombatScene.BP_MATCH
  /** Бонус к стату карты в этом раунде [row][col] */
  private roundPlayerBp: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  private roundEnemyBp: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  private bpStatusText!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'CardCombat' })
  }

  private get logW(): number {
    return Math.round(Phaser.Math.Clamp(this.scale.width * 0.24, 170, 260))
  }

  private get mainX(): number {
    return this.logW + 14
  }

  private get mainW(): number {
    return Math.max(260, this.scale.width - this.mainX - 12)
  }

  private get activeCol(): number {
    return ACTIVE_COL
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
    this.playerArmor = 0
    this.enemyArmor = 0
    this.playerBoard = []
    this.enemyBoard = []
    this.pvpSyncSeed = ''
    this.phase = 'select'
    this.roundIndex = 0

    this.cameras.main.setBackgroundColor(BG)

    // Background panels (responsive)
    this.logPanelBg = this.add
      .rectangle(this.logW / 2, this.scale.height / 2, this.logW - 8, this.scale.height - 18, 0x12121a, 0.95)
      .setStrokeStyle(1, 0x2a2a38)
      .setDepth(0)

    this.topBarBg = this.add
      .rectangle(this.mainX + this.mainW / 2, 44, this.mainW, 88, 0x11111a, 0.82)
      .setStrokeStyle(1, 0x2a2a38)
      .setDepth(0)
    // Touch fields to satisfy noUnusedLocals (we will reuse them for relayout soon).
    this.logPanelBg.setScrollFactor(0)
    this.topBarBg.setScrollFactor(0)

    this.logText = this.add
      .text(10, 12, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '11px',
        color: '#b8b0c4',
        wordWrap: { width: this.logW - 22 },
      })
      .setOrigin(0, 0)

    this.enemyHpText = this.add
      .text(this.mainX + 10, 10, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '14px',
        color: '#e8e4f0',
      })
      .setOrigin(0, 0)

    this.enemyHpBar = this.add.graphics()
    this.playerHpText = this.add
      .text(this.mainX + 10, 58, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '14px',
        color: '#e8e4f0',
      })
      .setOrigin(0, 0)

    this.playerHpBar = this.add.graphics()

    this.timerText = this.add
      .text(this.mainX + this.mainW - 10, 10, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '22px',
        color: '#c9a227',
      })
      .setOrigin(1, 0)

    this.arenaText = this.add
      .text(this.mainX + this.mainW / 2, 106, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '14px',
        color: '#9a93a8',
        align: 'center',
        wordWrap: { width: Math.max(260, this.mainW - 30) },
      })
      .setOrigin(0.5, 0)

    const cx = this.mainX + this.mainW / 2
    const boardY = 170
    this.playerSprite = this.add.image(cx - 170, boardY, 'spr_player').setDepth(2)
    this.enemySprite = this.add.image(cx + 170, boardY, 'spr_enemy').setDepth(2)
    this.enemySprite.setFlipX(true)

    this.appendLog('Карточный бой: очередь 2×4 (видно 4 хода вперёд). Играете с левого столбца.')
    this.appendLog('Заклинания бьют по герою / дают броню / лечат. Существа остаются на поле и атакуют сами.')
    this.appendLog('Тактика: 5 очков за матч — кнопка «+ тактика» на карте в активном столбце (до +2 за ход).')

    this.matchBpPlayer = CardCombatScene.BP_MATCH
    this.matchBpEnemy = CardCombatScene.BP_MATCH
    this.roundPlayerBp = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    this.roundEnemyBp = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]

    this.bpStatusText = this.add
      .text(this.mainX + 10, 32, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '11px',
        color: '#9a8a68',
        wordWrap: { width: Math.max(260, this.mainW - 260) },
      })
      .setOrigin(0, 0)
    this.bpPips = this.add.graphics().setDepth(3)
    this.refreshBpStatus()

    this.turnStatusText = this.add
      .text(this.mainX + 10, 76, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '12px',
        color: '#c8c0d8',
        wordWrap: { width: Math.max(260, this.mainW - 20) },
      })
      .setOrigin(0, 0)
      .setDepth(3)

    this.minionStripEnemy = this.add.container(this.mainX + 10, 126).setDepth(3)
    this.minionStripPlayer = this.add.container(this.mainX + 10, 216).setDepth(3)

    this.tutorial = new CardCombatTutorial(this)
    this.tutorial.mountHelpButton(860, 8)
    this.tutorial.startIfNewUser(600)

    if (this.mode !== 'ai') {
      this.appendLog(
        this.mode === 'pvp_host'
          ? 'PvP: создаётся комната… Дождитесь кода и второго игрока.'
          : 'PvP: подключение к хосту…'
      )
    }

    const pool = [...getEnabledCardIds()]

    this.events.once('shutdown', () => this.destroyPvpPeer())

    if (this.mode === 'ai') {
      this.playerDeck = new Deck(pool, () => Math.random())
      this.enemyDeck = new Deck(pool, () => Math.random())
      void this.bootPvpIfNeeded().then(() => {
        this.startRound()
      })
    } else {
      void this.bootPvpIfNeeded().then(() => {
        const seed = this.pvpSyncSeed || 'pvp'
        this.playerDeck = new Deck(pool, seedStringToRng(`${seed}|deckP`))
        this.enemyDeck = new Deck(pool, seedStringToRng(`${seed}|deckE`))
        this.startRound()
      })
    }
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
        this.pvpSyncSeed = id
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
        this.pvpSyncSeed = this.hostPeerIdForClient.trim()
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
      this.pvpRemote = { row: m.row, cardId: m.cardId, cardBp: m.cardBp }
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
    this.updateTurnStatus()
  }

  private appendLog(line: string): void {
    this.logLines.push(line)
    const max = 56
    if (this.logLines.length > max) {
      this.logLines.splice(0, this.logLines.length - max)
    }
    this.logText.setText(this.logLines.join('\n'))
  }

  private updateTimerDisplay(): void {
    const s = Math.max(0, this.remainingSec)
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    this.timerText.setText(`${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`)
  }

  private refreshBpStatus(): void {
    this.bpStatusText.setText(
      `Тактика: ${this.matchBpPlayer} / ${CardCombatScene.BP_MATCH} — «+ тактика» на карте слева, до +${CardCombatScene.BP_MAX_ON_CARD} к числу за ход.`
    )
    this.redrawBpPips()
  }

  private redrawBpPips(): void {
    const g = this.bpPips
    g.clear()
    const x0 = this.mainX + this.mainW - 86
    const y = 40
    for (let i = 0; i < CardCombatScene.BP_MATCH; i++) {
      const filled = i < this.matchBpPlayer
      g.fillStyle(filled ? GOLD : 0x3a3428, filled ? 1 : 0.9)
      g.fillCircle(x0 + i * 12, y, 4)
      g.lineStyle(1, 0x5a5040, 0.8)
      g.strokeCircle(x0 + i * 12, y, 4)
    }
  }

  private updateTurnStatus(): void {
    const wait =
      this.mode !== 'ai' && this.pvpLocalRow !== null && this.pvpRemote === null
        ? '\nОжидание хода соперника…'
        : ''
    this.turnStatusText.setText(
      `Раунд ${this.roundIndex + 1} · ход из левого столбца (очередь сдвигается после розыгрыша).${wait}`
    )
  }

  private prefillEnemyBpInActiveColumn(): void {
    const ac = this.activeCol
    let guard = 0
    while (this.matchBpEnemy > 0 && guard < 64) {
      guard += 1
      if (
        this.roundEnemyBp[0]![ac]! >= CardCombatScene.BP_MAX_ON_CARD &&
        this.roundEnemyBp[1]![ac]! >= CardCombatScene.BP_MAX_ON_CARD
      ) {
        break
      }
      const r = (Math.random() < 0.5 ? 0 : 1) as 0 | 1
      if (this.roundEnemyBp[r]![ac]! >= CardCombatScene.BP_MAX_ON_CARD) {
        continue
      }
      this.roundEnemyBp[r]![ac]! += 1
      this.matchBpEnemy -= 1
    }
  }

  private tryAddPlayerBp(row: 0 | 1, col: number): void {
    if (this.phase !== 'select' || this.choiceLocked) {
      return
    }
    if (col !== this.activeCol) {
      return
    }
    if (this.mode !== 'ai' && this.pvpLocalRow !== null) {
      return
    }
    if (this.matchBpPlayer <= 0) {
      return
    }
    if (this.roundPlayerBp[row]![col]! >= CardCombatScene.BP_MAX_ON_CARD) {
      return
    }
    if (!this.playerGrid) {
      return
    }
    this.roundPlayerBp[row]![col]! += 1
    this.matchBpPlayer -= 1
    const c = this.playerGrid[row]![col]!
    this.appendLog(
      `Тактика: +1 к «${c.name}» (сейчас +${this.roundPlayerBp[row]![col]!} на эту карту).`
    )
    this.clearCardPanel()
    this.layoutPlayerCards()
    this.updateTurnStatus()
    this.refreshBpStatus()
  }

  private redrawHpBars(): void {
    const maxW = Math.min(520, Math.max(260, this.mainW - 220))
    const h = 10
    const ex = this.mainX + 10
    const ey = 32
    this.enemyHpBar.clear()
    this.enemyHpBar.fillStyle(0x2a1818, 1)
    this.enemyHpBar.fillRect(ex, ey, maxW, h)
    const ew = (maxW * Math.max(0, this.enemyHp)) / this.maxHp
    this.enemyHpBar.fillStyle(0xcc3333, 1)
    this.enemyHpBar.fillRect(ex, ey, ew, h)
    this.enemyHpBar.lineStyle(1, GOLD, 0.6)
    this.enemyHpBar.strokeRect(ex, ey, maxW, h)

    const py = 80
    this.playerHpBar.clear()
    this.playerHpBar.fillStyle(0x182a18, 1)
    this.playerHpBar.fillRect(ex, py, maxW, h)
    const pw = (maxW * Math.max(0, this.playerHp)) / this.maxHp
    this.playerHpBar.fillStyle(0x33aa55, 1)
    this.playerHpBar.fillRect(ex, py, pw, h)
    this.playerHpBar.lineStyle(1, GOLD, 0.6)
    this.playerHpBar.strokeRect(ex, py, maxW, h)

    const ea = this.enemyArmor > 0 ? ` · броня ${this.enemyArmor}` : ''
    const pa = this.playerArmor > 0 ? ` · броня ${this.playerArmor}` : ''
    this.enemyHpText.setText(`Противник — ${this.enemyHp} / ${this.maxHp}${ea}`)
    this.playerHpText.setText(`Вы — ${this.playerHp} / ${this.maxHp}${pa}`)
  }

  private layoutMinionStrips(): void {
    this.minionStripEnemy.removeAll(true)
    this.minionStripPlayer.removeAll(true)
    const slotW = 64
    const gap = 4
    const maxN = 5
    const drawStrip = (
      cont: Phaser.GameObjects.Container,
      board: MinionState[],
      yLabel: string
    ) => {
      const label = this.add
        .text(0, -16, yLabel, {
          fontFamily: 'system-ui,Segoe UI,sans-serif',
          fontSize: '10px',
          color: '#7a7388',
        })
        .setOrigin(0, 0)
      cont.add(label)
      for (let i = 0; i < maxN; i++) {
        const x = i * (slotW + gap)
        const g = this.add.graphics()
        g.fillStyle(0x16161e, 1)
        g.lineStyle(1, 0x3a3a48, 0.9)
        g.fillRoundedRect(x, 0, slotW, 44, 6)
        g.strokeRoundedRect(x, 0, slotW, 44, 6)
        cont.add(g)
        const m = board[i]
        if (m) {
          const taunt = m.taunt ? 'П ' : ''
          const ds = m.divineShield ? 'Щ ' : ''
          const ls = m.lifesteal ? 'К ' : ''
          const t = this.add
            .text(
              x + 4,
              4,
              `${m.name.slice(0, 9)}${m.name.length > 9 ? '…' : ''}\n${taunt}${ds}${ls}${m.atk}/${m.hp}`,
              {
                fontFamily: 'system-ui,Segoe UI,sans-serif',
                fontSize: '9px',
                color: '#d0c8e0',
                wordWrap: { width: slotW - 8 },
              }
            )
            .setOrigin(0, 0)
          cont.add(t)
        } else {
          const t = this.add
            .text(x + slotW / 2, 22, '—', {
              fontFamily: 'system-ui,Segoe UI,sans-serif',
              fontSize: '11px',
              color: '#4a4458',
            })
            .setOrigin(0.5, 0.5)
          cont.add(t)
        }
      }
    }
    drawStrip(this.minionStripEnemy, this.enemyBoard, 'Поле врага')
    drawStrip(this.minionStripPlayer, this.playerBoard, 'Ваши существа')
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
    return this.mainW
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

    this.roundPlayerBp = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    this.roundEnemyBp = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    if (this.mode === 'ai') {
      this.prefillEnemyBpInActiveColumn()
    }

    if (!this.playerDeck.hasGrid()) {
      this.playerGrid = this.playerDeck.initBattleGrid()
      this.enemyGrid = this.enemyDeck.initBattleGrid()
    } else {
      this.playerGrid = this.playerDeck.getGrid()
      this.enemyGrid = this.enemyDeck.getGrid()
    }

    this.appendLog(`── Раунд ${this.roundIndex + 1} ──`)

    this.clearCardPanel()

    this.arenaText.setText(
      `Ход ${this.roundIndex + 1}. Слева — текущий столбец.\nВыберите верхнюю или нижнюю карту. После хода колонки сдвинутся.`
    )
    this.updateTurnStatus()

    this.layoutPlayerCards()
    this.layoutMinionStrips()
    this.refreshBpStatus()
    this.redrawHpBars()
  }

  private layoutPlayerCards(): void {
    if (!this.playerGrid) return
    const panelW = this.panelWidth()
    const gap = 6
    const slotW = Math.floor((panelW - gap * (SLOTS_PER_ROW - 1)) / SLOTS_PER_ROW)
    const slotH = Math.round(Phaser.Math.Clamp(this.scale.height * 0.18, 108, 140))
    const baseY = this.scale.height - (slotH * 2 + 36)
    const rowGap = 10
    const ac = this.activeCol

    for (let col = 0; col < SLOTS_PER_ROW; col++) {
      const x = this.mainX + col * (slotW + gap)
      const tag =
        col === ac
          ? 'СЕЙЧАС'
          : col === ac + 1
            ? 'Далее'
            : col === ac + 2
              ? 'Через 2'
              : 'Через 3'
      const tagColor = col === ac ? '#e8d060' : '#5a5468'
      const head = this.add
        .text(slotW / 2, 0, tag, {
          fontFamily: 'system-ui,Segoe UI,sans-serif',
          fontSize: '10px',
          color: tagColor,
        })
        .setOrigin(0.5, 1)
      const hc = this.add.container(x, baseY - 14)
      hc.add(head)
      hc.setDepth(1)
      this.cardContainers.push(hc)
    }

    const hl = this.add.graphics()
    const x0 = this.mainX + ac * (slotW + gap)
    hl.fillStyle(0xc9a227, 0.22)
    hl.fillRoundedRect(x0 - 4, baseY - 4, slotW + 8, (slotH + rowGap) * 2 + slotH + 8, 12)
    hl.lineStyle(3, GOLD, 0.75)
    hl.strokeRoundedRect(x0 - 4, baseY - 4, slotW + 8, (slotH + rowGap) * 2 + slotH + 8, 12)
    hl.setDepth(0)
    this.columnHighlight = hl

    for (let row = 0; row < 2; row++) {
      const y = baseY + row * (slotH + rowGap)
      for (let col = 0; col < SLOTS_PER_ROW; col++) {
        const x = this.mainX + col * (slotW + gap)
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
      container.setAlpha(0.52)
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
    const isMinion = card.kind === 'minion'
    const typeLabel = isMinion
      ? 'Существо'
      : card.type === 'attack'
        ? 'Заклинание · урон'
        : card.type === 'defense'
          ? 'Заклинание · броня'
          : 'Заклинание · лечение'
    const eff = withStatBonus(card, this.roundPlayerBp[row]![col]!)
    const bpNow = this.roundPlayerBp[row]![col]!
    const stat = isMinion
      ? `${eff.minionAtk ?? 0} / ${eff.minionHp ?? 1}`
      : eff.type === 'attack'
        ? `Урон ${eff.damage ?? 0}`
        : eff.type === 'defense'
          ? `Броня +${eff.block ?? 0}`
          : `Лечение +${eff.heal ?? 0} HP`

    const title = this.add
      .text(6, 4, card.name, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: compact ? '12px' : '13px',
        color: '#f0ecf8',
        wordWrap: { width: w - 12 },
      })
      .setOrigin(0, 0)

    const kw = card.keywords
    const kwStr =
      isMinion && kw
        ? [
            kw.taunt ? 'Провокация' : '',
            kw.divineShield ? 'Щит' : '',
            kw.lifesteal ? 'Кража жизни' : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : ''
    const meta = this.add
      .text(6, compact ? 22 : 24, `${typeLabel} · ${stat}${kwStr ? `\n${kwStr}` : ''}`, {
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
      .text(w - 4, 4, `Ряд ${row + 1}${playable ? ' · нажми' : ''}`, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '9px',
        color: playable ? '#c9a227' : '#5a5468',
      })
      .setOrigin(1, 0)

    const bpBadge =
      playable && bpNow > 0
        ? this.add
            .text(w - 4, h - 36, `такт +${bpNow}`, {
              fontFamily: 'system-ui,Segoe UI,sans-serif',
              fontSize: '9px',
              color: '#e8c84a',
            })
            .setOrigin(1, 1)
        : null

    const hit = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0)
    if (playable) {
      hit.setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => drawBg(true))
      hit.on('pointerout', () => drawBg(false))
      hit.on('pointerdown', () => this.onPlayerPick(row))
    }

    const children: Phaser.GameObjects.GameObject[] = [bg, title, meta, desc, rowTag, hit]
    if (bpBadge) {
      children.push(bpBadge)
    }

    if (playable) {
      const canAdd =
        this.phase === 'select' &&
        !this.choiceLocked &&
        (this.mode === 'ai' || this.pvpLocalRow === null) &&
        this.matchBpPlayer > 0 &&
        this.roundPlayerBp[row]![col]! < CardCombatScene.BP_MAX_ON_CARD
      const tactBg = this.add.graphics()
      const tw = Math.min(86, w - 8)
      const th = 22
      const tx = w - tw - 4
      const ty = h - th - 4
      const drawTact = (on: boolean) => {
        tactBg.clear()
        tactBg.fillStyle(canAdd ? (on ? 0x3a3018 : 0x2a2418) : 0x1a1814, 1)
        tactBg.lineStyle(1, canAdd ? GOLD : 0x4a4030, canAdd ? 0.85 : 0.35)
        tactBg.fillRoundedRect(tx, ty, tw, th, 6)
        tactBg.strokeRoundedRect(tx, ty, tw, th, 6)
      }
      drawTact(false)
      const tactLabel = this.add
        .text(tx + tw / 2, ty + th / 2, '+ тактика', {
          fontFamily: 'system-ui,Segoe UI,sans-serif',
          fontSize: '10px',
          color: canAdd ? '#f0e8b8' : '#5a5048',
        })
        .setOrigin(0.5, 0.5)
      const addHit = this.add.rectangle(tx + tw / 2, ty + th / 2, tw, th, 0x000000, 0)
      if (canAdd) {
        addHit.setInteractive({ useHandCursor: true })
        addHit.on('pointerover', () => {
          drawTact(true)
          drawBg(true)
        })
        addHit.on('pointerout', () => {
          drawTact(false)
          drawBg(false)
        })
        addHit.on('pointerdown', (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Event) => {
          ev.stopPropagation()
          this.tryAddPlayerBp(row, col)
        })
      }
      children.push(tactBg, tactLabel, addHit)
    }

    container.add(children)
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
      const ac = this.activeCol
      const card = this.playerGrid[row]![ac]!
      this.sendPvpPick({
        type: 'pick',
        round: this.roundIndex,
        row,
        cardId: card.id,
        cardBp: this.roundPlayerBp[row]![ac]!,
      })
      this.updateTurnStatus()
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

    const ac = this.activeCol
    const pBase = this.playerGrid[this.pvpLocalRow]![ac]!
    const pBp = this.roundPlayerBp[this.pvpLocalRow]![ac]!
    let eBase: CardDef
    try {
      eBase = getCardById(this.pvpRemote.cardId)
    } catch {
      this.choiceLocked = false
      this.phase = 'select'
      this.appendLog('Некорректные данные соперника.')
      return
    }
    const eBp = this.pvpRemote.cardBp
    const pCard = withStatBonus(pBase, pBp)
    const eCard = withStatBonus(eBase, eBp)

    const eRow = this.pvpRemote.row
    this.applyTurnResult(pCard, eCard, { pBonus: pBp, eBonus: eBp }, this.pvpLocalRow!, eRow)
  }

  private finishRoundAi(playerPick: 0 | 1): void {
    if (!this.playerGrid || !this.enemyGrid) return
    this.choiceLocked = true
    this.phase = 'resolve'

    const ac = this.activeCol
    const pBase = this.playerGrid[playerPick]![ac]!
    const ePick = (Math.random() < 0.5 ? 0 : 1) as 0 | 1
    const eBase = this.enemyGrid[ePick]![ac]!
    const pBp = this.roundPlayerBp[playerPick]![ac]!
    const eBp = this.roundEnemyBp[ePick]![ac]!
    const pCard = withStatBonus(pBase, pBp)
    const eCard = withStatBonus(eBase, eBp)

    this.applyTurnResult(pCard, eCard, { pBonus: pBp, eBonus: eBp }, playerPick, ePick)
  }

  private applyTurnResult(
    pCard: CardDef,
    eCard: CardDef,
    meta: { pBonus: number; eBonus: number },
    playerRow: 0 | 1,
    enemyRow: 0 | 1
  ): void {
    if (meta.pBonus > 0) {
      this.appendLog(`Ваша тактика: +${meta.pBonus} к числу на карте.`)
    }
    if (meta.eBonus > 0) {
      this.appendLog(`Тактика противника: +${meta.eBonus}.`)
    }

    const snap: BattleSnapshot = {
      playerHp: this.playerHp,
      enemyHp: this.enemyHp,
      playerArmor: this.playerArmor,
      enemyArmor: this.enemyArmor,
      playerBoard: this.playerBoard.map((m) => ({ ...m })),
      enemyBoard: this.enemyBoard.map((m) => ({ ...m })),
    }
    const rng =
      this.mode === 'ai'
        ? () => Math.random()
        : seedStringToRng(`${this.pvpSyncSeed}|resolve|${this.roundIndex}|${pCard.id}|${eCard.id}`)
    const res = resolveTurn(snap, pCard, eCard, () => `m_${Date.now()}_${this.uidSeq++}`, rng)

    this.arenaText.setText(`Раскрытие:\nВы — «${pCard.name}»\nПротивник — «${eCard.name}»`)

    for (const line of res.lines) {
      this.appendLog(line)
    }

    this.playTurnFx(res, () => {
      this.playerHp = res.snapshot.playerHp
      this.enemyHp = res.snapshot.enemyHp
      this.playerArmor = res.snapshot.playerArmor
      this.enemyArmor = res.snapshot.enemyArmor
      this.playerBoard = res.snapshot.playerBoard
      this.enemyBoard = res.snapshot.enemyBoard
      this.redrawHpBars()
      this.layoutMinionStrips()

      this.appendLog(
        `Итог: вы ${this.playerHp} HP${this.playerArmor ? ` (+${this.playerArmor} брони)` : ''}, противник ${this.enemyHp} HP${this.enemyArmor ? ` (+${this.enemyArmor} брони)` : ''}.`
      )

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

      this.playerDeck.advanceAfterPlay(playerRow)
      this.enemyDeck.advanceAfterPlay(enemyRow)
      this.playerGrid = this.playerDeck.getGrid()
      this.enemyGrid = this.enemyDeck.getGrid()

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

  private playTurnFx(res: TurnResolution, done: () => void): void {
    const fx = res.fx
    const pCard = res.playerCardFx
    const eCard = res.enemyCardFx
    let acc = 0
    const add = (delay: number, fn: () => void) => {
      acc += delay
      this.time.delayedCall(acc, fn)
    }

    add(0, () => {
      this.fxForCard('player', pCard, fx)
    })
    add(140, () => {
      this.fxForCard('enemy', eCard, fx)
    })
    add(160, () => {
      if (fx.dmgToEnemyHero > 0) {
        this.fxDamageLine(this.playerSprite, this.enemySprite, 0xff6644)
        this.flashSprite(this.enemySprite, 0xff4444)
        this.shakeSprite(this.enemySprite)
        this.floatNumber(this.enemySprite.x, this.enemySprite.y - 50, `-${fx.dmgToEnemyHero}`, '#ff6666')
      }
    })
    add(120, () => {
      if (fx.dmgToPlayerHero > 0) {
        this.fxDamageLine(this.enemySprite, this.playerSprite, 0xff8844)
        this.flashSprite(this.playerSprite, 0xff4444)
        this.shakeSprite(this.playerSprite)
        this.floatNumber(this.playerSprite.x, this.playerSprite.y - 50, `-${fx.dmgToPlayerHero}`, '#ff6666')
      }
    })
    add(120, () => {
      if (fx.healPlayer > 0) {
        this.fxHealBurst(this.playerSprite.x, this.playerSprite.y)
        this.flashSprite(this.playerSprite, 0x44ff88)
        this.floatNumber(this.playerSprite.x, this.playerSprite.y - 70, `+${fx.healPlayer}`, '#88ffaa')
      }
    })
    add(100, () => {
      if (fx.healEnemy > 0) {
        this.fxHealBurst(this.enemySprite.x, this.enemySprite.y)
        this.flashSprite(this.enemySprite, 0x44ff88)
        this.floatNumber(this.enemySprite.x, this.enemySprite.y - 70, `+${fx.healEnemy}`, '#88ffaa')
      }
    })

    this.time.delayedCall(acc + 120, done)
  }

  private fxForCard(side: 'player' | 'enemy', card: CardDef, fx: TurnFxTotals): void {
    const spr = side === 'player' ? this.playerSprite : this.enemySprite
    if (card.kind === 'minion') {
      this.fxSkillCast(spr.x, spr.y)
    } else if (card.type === 'attack') {
      this.fxSwingWeapon(spr)
    } else if (card.type === 'defense') {
      this.fxShield(spr.x, spr.y)
    } else {
      this.fxSkillCast(spr.x, spr.y)
    }
    if (card.type === 'attack' && side === 'player' && fx.dmgToEnemyHero > 0) {
      this.cameras.main.shake(80, 0.002)
    }
    if (card.type === 'attack' && side === 'enemy' && fx.dmgToPlayerHero > 0) {
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
