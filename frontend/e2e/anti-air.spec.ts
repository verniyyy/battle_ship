import { expect, test } from '@playwright/test'
import { newAdmiral, toBattle } from './helpers'
import type { ActionResponse, MatchResponse, Profile } from '../src/types'

const shots = 'e2e/results/shots'
const uidOf = (p: Profile, card: string) => p.ships.find((s) => s.card === card)!.uid
const starters = (p: Profile) => [uidOf(p, 'bb_kurogane'), uidOf(p, 'dd_asanagi'), uidOf(p, 'ss_senryu')]
const placements = [
  { row: 2, col: 2 },
  { row: 0, col: 0 },
  { row: 4, col: 0 },
]

test('a battleship stands anti-air watch and can then only sail', async ({ page }) => {
  const p = await newAdmiral(page)
  await toBattle(page, starters(p), placements)

  // Destroyers have no watch to stand.
  await page.locator('[data-plate="p1"]').click()
  await expect(page.getByTestId('cmd-watch')).toHaveCount(0)

  await page.locator('[data-plate="p0"]').click()
  const watch = page.getByTestId('cmd-watch')
  await expect(watch).toBeEnabled()
  await watch.click()
  await expect(page.locator('.cmd-btn.go')).toContainText('見張れ！')
  await page.screenshot({ path: `${shots}/watch-order.png` })

  await page.locator('.cmd-btn.go').click()
  await expect(page.locator('.flagship-line')).toContainText('行動する艦を選んで', { timeout: 30_000 })
  await expect(page.locator('.battle-log')).toContainText('対空見張りにつく')
  // Two rounds of the watch are left once the round it was ordered in closes.
  await expect(page.locator('[data-plate="p0"] .watch-tag')).toHaveText('対空2')

  await page.locator('[data-plate="p0"]').click()
  await expect(page.getByTestId('cmd-watch')).toBeDisabled()
  await expect(page.getByTestId('cmd-watch')).toContainText('残2T')
  await expect(page.locator('.cmd-btn.attack')).toBeDisabled()
  await expect(page.locator('.cmd-btn.skill')).toBeDisabled()
  await expect(page.locator('.cmd-btn.move')).toBeEnabled()
  await page.screenshot({ path: `${shots}/watch-standing.png` })
})

test('an intercepted airstrike gives the carrier away', async ({ page }) => {
  const p = await newAdmiral(page)
  // Stage 1-1 fields no carrier, so the CPU's reply is doctored into an
  // airstrike flown into the watch; the rules are covered by the Go tests.
  await page.route('**/api/games/*/actions', async (route) => {
    const res = await route.fetch()
    const r = (await res.json()) as ActionResponse
    const i = r.results.findIndex((x) => x.side === 'cpu' && x.type !== 'recon')
    const strike = {
      side: 'cpu' as const,
      type: 'skill' as const,
      skill: 'airstrike' as const,
      shipId: 0,
      round: r.results[0].round,
      speed: 10,
      target: { row: 0, col: 0 },
      origin: { row: 4, col: 4 },
      intercepted: true,
      shots: [{ target: { row: 0, col: 0 }, hitShipId: 1, damage: 21 }],
      combo: 0,
      gauge: 0,
    }
    if (i >= 0) r.results[i] = strike
    else r.results.push(strike)
    await route.fulfill({ response: res, json: r })
  })
  await toBattle(page, starters(p), placements)

  await page.locator('[data-plate="p0"]').click()
  await page.getByTestId('cmd-watch').click()
  await page.locator('.cmd-btn.go').click()
  await expect(page.locator('.cutin.banner')).toContainText('対空迎撃！', { timeout: 30_000 })
  await page.screenshot({ path: `${shots}/watch-intercept.png` })
  await expect(page.locator('.battle-log')).toContainText('逆探知', { timeout: 30_000 })
})

test("a cruiser's five orders fit the command dock", async ({ page }) => {
  const p = await newAdmiral(page)
  // A battleship given torpedoes has the cruiser's full set of orders.
  await page.route('**/api/games/current', async (route) => {
    const res = await route.fetch()
    const m = (await res.json()) as MatchResponse
    Object.assign(m.game.playerShips[0], { torps: 2, maxTorps: 2 })
    await route.fulfill({ response: res, json: m })
  })
  await toBattle(page, starters(p), placements)
  await page.locator('[data-plate="p0"]').click()
  await expect(page.locator('.command-dock .cmd-btn')).toHaveCount(6)
  const go = (await page.locator('.cmd-btn.go').boundingBox())!
  const enemy = (await page.locator('.fleet-col.enemy').boundingBox())!
  const first = (await page.locator('.command-dock .cmd-btn').first().boundingBox())!
  const own = (await page.locator('.fleet-col').first().boundingBox())!
  await page.screenshot({ path: `${shots}/watch-dock-full.png` })
  expect(go.x + go.width).toBeLessThanOrEqual(enemy.x)
  expect(first.x).toBeGreaterThanOrEqual(own.x + own.width)
})
