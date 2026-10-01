import { expect, test } from '@playwright/test'
import { call, cell, newAdmiral, toBattle } from './helpers'
import type { MatchResponse, ActionResponse, Profile } from '../src/types'

const shots = 'e2e/results/shots'
const uidOf = (p: Profile, card: string) => p.ships.find((s) => s.card === card)!.uid
const byClass = (p: Profile, cls: string) => p.ships.find((s) => s.stats.class === cls)

test('sonar pings its row, column and the ring around the destroyer', async ({ page }) => {
  const p = await newAdmiral(page)
  // Destroyer (fleet no. 2) at B3 on the 5×5 sea of 1-1.
  await toBattle(page, [uidOf(p, 'bb_kurogane'), uidOf(p, 'dd_asanagi'), uidOf(p, 'ss_senryu')], [
    { row: 0, col: 0 },
    { row: 2, col: 1 },
    { row: 4, col: 4 },
  ])
  await page.locator('[data-plate="p1"]').click()
  await page.locator('.cmd-btn.skill').click()
  // Row 3 and column B (4 + 4 cells) plus the four diagonal neighbours.
  await expect(page.locator('.cell.aoe')).toHaveCount(12)
  await page.screenshot({ path: `${shots}/sonar-preview.png` })

  await page.locator('.cmd-btn.go').click()
  await expect(page.locator('.flagship-line')).toContainText('行動する艦を選んで', { timeout: 30_000 })
  await page.screenshot({ path: `${shots}/sonar-after.png` })
  const log = await page.locator('.battle-log').allInnerTexts()
  console.log('lock-on tags after the ping:', await page.locator('.lock-tag').count(), log.join(' ').slice(0, 200))
})

test('a flare lights a 13-cell diamond anywhere on a 5×5 sea', async ({ page }) => {
  const p = await newAdmiral(page)
  const ca = byClass(p, 'cruiser')
  test.skip(!ca, 'the free ten-pull brought no cruiser')
  await toBattle(page, [uidOf(p, 'bb_kurogane'), ca!.uid, uidOf(p, 'dd_asanagi')], [
    { row: 0, col: 0 },
    { row: 0, col: 4 },
    { row: 4, col: 0 },
  ])
  await page.locator('[data-plate="p1"]').click()
  await page.locator('.cmd-btn.skill').click()
  // Aimable anywhere, even the far corner.
  await expect(page.locator('.cell.target-skill')).toHaveCount(25)
  await cell(page, 2, 2).hover()
  await expect(page.locator('.cell.aoe')).toHaveCount(13)
  await cell(page, 2, 2).click()
  await page.screenshot({ path: `${shots}/flare-preview.png` })
})

test('a locked-on enemy shows crosshairs, and shots on it get the marked cut-in', async ({ page }) => {
  const p = await newAdmiral(page)
  // The server's lock-on is covered by the Go tests; here the battle view
  // is doctored so the UI can be checked without depending on dice.
  await page.route('**/api/games/current', async (route) => {
    const res = await route.fetch()
    const m = (await res.json()) as MatchResponse
    Object.assign(m.game.enemyShips[0], { spotted: true, spottedTurn: 1, marked: true, pos: { row: 3, col: 3 } })
    await route.fulfill({ response: res, json: m })
  })
  await page.route('**/api/games/*/actions', async (route) => {
    const res = await route.fetch()
    const r = (await res.json()) as ActionResponse
    const mine = r.results.find((x) => x.side === 'player')
    if (mine) mine.special = 'marked'
    await route.fulfill({ response: res, json: r })
  })
  await toBattle(page, [uidOf(p, 'bb_kurogane'), uidOf(p, 'dd_asanagi'), uidOf(p, 'ss_senryu')], [
    { row: 2, col: 2 },
    { row: 0, col: 0 },
    { row: 4, col: 0 },
  ])
  await expect(cell(page, 3, 3).locator('.ship-token.marked')).toBeVisible()
  await expect(page.locator('[data-plate="e0"] .lock-tag')).toHaveText('捕捉')

  await page.locator('[data-plate="p0"]').click()
  await page.locator('.cmd-btn.attack').click()
  await cell(page, 3, 3).click()
  await expect(page.locator('.special-hint')).toHaveText('照準射撃！')
  await page.screenshot({ path: `${shots}/marked-aim.png` })

  await page.locator('.cmd-btn.go').click()
  const cutin = page.locator('.cutin.special.marked')
  await expect(cutin).toBeVisible({ timeout: 10_000 })
  await expect(cutin).toContainText('照準射撃')
  await page.screenshot({ path: `${shots}/marked-cutin.png` })
})

test("an enemy sonar that finds the fleet gives its destroyer's position away", async ({ page }) => {
  const p = await newAdmiral(page)
  // The CPU's reply is doctored into a sonar that found the battleship; the
  // rules (heard, not tracked) are covered by the Go tests.
  const emitter = { row: 0, col: 3 }
  await page.route('**/api/games/*/actions', async (route) => {
    const res = await route.fetch()
    const r = (await res.json()) as ActionResponse
    const i = r.results.findIndex((x) => x.side === 'cpu' && x.type !== 'recon')
    const ping = {
      side: 'cpu' as const,
      type: 'skill' as const,
      skill: 'sonar' as const,
      shipId: 0,
      round: r.results[0].round,
      speed: 10,
      target: emitter,
      emitter,
      scanned: [0, 1, 2, 3, 4].map((col) => ({ row: 0, col })),
      revealed: [{ shipId: 0, pos: { row: 0, col: 0 }, turn: r.results[0].round }],
      combo: 0,
      gauge: 0,
    }
    if (i >= 0) r.results[i] = ping
    else r.results.push(ping)
    const h = r.game.history.findIndex((x) => x.side === 'cpu' && x.type !== 'recon' && x.round === ping.round)
    if (h >= 0) r.game.history[h] = ping
    else r.game.history.push(ping)
    await route.fulfill({ response: res, json: r })
  })
  await toBattle(page, [uidOf(p, 'bb_kurogane'), uidOf(p, 'dd_asanagi'), uidOf(p, 'ss_senryu')], [
    { row: 0, col: 0 },
    { row: 2, col: 1 },
    { row: 4, col: 4 },
  ])
  await page.locator('[data-plate="p1"]').click()
  await page.locator('.cmd-btn.skill').click()
  await page.locator('.cmd-btn.go').click()

  // The ping is staged at the emitter, then stays marked until the next order.
  await expect(cell(page, 0, 3).locator('.sonar-echo')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${shots}/sonar-echo-ping.png` })
  await expect(page.locator('.flagship-line')).toContainText('行動する艦を選んで', { timeout: 30_000 })
  await expect(cell(page, 0, 3).locator('.sonar-echo')).toBeVisible()
  await expect(page.locator('.sonar-echo')).toHaveCount(1)
  // Heard, not tracked: no enemy ship is shown there.
  await expect(cell(page, 0, 3).locator('.ship-token')).toHaveCount(0)
  await expect(page.locator('.battle-log')).toContainText('探信源はD1')
  await page.screenshot({ path: `${shots}/sonar-echo-after.png` })
})
