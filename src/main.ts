import './style.css'
import Phaser from 'phaser'
import { CardCombatScene } from './cardCombat/CardCombatScene'

function initTelegram(): void {
  const tg = (window as unknown as { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } } })
    .Telegram?.WebApp
  tg?.ready?.()
  tg?.expand?.()
}

initTelegram()

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: 900,
  height: 560,
  backgroundColor: '#0b0b12',
  scene: [CardCombatScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
}

/** Один Game на страницу: повторный init (редкий двойной import) не копит WebGL/сцены. */
const g = globalThis as unknown as { __PIXEL_DC_PHASER_GAME__?: Phaser.Game }
if (g.__PIXEL_DC_PHASER_GAME__) {
  g.__PIXEL_DC_PHASER_GAME__.destroy(true, false)
  g.__PIXEL_DC_PHASER_GAME__ = undefined
}
g.__PIXEL_DC_PHASER_GAME__ = new Phaser.Game(config)
