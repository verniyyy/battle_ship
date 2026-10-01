import { expect, test } from '@playwright/test'
import { newAdmiral, toBattle } from './helpers'
import type { MatchResponse } from '../src/types'

for (const { name, boss, file } of [
  { name: 'a regular battle', boss: false, file: 'battle' },
  { name: 'a flagship battle', boss: true, file: 'boss' },
]) {
  test(`${name} loops its recorded theme`, async ({ page }) => {
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
    // A new admiral can't reach a flagship stage yet, so the first one is dressed up as one.
    if (boss)
      await page.route('**/api/games/current', async (route) => {
        const res = await route.fetch()
        const m = (await res.json()) as MatchResponse
        m.stage.boss = true
        await route.fulfill({ response: res, json: m })
      })
    const bgm = page.waitForResponse(`**/bgm/${file}.mp3`)
    await toBattle(page, p.ships.slice(0, 3).map((s) => s.uid), [
      { row: 0, col: 0 },
      { row: 2, col: 0 },
      { row: 4, col: 0 },
    ])
    const res = await bgm
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-type']).toContain('audio/mpeg')
    // What loops is this theme, told apart from the other by its length.
    const want = await page.evaluate(async (url) => {
      const data = await (await fetch(url)).arrayBuffer()
      return (await new OfflineAudioContext(2, 1, 44100).decodeAudioData(data)).duration
    }, `/bgm/${file}.mp3`)
    expect(want).toBeGreaterThan(60)
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { loops: number[] }).loops))
      .toContainEqual(expect.closeTo(want, 0.1))
  })
}
