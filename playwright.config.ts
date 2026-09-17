import { defineConfig } from '@playwright/test'

/**
 * Electron smoke tests (§9 M5). These need a real Windows session with the
 * Electron binary installed — the pure logic lives in Vitest instead.
 */
export default defineConfig({
  testDir: './tests/smoke',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list']]
})
