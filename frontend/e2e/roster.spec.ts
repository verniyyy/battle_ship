import { expect, test } from '@playwright/test'
import { call, newAdmiral, toHome } from './helpers'
import type { Profile } from '../src/types'

const shots = 'e2e/results/shots'

test('fleet roster: one tap trains to the max, list cards stay light', async ({ page }) => {
  const start = await newAdmiral(page)
  await toHome(page)
  await page.locator('.menu-tile.dock').click()
  const detail = page.locator('.ship-detail')
  await expect(detail).toBeVisible()

  // Roster cards run no canvas motion effects and draw no glints.
  await expect(page.locator('.dock-list .roster-grid .card').first()).toBeVisible()
  expect(await page.locator('.dock-list canvas').count()).toBe(0)
  expect(await page.locator('.dock-list .art-glint').count()).toBe(0)
  expect(await page.locator('.dock-list .roster-grid > .card').first().evaluate((e) => getComputedStyle(e).contentVisibility)).toBe('auto')

  const flagship = start.ships.find((s) => s.uid === start.fleet[0])!
  const max = page.locator('.train-max')
  await expect(max).toContainText(`Lv.${flagship.maxTrainLevel}`)
  await expect(max).toContainText(flagship.maxTrainCost.toLocaleString())
  await page.screenshot({ path: `${shots}/dock-before.png` })

  const trains: string[] = []
  page.on('request', (r) => r.url().includes('/train') && trains.push(r.url()))
  await max.click()
  await expect(detail.locator('.detail-level b')).toHaveText(String(flagship.maxTrainLevel))
  await expect(page.locator('.toast-pop').filter({ hasText: `Lv.${flagship.level} → Lv.${flagship.maxTrainLevel}` })).toBeVisible()
  expect(trains).toHaveLength(1)
  expect(trains[0]).toContain('?max=1')
  // Out of coins for another level now: the button stands down.
  await expect(max).toBeDisabled()
  await page.screenshot({ path: `${shots}/dock-after.png` })

  const { profile } = await call<{ profile: Profile }>(page, 'GET', '/profile')
  expect(profile.coins).toBe(start.coins - flagship.maxTrainCost)
})

test('formation: dragging the roster scrolls it without assigning a ship', async ({ page }) => {
  const start = await newAdmiral(page)
  await toHome(page)
  await page.locator('.menu-tile.formation').click()
  const strip = page.locator('.roster .roster-grid')
  await expect(strip.locator('.card').first()).toBeVisible()
  // Narrow the strip so a fresh admiral's handful of ships overflows it.
  await page.addStyleTag({ content: '.roster { right: 760px !important; }' })
  const width = await strip.evaluate((e) => [e.scrollWidth, e.clientWidth])
  expect(width[0]).toBeGreaterThan(width[1])

  const box = (await strip.boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width - 20, y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width - 20 - i * 30, y)
  await expect(strip).toHaveClass(/dragging/)
  await page.mouse.up()
  await expect(strip).not.toHaveClass(/dragging/)
  expect(await strip.evaluate((e) => e.scrollLeft)).toBeGreaterThan(200)
  await page.screenshot({ path: `${shots}/formation-dragged.png` })

  // The drag ended over a card, but the fleet is as it was.
  await page.waitForTimeout(500)
  let { profile } = await call<{ profile: Profile }>(page, 'GET', '/profile')
  expect(profile.fleet).toEqual(start.fleet)

  // A plain click still assigns: the first ship outside the fleet goes into slot 1.
  const spare = strip.locator('.card:not(.in-fleet)').last()
  await spare.scrollIntoViewIfNeeded()
  await spare.click()
  await expect.poll(async () => (({ profile } = await call<{ profile: Profile }>(page, 'GET', '/profile')), profile.fleet[0])).not.toBe(start.fleet[0])
})
