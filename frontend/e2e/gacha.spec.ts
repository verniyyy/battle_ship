import { expect, test } from '@playwright/test'
import { newAdmiral, toHome } from './helpers'

const shots = 'e2e/results/shots'

test('the construction banner can be turned by hand: arrows, dots, swipe and keys', async ({ page }) => {
  await newAdmiral(page)
  await toHome(page)
  await page.locator('.menu-tile.gacha').click()
  const banner = page.locator('.banner-art')
  const name = banner.locator('.banner-copy b')
  const dots = banner.locator('.banner-dots button')
  await expect(dots.first()).toBeVisible()
  const n = await dots.count()
  expect(n).toBeGreaterThan(2)
  const names = await dots.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

  const shownIndex = async () => names.indexOf(await name.innerText())
  const start = await shownIndex()
  await page.screenshot({ path: `${shots}/gacha-banner.png` })

  // Next and back with the arrows.
  await page.getByRole('button', { name: '次の艦' }).click()
  await expect(name).toHaveText(names[(start + 1) % n]!)
  await expect(dots.nth((start + 1) % n)).toHaveClass(/on/)
  await page.getByRole('button', { name: '前の艦' }).click()
  await expect(name).toHaveText(names[start]!)

  // Straight to a ship by its dot.
  const pick = (start + 3) % n
  await dots.nth(pick).click()
  await expect(name).toHaveText(names[pick]!)

  // A swipe to the left shows the next one.
  const box = (await banner.boundingBox())!
  const y = box.y + box.height * 0.3
  await page.mouse.move(box.x + box.width * 0.7, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, y, { steps: 5 })
  await page.mouse.up()
  await expect(name).toHaveText(names[(pick + 1) % n]!)

  // And the arrow keys, once the banner has focus.
  await banner.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(name).toHaveText(names[pick]!)
  await page.screenshot({ path: `${shots}/gacha-banner-picked.png` })

  // A ship picked by hand stays up longer than the auto-advance's 3.2 s.
  await page.waitForTimeout(4500)
  await expect(name).toHaveText(names[pick]!)
})
