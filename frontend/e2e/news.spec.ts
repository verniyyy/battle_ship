import { expect, test } from '@playwright/test'
import { newAdmiral, toHome } from './helpers'
import { NEWS } from '../src/news'

const shots = 'e2e/results/shots'

test('news: unread updates pop up once at the harbour and stay read', async ({ page }) => {
  await newAdmiral(page)
  await toHome(page, { news: true })

  const dialog = page.getByRole('dialog', { name: 'お知らせ' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.news-list > li')).toHaveCount(NEWS.length)
  await expect(dialog.locator('.news-list > li').first()).toContainText(NEWS[0].title)
  await expect(dialog.locator('.news-new').first()).toBeVisible()
  await expect(page.locator('.menu-tile.news .badge')).toBeVisible()
  await page.screenshot({ path: `${shots}/news-dialog.png` })

  await dialog.getByRole('button', { name: '確認しました' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.menu-tile.news .badge')).toBeHidden()
  await expect(page.locator('.ticker')).toContainText(NEWS[0].title)

  // Read news stays read after a reload, and the tile still opens it.
  await page.reload()
  await page.locator('.title-screen').click()
  await expect(page.locator('.menu-tile.news')).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(dialog).toBeHidden()
  await page.locator('.menu-tile.news').click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.news-new')).toHaveCount(0)
  await page.screenshot({ path: `${shots}/news-read.png` })
})
