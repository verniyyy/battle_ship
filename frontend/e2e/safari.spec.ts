import { expect, test } from '@playwright/test'
import { newAdmiral, toHome } from './helpers'

// Layout checks in WebKit, Safari's engine, at a phone-sized window where the
// stage is zoomed down (see Stage): Safari treats zoom differently from Chrome.
test.use({ browserName: 'webkit', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true })

test('card portraits keep their framing under the zoomed stage', async ({ page }) => {
  // The Linux WebKit build stalls on the game's audio graph; this is about layout.
  await page.addInitScript(() => ((window as unknown as { AudioContext?: unknown }).AudioContext = undefined))
  await newAdmiral(page)
  await toHome(page)
  await page.locator('.menu-tile.dock').click({ force: true })
  const imgs = page.locator('.roster-grid .card .portrait-img.bust')
  await expect(imgs.first()).toBeVisible()
  // Safari zooms cq units a second time; framed in them, the figures came out about half size.
  // The bust is the face box scaled to --face-h of the art's height, wherever it is laid out.
  const off = await imgs.evaluateAll((els) =>
    els.map((img) => {
      const art = img.closest('.ship-art')!
      const want = (Number(getComputedStyle(art).getPropertyValue('--face-h')) / Number((img as HTMLElement).style.getPropertyValue('--fh'))) * art.getBoundingClientRect().height
      return Math.abs(img.getBoundingClientRect().height / want - 1)
    }),
  )
  expect(off.length).toBeGreaterThan(0)
  for (const o of off) expect(o).toBeLessThan(0.02)
})
