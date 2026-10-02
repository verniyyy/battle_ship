import { expect, test, type Page } from '@playwright/test'
import { cell, newAdmiral, toBattle } from './helpers'
import type { Profile } from '../src/types'

const shots = 'e2e/results/shots'
const uidOf = (p: Profile, card: string) => p.ships.find((s) => s.card === card)!.uid

async function deploy(page: Page) {
  const p = await newAdmiral(page)
  // Destroyer (fleet no. 2) at C3 in the middle of the 5×5 sea of 1-1.
  await toBattle(page, [uidOf(p, 'bb_kurogane'), uidOf(p, 'dd_asanagi'), uidOf(p, 'ss_senryu')], [
    { row: 0, col: 0 },
    { row: 2, col: 2 },
    { row: 4, col: 4 },
  ])
}

test('the cancel button backs out of the target, the order, then the ship', async ({ page }) => {
  await deploy(page)
  const cancel = page.getByTestId('cmd-cancel')
  await expect(cancel).toHaveCount(0)

  await page.locator('[data-plate="p1"]').click()
  await expect(cancel).toContainText('選択を解除')
  await page.locator('.cmd-btn.attack').click()
  await expect(cancel).toContainText('行動を戻す')
  await cell(page, 0, 4).click()
  await expect(cell(page, 0, 4)).toHaveClass(/chosen/)
  await expect(cancel).toContainText('目標を解除')
  await page.screenshot({ path: `${shots}/cancel-target.png` })

  await cancel.click()
  await expect(page.locator('.cell.chosen')).toHaveCount(0)
  await expect(page.locator('.cell.target-attack')).toHaveCount(22)
  await cancel.click()
  await expect(page.locator('.cell.target-attack')).toHaveCount(0)
  await expect(page.locator('.cmd-btn.attack')).toBeVisible()
  await cancel.click()
  await expect(page.locator('.plate.selected')).toHaveCount(0)
  await expect(cancel).toHaveCount(0)
  await expect(page.locator('.flagship-line')).toContainText('行動する艦を選んで')
})

test('tapping the chosen ship again, Esc or a right-click lets it go', async ({ page }) => {
  await deploy(page)

  // The plate toggles.
  await page.locator('[data-plate="p1"]').click()
  await expect(page.locator('[data-plate="p1"]')).toHaveClass(/selected/)
  await page.locator('[data-plate="p1"]').click()
  await expect(page.locator('.plate.selected')).toHaveCount(0)

  // So does the ship on the chart.
  await cell(page, 2, 2).click()
  await expect(cell(page, 2, 2)).toHaveClass(/selected-ship/)
  await cell(page, 2, 2).click()
  await expect(page.locator('.cell.selected-ship')).toHaveCount(0)

  // Esc steps back all the way to no ship.
  await page.keyboard.press('2')
  await page.keyboard.press('a')
  await expect(page.locator('.cell.target-attack')).toHaveCount(22)
  await page.keyboard.press('Escape')
  await expect(page.locator('.cell.target-attack')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.plate.selected')).toHaveCount(0)

  // A right-click on the chart does the same.
  await page.locator('[data-plate="p0"]').click()
  await cell(page, 3, 3).click({ button: 'right' })
  await expect(page.locator('.plate.selected')).toHaveCount(0)
})

test('the cancel button fits the dock on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await deploy(page)
  await page.locator('[data-plate="p0"]').click()
  const cancel = page.getByTestId('cmd-cancel')
  await expect(cancel).toBeVisible()
  await page.screenshot({ path: `${shots}/cancel-phone.png` })
  const dock = (await page.locator('.command-dock').boundingBox())!
  for (const b of await page.locator('.command-dock .cmd-btn').all()) {
    const r = (await b.boundingBox())!
    expect(r.x).toBeGreaterThanOrEqual(dock.x - 1)
    expect(r.x + r.width).toBeLessThanOrEqual(dock.x + dock.width + 1)
  }
})
