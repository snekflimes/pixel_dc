import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview:e2e',
    url: 'http://127.0.0.1:4173/',
    // Иначе после npm run build:e2e Playwright поднимет старый preview с другим хешем чанков → 404 на .js.
    reuseExistingServer: process.env.PW_REUSE_PREVIEW === '1',
    timeout: 60_000,
  },
})
