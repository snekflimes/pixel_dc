import Phaser from 'phaser'
import { ALL_CARD_IDS } from './cards'
import { Deck } from './deck'
import { resolveRound } from './resolveRound'
import type { CardDef } from './types'

const LOG_W = 176
const MAIN_X = LOG_W + 8
const TURN_SECONDS = 15
const START_HP = 100
const GOLD = 0xc9a227
const BG = 0x0b0b12

const TYPE_COLOR: Record<CardDef['type'], number> = {
  attack: 0xcc4444,
  defense: 0x4488cc,
  skill: 0xaa66cc,
}

type Phase = 'select' | 'resolve' | 'ended'

export class CardCombatScene extends Phaser.Scene {
  private playerDeck!: Deck
  private enemyDeck!: Deck
  private playerHp = START_HP
  private enemyHp = START_HP

  private playerHand: [CardDef, CardDef] | null = null
  private enemyHand: [CardDef, CardDef] | null = null

  private phase: Phase = 'select'
  private choiceLocked = false
  private remainingSec = TURN_SECONDS

  private logLines: string[] = []
  private logText!: Phaser.GameObjects.Text
  private timerText!: Phaser.GameObjects.Text
  private arenaText!: Phaser.GameObjects.Text
  private playerHpText!: Phaser.GameObjects.Text
  private enemyHpText!: Phaser.GameObjects.Text
  private playerHpBar!: Phaser.GameObjects.Graphics
  private enemyHpBar!: Phaser.GameObjects.Graphics

  private cardContainers: Phaser.GameObjects.Container[] = []

  constructor() {
    super({ key: 'CardCombat' })
  }

  create(): void {
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
      .text(MAIN_X, 230, '', {
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
        color: `#${GOLD.toString(16)}`,
      })
      .setOrigin(1, 0)

    this.arenaText = this.add
      .text(MAIN_X + 260, 120, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '15px',
        color: '#9a93a8',
        align: 'center',
      })
      .setOrigin(0.5, 0)

    this.appendLog('Карточный бой (MVP): выберите одну из двух карт за 15 с.')
    this.appendLog('Противник — ИИ; его карты скрыты до раскрытия.')

    this.playerDeck = new Deck(ALL_CARD_IDS, () => Math.random())
    this.enemyDeck = new Deck(ALL_CARD_IDS, () => Math.random())

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
    const ew = (maxW * Math.max(0, this.enemyHp)) / START_HP
    this.enemyHpBar.fillStyle(0xcc3333, 1)
    this.enemyHpBar.fillRect(ex, ey, ew, h)
    this.enemyHpBar.lineStyle(1, GOLD, 0.6)
    this.enemyHpBar.strokeRect(ex, ey, maxW, h)

    const py = 256
    this.playerHpBar.clear()
    this.playerHpBar.fillStyle(0x182a18, 1)
    this.playerHpBar.fillRect(ex, py, maxW, h)
    const pw = (maxW * Math.max(0, this.playerHp)) / START_HP
    this.playerHpBar.fillStyle(0x33aa55, 1)
    this.playerHpBar.fillRect(ex, py, pw, h)
    this.playerHpBar.lineStyle(1, GOLD, 0.6)
    this.playerHpBar.strokeRect(ex, py, maxW, h)

    this.enemyHpText.setText(`Противник — ${this.enemyHp} / ${START_HP}`)
    this.playerHpText.setText(`Вы — ${this.playerHp} / ${START_HP}`)
  }

  private clearCardPanel(): void {
    for (const c of this.cardContainers) {
      c.destroy(true)
    }
    this.cardContainers = []
  }

  private startRound(): void {
    if (this.phase === 'ended') return

    this.phase = 'select'
    this.choiceLocked = false
    this.remainingSec = TURN_SECONDS
    this.updateTimerDisplay()

    this.playerHand = this.playerDeck.drawTwo()
    this.enemyHand = this.enemyDeck.drawTwo()

    this.clearCardPanel()
    this.arenaText.setText('Выберите карту.\nКарты противника скрыты.')

    this.layoutPlayerCards()
    this.redrawHpBars()
  }

  private layoutPlayerCards(): void {
    if (!this.playerHand) return
    const baseY = 300
    const rowH = 118
    for (let i = 0; i < 2; i++) {
      const card = this.playerHand[i]!
      const y = baseY + i * rowH
      const cont = this.buildCardButton(card, MAIN_X, y, i as 0 | 1)
      this.cardContainers.push(cont)
    }
  }

  private buildCardButton(card: CardDef, x: number, y: number, index: 0 | 1): Phaser.GameObjects.Container {
    const w = 500
    const h = 108
    const container = this.add.container(x, y)

    const bg = this.add.graphics()
    bg.fillStyle(0x1a1a24, 1)
    bg.fillRoundedRect(0, 0, w, h, 8)
    bg.lineStyle(3, TYPE_COLOR[card.type], 1)
    bg.strokeRoundedRect(0, 0, w, h, 8)

    const typeLabel =
      card.type === 'attack' ? 'Атака' : card.type === 'defense' ? 'Защита' : 'Навык'
    const stat =
      card.type === 'attack'
        ? `Урон ${card.damage ?? 0}`
        : card.type === 'defense'
          ? `Блок ${card.block ?? 0}`
          : `Лечение +${card.heal ?? 0}`

    const title = this.add
      .text(14, 10, card.name, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '17px',
        color: '#f0ecf8',
      })
      .setOrigin(0, 0)

    const meta = this.add
      .text(14, 36, `${typeLabel} · ${stat}`, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '13px',
        color: '#a8a0b8',
      })
      .setOrigin(0, 0)

    const desc = this.add
      .text(14, 58, card.description, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '12px',
        color: '#8a8298',
        wordWrap: { width: w - 28 },
      })
      .setOrigin(0, 0)

    const rowTag = this.add
      .text(w - 14, 10, `Ряд ${index + 1}`, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '12px',
        color: '#c9a227',
      })
      .setOrigin(1, 0)

    const hit = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0)
    hit.setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => {
      bg.clear()
      bg.fillStyle(0x242432, 1)
      bg.fillRoundedRect(0, 0, w, h, 8)
      bg.lineStyle(3, TYPE_COLOR[card.type], 1)
      bg.strokeRoundedRect(0, 0, w, h, 8)
    })
    hit.on('pointerout', () => {
      bg.clear()
      bg.fillStyle(0x1a1a24, 1)
      bg.fillRoundedRect(0, 0, w, h, 8)
      bg.lineStyle(3, TYPE_COLOR[card.type], 1)
      bg.strokeRoundedRect(0, 0, w, h, 8)
    })
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

    this.arenaText.setText(
      `Раскрытие:\nВы — «${pCard.name}»\nПротивник — «${eCard.name}»`
    )

    for (const line of res.lines) {
      this.appendLog(line)
    }

    this.playerHp = Math.max(
      0,
      this.playerHp - res.dmgToPlayer + res.healPlayer
    )
    this.enemyHp = Math.max(
      0,
      this.enemyHp - res.dmgToEnemy + res.healEnemy
    )

    this.redrawHpBars()

    this.appendLog(
      `Итог по HP: вы ${this.playerHp}, противник ${this.enemyHp}.`
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
      return
    }

    this.time.delayedCall(2200, () => {
      this.startRound()
    })
  }
}
