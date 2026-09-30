import { expect, test } from '@playwright/test'
import { cell, newAdmiral, toBattle } from './helpers'
import type { MatchResponse, Profile } from '../src/types'

const shots = 'e2e/results/shots'
const uidOf = (p: Profile, card: string) => p.ships.find((s) => s.card === card)!.uid

test('a ship sailing onto a wreck shares its cell without shifting the chart', async ({ page }) => {
  const p = await newAdmiral(page)
  // The battle view is doctored so a sunk enemy lies under the battleship at C3.
  await page.route('**/api/games/current', async (route) => {
    const res = await route.fetch()
    const m = (await res.json()) as MatchResponse
    Object.assign(m.game.enemyShips[0], { hp: 0, pos: { row: 2, col: 2 } })
    await route.fulfill({ response: res, json: m })
  })
  await toBattle(page, [uidOf(p, 'bb_kurogane'), uidOf(p, 'dd_asanagi'), uidOf(p, 'ss_senryu')], [
    { row: 2, col: 2 },
    { row: 0, col: 0 },
    { row: 4, col: 0 },
  ])
  const shared = cell(page, 2, 2)
  await expect(shared.locator('.ship-token')).toHaveCount(2)
  await page.screenshot({ path: `${shots}/wreck-shared-cell.png` })

  // Both tokens sit centred in the cell, one over the other.
  const box = (await shared.boundingBox())!
  for (const token of await shared.locator('.ship-token').all()) {
    const t = (await token.boundingBox())!
    expect(Math.abs(t.x + t.width / 2 - (box.x + box.width / 2))).toBeLessThan(2)
    expect(Math.abs(t.y + t.height / 2 - (box.y + box.height / 2))).toBeLessThan(2)
  }
  // The cell keeps the size of its neighbours.
  const next = (await cell(page, 2, 3).boundingBox())!
  expect(box.height).toBeCloseTo(next.height, 0)
  expect(next.y).toBeCloseTo(box.y, 0)
})
