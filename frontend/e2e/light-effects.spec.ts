import { expect, test, type Page } from '@playwright/test'
import { newAdmiral, toHome } from './helpers'

const shots = 'e2e/results/shots'

/** Elements of the page that a CSS animation is moving right now, by class. */
const moving = (page: Page, selector: string) =>
  page.evaluate(
    (sel) =>
      document.getAnimations().filter((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target
        return t instanceof Element && !!t.closest(sel) && a.playState === 'running'
      }).length,
    selector,
  )

test.describe('on a phone', () => {
  test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })

  test('light effects are on by default and hold the decorative loops still', async ({ page }) => {
    await newAdmiral(page)
    await toHome(page)
    await expect(page.locator('html')).toHaveClass(/lowfx/)
    // The harbour's twinkling stars and glints on the water stand still.
    expect(await moving(page, '.sc-stars, .sc-glints')).toBe(0)

    await page.locator('.menu-tile.formation').click()
    await expect(page.locator('.roster-grid .card').first()).toBeVisible()
    await page.waitForTimeout(600)
    // No card on the screen, in the slots or the roster, animates its art.
    expect(await moving(page, '.ship-art')).toBe(0)
    await page.screenshot({ path: `${shots}/light-formation.png` })

    // Idle full-stage overlays are hidden, so they aren't layers over everything.
    await expect(page.locator('.curtain')).toBeHidden()
    expect(await page.locator('.stage > .fx-canvas').evaluate((c) => getComputedStyle(c).visibility)).toBe('hidden')

    // The sound panel switches back to the full effects, and the choice is kept.
    await page.getByRole('button', { name: 'サウンド設定' }).click()
    await page.getByRole('radio', { name: '標準' }).click()
    await expect(page.locator('html')).not.toHaveClass(/lowfx/)
    await page.reload()
    await expect(page.locator('html')).not.toHaveClass(/lowfx/)
  })
})

test('on a desktop the full effects play, and list cards still hold still', async ({ page }) => {
  await newAdmiral(page)
  await toHome(page)
  await expect(page.locator('html')).not.toHaveClass(/lowfx/)
  expect(await moving(page, '.scenery')).toBeGreaterThan(0)

  await page.locator('.menu-tile.formation').click()
  await expect(page.locator('.roster-grid .card').first()).toBeVisible()
  await page.waitForTimeout(600)
  expect(await moving(page, '.roster-grid .ship-art')).toBe(0)
})
