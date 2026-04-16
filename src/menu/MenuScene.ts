import Phaser from 'phaser'
import {
  DEFAULT_BATTLE_CONFIG,
  loadBattleConfig,
  saveBattleConfig,
  type BattleConfig,
} from '../cardCombat/battleConfig'

const GOLD = '#c9a227'

/** Главное меню: настройки боя и запуск сцены CardCombat. */
export class MenuScene extends Phaser.Scene {
  private cfg: BattleConfig = { ...DEFAULT_BATTLE_CONFIG }
  private hpLabel!: Phaser.GameObjects.Text
  private timerLabel!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'MainMenu' })
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x0b0b12)
    this.cfg = loadBattleConfig()

    this.add
      .text(450, 48, 'Карточный бой', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '32px',
        color: '#f0ecf8',
      })
      .setOrigin(0.5, 0)

    this.add
      .text(450, 100, 'Настройте стартовое HP и длительность хода. Значения сохраняются в браузере.', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '13px',
        color: '#8a8298',
        align: 'center',
        wordWrap: { width: 760 },
      })
      .setOrigin(0.5, 0)

    this.hpLabel = this.add
      .text(450, 180, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '18px',
        color: '#e8e4f0',
      })
      .setOrigin(0.5, 0)

    this.timerLabel = this.add
      .text(450, 260, '', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '18px',
        color: '#e8e4f0',
      })
      .setOrigin(0.5, 0)

    this.refreshLabels()
    this.makeStepper(450, 210, 'HP', () => this.cfg.startHp, (v) => {
      this.cfg.startHp = v
      this.persist()
      this.refreshLabels()
    }, 20, 300, 10)

    this.makeStepper(450, 290, 'Секунд на ход', () => this.cfg.turnSeconds, (v) => {
      this.cfg.turnSeconds = v
      this.persist()
      this.refreshLabels()
    }, 5, 60, 1)

    const startBtn = this.add
      .text(450, 400, 'В бой', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '22px',
        color: GOLD,
        backgroundColor: '#1a1528',
        padding: { left: 28, right: 28, top: 12, bottom: 12 },
      })
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true })

    startBtn.on('pointerover', () => startBtn.setStyle({ backgroundColor: '#2a2040' }))
    startBtn.on('pointerout', () => startBtn.setStyle({ backgroundColor: '#1a1528' }))
    startBtn.on('pointerdown', () => {
      saveBattleConfig(this.cfg)
      this.scene.start('CardCombat', {
        startHp: this.cfg.startHp,
        turnSeconds: this.cfg.turnSeconds,
      })
    })
  }

  private persist(): void {
    saveBattleConfig(this.cfg)
  }

  private refreshLabels(): void {
    this.hpLabel.setText(`Стартовое HP (у каждого): ${this.cfg.startHp}`)
    this.timerLabel.setText(`Таймер хода: ${this.cfg.turnSeconds} с`)
  }

  private makeStepper(
    cx: number,
    y: number,
    _title: string,
    get: () => number,
    setVal: (v: number) => void,
    min: number,
    max: number,
    step: number
  ): void {
    const mkBtn = (label: string, dx: number, delta: number) => {
      const t = this.add
        .text(cx + dx, y, label, {
          fontFamily: 'system-ui,Segoe UI,sans-serif',
          fontSize: '18px',
          color: GOLD,
          backgroundColor: '#1a1528',
          padding: { left: 16, right: 16, top: 8, bottom: 8 },
        })
        .setOrigin(0.5, 0)
        .setInteractive({ useHandCursor: true })
      t.on('pointerdown', () => {
        const v = Phaser.Math.Clamp(get() + delta, min, max)
        setVal(v)
      })
    }
    mkBtn('−', -120, -step)
    mkBtn('+', 120, step)
  }
}
