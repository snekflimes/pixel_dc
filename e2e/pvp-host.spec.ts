import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const PEER_PORT = Number(process.env.PEER_PORT ?? 9000)

function waitForPort(port: number, ms = 15000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    function tryOnce(): void {
      const s = createConnection({ port, host: '127.0.0.1' }, () => {
        s.end()
        resolve()
      })
      s.on('error', () => {
        if (Date.now() - start > ms) {
          reject(new Error(`порт ${port} не открылся за ${ms}ms`))
        } else {
          setTimeout(tryOnce, 80)
        }
      })
    }
    tryOnce()
  })
}

let peerProc: ChildProcess | undefined

test.beforeAll(async () => {
  peerProc = spawn(process.execPath, ['scripts/peer-signal.mjs'], {
    cwd: root,
    env: { ...process.env, PEER_PORT: String(PEER_PORT) },
    stdio: 'pipe',
  })
  await waitForPort(PEER_PORT)
})

test.afterAll(() => {
  peerProc?.kill('SIGTERM')
})

test('PvP host: нет ошибки server-error после запуска сцены', async ({ page }) => {
  test.setTimeout(120_000)
  const dialogs: string[] = []
  page.on('dialog', async (d) => {
    dialogs.push(d.message())
    await d.dismiss().catch(() => {})
  })
  page.on('pageerror', (e) => {
    console.error('[pageerror]', e)
  })

  await page.goto(`/pixeldc/`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForSelector('#app canvas', { timeout: 90_000 })
  await page.waitForFunction(
    () =>
      !!(globalThis as unknown as { __PIXEL_DC_PHASER_GAME__?: unknown }).__PIXEL_DC_PHASER_GAME__,
    null,
    { timeout: 30_000 }
  )

  await page.evaluate(() => {
    const game = (
      globalThis as unknown as {
        __PIXEL_DC_PHASER_GAME__: { scene: { start: (key: string, data?: object) => void } }
      }
    ).__PIXEL_DC_PHASER_GAME__
    game.scene.start('CardCombat', {
      mode: 'pvp_host',
      startHp: 12,
      turnSeconds: 15,
    })
  })

  await page.waitForTimeout(18000)

  const hasServerError = dialogs.some((d) => d.includes('server-error'))
  expect(hasServerError, `alerts: ${JSON.stringify(dialogs)}`).toBe(false)
})
