import { expect, test } from '@playwright/test'
import { call } from './helpers'

// The title logo matches the key visual (og.png / X header): its web fonts must load, not fall back.
test('title screen shows the key-visual logo', async ({ page }) => {
  await page.goto('/')
  const logo = page.locator('.title-logo')
  await expect(logo.locator('.title-jp')).toHaveText('蒼海戦記')
  await expect(logo.locator('.title-en')).toHaveText('BATTLE SHIP')
  // document.fonts.check() is true for families with no face at all, so look at the faces themselves.
  const loaded = () => page.evaluate(() => [...document.fonts].filter((f) => f.family.startsWith('Title') && f.status === 'loaded').length)
  await expect.poll(loaded).toBe(3)
  await page.waitForTimeout(1200) // let the logo's entrance settle
  await page.screenshot({ path: 'e2e/results/shots/title-signed-out.png' })

  await call(page, 'POST', '/auth/dev', {})
  await page.reload()
  await expect(page.locator('.tap-to-start')).toHaveText('TAP TO START')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'e2e/results/shots/title.png' })
})
