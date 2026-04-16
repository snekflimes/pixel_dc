import Phaser from 'phaser'
import {
  DEFAULT_BATTLE_CONFIG,
  loadBattleConfig,
  saveBattleConfig,
  type BattleConfig,
} from '../cardCombat/battleConfig'
import { openCardDatabaseEditor } from '../cardEditor/cardDbPanel'

const GOLD = '#c9a227'
const PANEL = 0x12121a
const PANEL_STROKE = 0x2a2a38

type Btn = {
  bg: Phaser.GameObjects.Graphics
  text: Phaser.GameObjects.Text
  w: number
  h: number
  destroy: () => void
  setPos: (x: number, y: number) => void
  setDisabled: (v: boolean) => void
}

/** Главное меню: настройки боя и запуск сцены CardCombat. */
export class MenuScene extends Phaser.Scene {
  private cfg: BattleConfig = { ...DEFAULT_BATTLE_CONFIG }
  private hpLabel!: Phaser.GameObjects.Text
  private timerLabel!: Phaser.GameObjects.Text
  private ui: {
    title?: Phaser.GameObjects.Text
    subtitle?: Phaser.GameObjects.Text
    panel?: Phaser.GameObjects.Graphics
    hp?: Phaser.GameObjects.Text
    timer?: Phaser.GameObjects.Text
    stepHpMinus?: Btn
    stepHpPlus?: Btn
    stepTimerMinus?: Btn
    stepTimerPlus?: Btn
    btnAi?: Btn
    btnCards?: Btn
    btnPvpHost?: Btn
    btnPvpJoin?: Btn
    hintPvp?: Phaser.GameObjects.Text
  } = {}

  constructor() {
    super({ key: 'MainMenu' })
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x0b0b12)
    this.cfg = loadBattleConfig()

    this.ui.title = this.add
      .text(0, 0, 'Pixel DC', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '34px',
        color: '#f0ecf8',
        fontStyle: '600',
      })
      .setOrigin(0.5, 0)

    this.ui.subtitle = this.add
      .text(0, 0, 'Карточный бой 2×4. Все карты открыты, активный столбец идёт слева направо.', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '13px',
        color: '#9a93a8',
        align: 'center',
        wordWrap: { width: 760 },
      })
      .setOrigin(0.5, 0)

    this.ui.panel = this.add.graphics()

    this.hpLabel = this.add.text(0, 0, '', {
      fontFamily: 'system-ui,Segoe UI,sans-serif',
      fontSize: '16px',
      color: '#e8e4f0',
    })
    this.timerLabel = this.add.text(0, 0, '', {
      fontFamily: 'system-ui,Segoe UI,sans-serif',
      fontSize: '16px',
      color: '#e8e4f0',
    })

    this.refreshLabels()

    this.ui.stepHpMinus = this.makeButton('−', () => {
      const v = Phaser.Math.Clamp(this.cfg.startHp - 2, 4, 48)
      this.cfg.startHp = v
      this.persist()
      this.refreshLabels()
    }, { w: 56 })
    this.ui.stepHpPlus = this.makeButton('+', () => {
      const v = Phaser.Math.Clamp(this.cfg.startHp + 2, 4, 48)
      this.cfg.startHp = v
      this.persist()
      this.refreshLabels()
    }, { w: 56 })

    this.ui.stepTimerMinus = this.makeButton('−', () => {
      const v = Phaser.Math.Clamp(this.cfg.turnSeconds - 1, 5, 60)
      this.cfg.turnSeconds = v
      this.persist()
      this.refreshLabels()
    }, { w: 56 })
    this.ui.stepTimerPlus = this.makeButton('+', () => {
      const v = Phaser.Math.Clamp(this.cfg.turnSeconds + 1, 5, 60)
      this.cfg.turnSeconds = v
      this.persist()
      this.refreshLabels()
    }, { w: 56 })

    this.ui.btnCards = this.makeButton('Редактор карт', () => {
      void openCardDatabaseEditor()
    }, { w: 320 })

    this.ui.btnAi = this.makeButton('В бой (против ИИ)', () => {
      saveBattleConfig(this.cfg)
      this.scene.start('CardCombat', {
        startHp: this.cfg.startHp,
        turnSeconds: this.cfg.turnSeconds,
        mode: 'ai',
      })
    }, { w: 320, fontSize: 18, primary: true })

    this.ui.btnPvpHost = this.makeButton('PvP — создать комнату', () => {
      saveBattleConfig(this.cfg)
      this.scene.start('CardCombat', {
        startHp: this.cfg.startHp,
        turnSeconds: this.cfg.turnSeconds,
        mode: 'pvp_host',
      })
    }, { w: 320 })

    this.ui.btnPvpJoin = this.makeButton('PvP — подключиться', () => {
      const code = window.prompt('Вставьте код комнаты от хоста (из строки PeerJS):', '')
      if (!code?.trim()) return
      saveBattleConfig(this.cfg)
      this.scene.start('CardCombat', {
        startHp: this.cfg.startHp,
        turnSeconds: this.cfg.turnSeconds,
        mode: 'pvp_client',
        hostPeerId: code.trim(),
      })
    }, { w: 320 })

    this.ui.hintPvp = this.add
      .text(0, 0, 'PvP временно нестабильный — мы его отложили.', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '12px',
        color: '#7a7388',
      })
      .setOrigin(0.5, 0)

    // Пока PvP отложили — визуально приглушим кнопки.
    this.ui.btnPvpHost.setDisabled(true)
    this.ui.btnPvpJoin.setDisabled(true)

    this.scale.on('resize', () => this.layout())
    this.layout()
  }

  private persist(): void {
    saveBattleConfig(this.cfg)
  }

  private refreshLabels(): void {
    this.hpLabel.setText(`Стартовое HP (у каждого): ${this.cfg.startHp}`)
    this.timerLabel.setText(`Таймер хода: ${this.cfg.turnSeconds} с`)
  }

  private layout(): void {
    const w = this.scale.width
    const h = this.scale.height

    const cx = w / 2
    const top = Math.max(18, Math.round(h * 0.06))
    const panelW = Math.min(420, Math.round(w * 0.92))
    const panelX = cx - panelW / 2
    const rowGap = 14

    this.ui.title?.setPosition(cx, top)
    this.ui.subtitle?.setPosition(cx, top + 44)
    this.ui.subtitle?.setWordWrapWidth(Math.min(760, Math.round(w * 0.92)))

    // Панель с настройками и кнопками
    const panelTop = top + 86
    const panelH = Math.min(Math.round(h - panelTop - 18), 420)

    this.ui.panel?.clear()
    this.ui.panel?.fillStyle(PANEL, 0.96)
    this.ui.panel?.fillRoundedRect(panelX, panelTop, panelW, panelH, 12)
    this.ui.panel?.lineStyle(1, PANEL_STROKE, 1)
    this.ui.panel?.strokeRoundedRect(panelX, panelTop, panelW, panelH, 12)

    const innerX = panelX + 18
    const innerW = panelW - 36
    let y = panelTop + 18

    // HP row
    this.hpLabel.setPosition(innerX, y)
    this.hpLabel.setOrigin(0, 0)
    this.ui.stepHpMinus?.setPos(panelX + panelW - 18 - 56 - 10 - 56, y - 4)
    this.ui.stepHpPlus?.setPos(panelX + panelW - 18 - 56, y - 4)
    y += 34 + rowGap

    // Timer row
    this.timerLabel.setPosition(innerX, y)
    this.timerLabel.setOrigin(0, 0)
    this.ui.stepTimerMinus?.setPos(panelX + panelW - 18 - 56 - 10 - 56, y - 4)
    this.ui.stepTimerPlus?.setPos(panelX + panelW - 18 - 56, y - 4)
    y += 34 + rowGap + 6

    const btnX = cx
    const btnW = Math.min(360, innerW)

    this.ui.btnCards?.setPos(btnX, y)
    this.ui.btnCards!.w = btnW
    this.ui.btnCards!.setPos(btnX, y)
    y += this.ui.btnCards!.h + rowGap

    this.ui.btnAi?.setPos(btnX, y)
    this.ui.btnAi!.w = btnW
    this.ui.btnAi!.setPos(btnX, y)
    y += this.ui.btnAi!.h + rowGap

    this.ui.btnPvpHost?.setPos(btnX, y)
    this.ui.btnPvpHost!.w = btnW
    this.ui.btnPvpHost!.setPos(btnX, y)
    y += this.ui.btnPvpHost!.h + 10

    this.ui.btnPvpJoin?.setPos(btnX, y)
    this.ui.btnPvpJoin!.w = btnW
    this.ui.btnPvpJoin!.setPos(btnX, y)
    y += this.ui.btnPvpJoin!.h + 10

    this.ui.hintPvp?.setPosition(btnX, Math.min(panelTop + panelH - 18, y + 6))
  }

  private makeButton(
    label: string,
    onClick: () => void,
    opts?: { w?: number; h?: number; fontSize?: number; primary?: boolean }
  ): Btn {
    const w = opts?.w ?? 320
    const h = opts?.h ?? 44
    const fontSize = opts?.fontSize ?? 15
    const primary = opts?.primary ?? false

    const bg = this.add.graphics()
    const text = this.add.text(0, 0, label, {
      fontFamily: 'system-ui,Segoe UI,sans-serif',
      fontSize: `${fontSize}px`,
      color: primary ? GOLD : '#e8e4f0',
    })
    text.setOrigin(0.5, 0.5)

    let disabled = false

    const redraw = (x: number, y: number, hover = false) => {
      const fill = disabled ? 0x141420 : hover ? 0x242432 : 0x1a1a24
      const stroke = primary ? 0xc9a227 : 0x2a2a38
      bg.clear()
      bg.fillStyle(fill, 1)
      bg.fillRoundedRect(x - w / 2, y - h / 2, w, h, 10)
      bg.lineStyle(1, stroke, disabled ? 0.35 : 0.85)
      bg.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 10)
      text.setPosition(x, y)
      text.setAlpha(disabled ? 0.45 : 1)
    }

    const hit = this.add.rectangle(0, 0, w, h, 0x000000, 0)
    hit.setInteractive({ useHandCursor: true })

    let px = 0
    let py = 0
    const setPos = (x: number, y: number) => {
      px = x
      py = y
      hit.setPosition(x, y)
      hit.setSize(w, h)
      redraw(x, y, false)
    }

    hit.on('pointerover', () => redraw(px, py, true))
    hit.on('pointerout', () => redraw(px, py, false))
    hit.on('pointerdown', () => {
      if (disabled) return
      onClick()
    })

    const setDisabled = (v: boolean) => {
      disabled = v
      redraw(px, py, false)
      hit.input?.enabled && (hit.input.enabled = !v)
    }

    setPos(0, 0)

    return {
      bg,
      text,
      w,
      h,
      destroy: () => {
        hit.destroy()
        text.destroy()
        bg.destroy()
      },
      setPos,
      setDisabled,
    }
  }
}
