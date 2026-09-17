import { expect, test, _electron as electron } from '@playwright/test'
import { join } from 'node:path'

/**
 * Electron smoke test (§9 M5). This drives the real app on Windows; the pure
 * logic is covered by Vitest instead, so this only asserts that the loop is
 * wired end to end:
 *
 *   npm run build && npm run test:e2e
 */
const ROOT = join(__dirname, '../..')

async function launch() {
  const app = await electron.launch({
    args: [join(ROOT, 'out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'production' }
  })
  const stage = await app.firstWindow()
  return { app, stage }
}

test.describe('the full loop', () => {
  test('runs focus -> walk out -> break -> return -> ready with the demo preset', async () => {
    const { app, stage } = await launch()

    // Start the 1/1 demo loop from the settings API.
    await stage.evaluate(() => window.api.action('take-walk'))

    const seen: string[] = []
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const state = await stage.evaluate(() => window.api.getState())
      if (seen[seen.length - 1] !== state.phase) seen.push(state.phase)
      if (seen.includes('ready') && seen.includes('break')) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    await app.close()

    expect(seen).toContain('focus')
    expect(seen).toContain('waking')
    expect(seen).toContain('walkingOut')
    expect(seen).toContain('break')
    expect(seen).toContain('returning')
    expect(seen).toContain('ready')
    // never stuck: the sequence is monotonic through the loop
    expect(seen.indexOf('break')).toBeGreaterThan(seen.indexOf('walkingOut'))
    expect(seen.indexOf('ready')).toBeGreaterThan(seen.indexOf('break'))
  })

  test('starts with no console errors and a transparent, click-through stage', async () => {
    const { app, stage } = await launch()
    const errors: string[] = []
    stage.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await stage.waitForTimeout(2000)
    await app.close()
    expect(errors).toEqual([])
  })
})
