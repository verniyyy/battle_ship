import { expect, test } from '@playwright/test'

// The 1280x720 stage must scale to fill the window and stay fully on screen,
// whatever the window size.
for (const size of [
  { width: 800, height: 600 },
  { width: 1000, height: 900 },
  { width: 1920, height: 1080 },
  { width: 600, height: 900 },
]) {
  test(`stage fits a ${size.width}x${size.height} window`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.goto('/')
    const stage = page.locator('.stage')
    await expect(stage).toBeVisible()
    const box = (await stage.boundingBox())!
    await page.screenshot({ path: `e2e/results/shots/viewport-${size.width}x${size.height}.png` })
    const scale = Math.min(size.width / 1280, size.height / 720)
    expect(box.width).toBeCloseTo(1280 * scale, 0)
    expect(box.height).toBeCloseTo(720 * scale, 0)
    expect(box.x).toBeCloseTo((size.width - box.width) / 2, 0)
    expect(box.y).toBeCloseTo((size.height - box.height) / 2, 0)
  })
}
