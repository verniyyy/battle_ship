import { expect, test } from '@playwright/test'
import { newAdmiral, toBattle } from './helpers'
import type { MatchResponse } from '../src/types'

// roll stands in for Math.random, which picks among a track's recordings: 0 the first, 0.99 the last.
for (const { name, boss, roll, file } of [
  { name: 'a regular battle', boss: false, roll: 0, file: 'battle' },
  { name: 'another regular battle', boss: false, roll: 0.99, file: 'battle2' },
  { name: 'a flagship battle', boss: true, roll: 0, file: 'boss' },
]) {
  test(`${name} loops the recorded ${file} theme`, async ({ page }) => {
    await page.addInitScript((r) => (Math.random = () => r), roll)
    // Note every media element the game plays, and every decode it asks for.
    await page.addInitScript(() => {
      const w = window as unknown as { media: Set<HTMLMediaElement>; decodes: number }
      w.media = new Set()
      w.decodes = 0
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () {
        w.media.add(this)
        return play.call(this)
      }
      const decode = BaseAudioContext.prototype.decodeAudioData
      BaseAudioContext.prototype.decodeAudioData = function (...args: Parameters<typeof decode>) {
        w.decodes++
        return decode.apply(this, args)
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
    // Only this theme keeps playing, on a loop (the others were only started to unlock them).
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...(window as unknown as { media: Set<HTMLMediaElement> }).media].filter((m) => !m.paused).map((m) => `${new URL(m.src).pathname} ${m.loop}`),
        ),
      )
      .toEqual([`/bgm/${file}.mp3 true`])
    // Streamed, never decoded: a decoded track holds well over 100MB, enough for a phone to drop the tab.
    expect(await page.evaluate(() => (window as unknown as { decodes: number }).decodes)).toBe(0)
  })
}
