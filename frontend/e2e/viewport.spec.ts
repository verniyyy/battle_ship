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

// Shrunk to a phone, the stage is zoomed rather than scaled (see Stage)...
test('a phone-sized stage is zoomed', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/')
  const stage = page.locator('.stage')
  await expect(stage).toBeVisible()
  expect(await stage.evaluate((e) => e.style.zoom)).not.toBe('')
  expect(await stage.evaluate((e) => e.style.transform)).toBe('')
})

// ...unless zoom keeps small text from shrinking, as shipping Safari does: it
// draws no font of 9px or more below 9px. Stand-in: the probe's half-size text
// is drawn at 9px. Then the stage keeps the scale transform, and its text
// shrinks with it.
test('a phone-sized stage is scaled where zoom would not shrink text', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.route('/', async (route) => {
    const res = await route.fetch()
    const css = '<style>[style*="zoom: 0.5;"] { font-size: 18px !important }</style>'
    await route.fulfill({ response: res, body: (await res.text()).replace('</head>', `${css}</head>`) })
  })
  await page.goto('/')
  const stage = page.locator('.stage')
  await expect(stage).toBeVisible()
  expect(await stage.evaluate((e) => e.style.zoom)).toBe('')
  expect(await stage.evaluate((e) => e.style.transform)).toMatch(/^scale\(/)
  const box = (await stage.boundingBox())!
  const scale = Math.min(844 / 1280, 390 / 720)
  expect(box.width).toBeCloseTo(1280 * scale, 0)
  expect(box.height).toBeCloseTo(720 * scale, 0)
})
