import { expect, test } from '@playwright/test'
import { call, newAdmiral, toHome } from './helpers'

const shots = 'e2e/results/shots'

test.use({ deviceScaleFactor: 2 })

test('home menu: the harbour tiles carry an icon and both labels', async ({ page }) => {
  await newAdmiral(page)
  await toHome(page)
  const menu = page.locator('.home-menu')
  const tiles = menu.locator('.menu-tile')
  await expect(tiles).toHaveCount(10)
  for (const t of await tiles.all()) {
    await expect(t.locator('svg.menu-ico')).toBeVisible()
    await expect(t.locator('.menu-jp')).not.toBeEmpty()
    await expect(t.locator('.menu-en')).not.toBeEmpty()
  }
  // The labels are set in the bundled mincho, not a system fallback.
  expect(await page.evaluate(() => document.fonts.check('800 16px "Title Mincho"', '編成建造艦隊任務ログボフレンドランキング戦績要綱お知らせ'))).toBe(true)
  await expect(menu.getByRole('button', { name: '編成' })).toBeVisible()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${shots}/home.png` })
  await menu.locator('.menu-tile.dock').hover()
  await page.waitForTimeout(300)
  await menu.screenshot({ path: `${shots}/home-menu.png` })

  await menu.locator('.menu-tile.dock').click()
  await expect(page.locator('.home-menu')).toBeHidden()
})

test('home menu: tiles with something waiting light up', async ({ page }) => {
  // A new admiral who has neither taken the login bonus nor the free ten-pull.
  await page.goto('/')
  await call(page, 'POST', '/auth/dev', {})
  await call(page, 'POST', '/profile/name', { name: 'E2E提督', comment: '' })
  await toHome(page)
  const dialog = page.getByRole('dialog', { name: 'ログインボーナス' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '閉じる' }).click()
  const menu = page.locator('.home-menu')
  await expect(menu.locator('.menu-tile.login.hot .badge')).toBeVisible()
  await expect(menu.locator('.menu-tile.gacha.hot .badge')).toHaveText('無料10連')
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
  await menu.screenshot({ path: `${shots}/home-menu-hot.png` })
})
