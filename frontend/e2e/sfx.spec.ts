import { expect, test } from '@playwright/test'
import { cell, newAdmiral, toBattle } from './helpers'

const shots = 'e2e/results/shots'

interface Played {
  duration: number
  rate: number
  peak: number
  finite: boolean
}

// Gunfire is modelled in a worker (src/blast.ts) and comes back as sample buffers: a shot
// has to start the worker and play a long, audible, well-formed explosion, not silence or NaN.
test('a broadside plays modelled gunfire rendered in the worker', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    const w = window as unknown as { workers: string[]; played: Played[] }
    w.workers = []
    w.played = []
    const Native = window.Worker
    window.Worker = class extends Native {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts)
        w.workers.push(String(url))
      }
    }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      const b = this.buffer
      if (b && !this.loop) {
        const d = b.getChannelData(0)
        let peak = 0
        let finite = true
        for (let i = 0; i < d.length; i++) {
          if (!Number.isFinite(d[i])) finite = false
          peak = Math.max(peak, Math.abs(d[i]))
        }
        w.played.push({ duration: b.duration, rate: b.sampleRate, peak, finite })
      }
      return start.apply(this, args)
    }
  })

  const p = await newAdmiral(page)
  const uid = (card: string) => p.ships.find((s) => s.card === card)!.uid
  await toBattle(page, [uid('bb_kurogane'), uid('dd_asanagi'), uid('ss_senryu')], [
    { row: 0, col: 0 },
    { row: 4, col: 0 },
    { row: 4, col: 4 },
  ])
  await page.locator('[data-plate="p0"]').click()
  await page.locator('.cmd-btn.attack').click()
  await cell(page, 2, 2).click()
  await page.locator('.cmd-btn.go').click()

  // The battleship's guns (and the enemy's reply) roll on for seconds.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { played: Played[] }).played.filter((b) => b.rate === 24000 && b.duration > 1.8)), { timeout: 20_000 })
    .not.toHaveLength(0)
  await page.screenshot({ path: `${shots}/broadside.png` })
  const { workers, played } = await page.evaluate(() => {
    const w = window as unknown as { workers: string[]; played: Played[] }
    return { workers: w.workers, played: w.played }
  })
  expect(workers.some((u) => u.includes('blast.worker'))).toBeTruthy()
  for (const b of played.filter((b) => b.rate === 24000 && b.duration > 1.8)) {
    expect(b.finite).toBeTruthy()
    expect(b.peak).toBeGreaterThan(0.01)
    expect(b.peak).toBeLessThanOrEqual(1.5)
  }
  expect(errors).toEqual([])
})
