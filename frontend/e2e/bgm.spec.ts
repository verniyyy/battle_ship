import { expect, test } from '@playwright/test'
import { newAdmiral, toBattle } from './helpers'

test('a regular battle loops the recorded battle theme', async ({ page }) => {
  // Note every buffer the game starts looping, by length.
  await page.addInitScript(() => {
    const w = window as unknown as { loops: number[] }
    w.loops = []
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if (this.loop && this.buffer) w.loops.push(this.buffer.duration)
      return start.apply(this, args)
    }
  })
  const p = await newAdmiral(page)
  const bgm = page.waitForResponse('**/bgm/battle.mp3')
  await toBattle(page, p.ships.slice(0, 3).map((s) => s.uid), [
    { row: 0, col: 0 },
    { row: 2, col: 0 },
    { row: 4, col: 0 },
  ])
  const res = await bgm
  expect(res.ok()).toBeTruthy()
  expect(res.headers()['content-type']).toContain('audio/mpeg')
  // The theme is minutes long; the sea ambience and baked effects are seconds.
  await expect.poll(() => page.evaluate(() => (window as unknown as { loops: number[] }).loops.some((d) => d > 60))).toBe(true)
})
