import { expect, test, type Page } from '@playwright/test'
import { cell, newAdmiral, toBattle } from './helpers'
import { footprint } from '../src/game'
import type { ActionResponse, MatchResponse, Pos, Profile, Result } from '../src/types'

const shots = 'e2e/results/shots'

// Two barrages painting in parallel starve each other of the software renderer.
test.describe.configure({ mode: 'serial' })
const uidOf = (p: Profile, card: string) => p.ships.find((s) => s.card === card)!.uid

// Filling the gauge takes a whole fight, and the Go tests cover the rules, so
// the battle view is doctored: the gauge shows full, and the round's player
// action (sent as a plain shot the server accepts) comes back as a barrage.
// Only the choreography is under test here.
function barrage(side: Result['side'], aim: Pos, hit: Pos, round: number, damage: number): Result {
  return {
    side,
    type: 'ultimate',
    shipId: 0,
    round,
    speed: 10,
    target: aim,
    shots: footprint(5, 'ultimate', undefined, undefined, aim, aim).map((c) =>
      c.row === hit.row && c.col === hit.col ? { target: c, hitShipId: 0, damage, crit: true } : { target: c, splash: Math.abs(c.row - hit.row) + Math.abs(c.col - hit.col) === 1 },
    ),
    columns: [{ row: hit.row, col: hit.col - 1 }],
    combo: 1,
    gauge: 0,
  }
}

async function doctor(page: Page, who: Result['side'], { marked = false } = {}) {
  await page.route('**/api/games/current', async (route) => {
    const res = await route.fetch()
    const m = (await res.json()) as MatchResponse
    m.game.gauge = 100
    Object.assign(m.game.enemyShips[0], { spotted: true, spottedTurn: 1, marked, pos: { row: 2, col: 3 } })
    await route.fulfill({ response: res, json: m })
  })
  await page.route('**/api/games/*/actions', async (route) => {
    // The server has no full gauge to spend: fire the battleship's guns instead.
    const res = await route.fetch({ postData: JSON.stringify({ type: 'attack', shipId: 0, target: { row: 1, col: 1 } }) })
    const r = (await res.json()) as ActionResponse
    const round = r.results[0]?.round ?? 1
    r.results =
      who === 'player'
        ? [barrage('player', { row: 2, col: 2 }, { row: 2, col: 3 }, round, 186)]
        : [barrage('cpu', { row: 1, col: 1 }, { row: 0, col: 0 }, round, 140)]
    // As an older server billed a barrage over a locked-on ship.
    if (marked) Object.assign(r.results[0], { special: 'marked' })
    await route.fulfill({ response: res, json: r })
  })
}

async function deploy(page: Page) {
  const p = await newAdmiral(page)
  await toBattle(page, [uidOf(p, 'bb_kurogane'), uidOf(p, 'dd_asanagi'), uidOf(p, 'ss_senryu')], [
    { row: 0, col: 0 },
    { row: 4, col: 0 },
    { row: 4, col: 4 },
  ])
}

// Headless Chromium paints in software and a screenshot can take a second or
// more, so each shot waits for its phase to start instead of sleeping, and
// the cut-ins are captured with their animations run to the end.
test('the all-fleet barrage previews 13 cells and plays out as a finishing move', async ({ page }) => {
  await doctor(page, 'player')
  await deploy(page)

  await page.locator('.cmd-btn.ultimate').click()
  await expect(page.locator('.cmd-btn.ultimate small')).toHaveText('13マス 装甲貫通')
  await cell(page, 2, 2).hover()
  await expect(page.locator('.cell.aoe')).toHaveCount(13)
  await expect(page.locator('.cell.aoe-core')).toHaveCount(1)
  await expect(page.locator('.cell.aoe-outer')).toHaveCount(4)
  await cell(page, 2, 2).click()
  await page.screenshot({ path: `${shots}/ultimate-aim.png` })

  await page.locator('.cmd-btn.go').click()
  // One round trip: the cut-in lasts under three seconds and the page is slow here.
  const cutin = await page.waitForSelector('.cutin.ultimate')
  expect(await cutin.evaluate((el) => [el.querySelectorAll('.ult-card').length, el.querySelector('.ult-kanji')?.textContent])).toEqual([3, '全艦斉射'])
  await page.screenshot({ path: `${shots}/ultimate-cutin.png`, animations: 'disabled' })

  await expect(page.locator('.ult-reticle b')).toHaveText('TARGET LOCK', { timeout: 8_000 })
  await expect(page.locator('.battle-screen.ult-active')).toBeVisible()
  await page.screenshot({ path: `${shots}/ultimate-lock.png` })

  // One big hit on a 200-HP destroyer is more than a ship's worth: the top grade.
  await expect(page.locator('.ult-total')).toContainText(/TOTAL DAMAGE\s*186\s*ANNIHILATION!!!!/, { timeout: 8_000 })
  await expect(page.locator('.cell.ult-blast')).toHaveCount(13)
  await page.waitForTimeout(300) // let the band finish slamming in
  await page.screenshot({ path: `${shots}/ultimate-finale.png` })

  await expect(page.locator('.battle-screen.ult-active')).toHaveCount(0, { timeout: 8_000 })
  await expect(page.locator('.battle-log li').first()).toContainText('全艦斉射')
})

test("the enemy's all-fleet barrage gets the red treatment", async ({ page }) => {
  await doctor(page, 'cpu')
  await deploy(page)

  await page.locator('[data-plate="p0"]').click()
  await page.locator('.cmd-btn.attack').click()
  await cell(page, 1, 1).click()
  await page.locator('.cmd-btn.go').click()
  const cutin = await page.waitForSelector('.cutin.ultimate.enemy-side', { timeout: 5_000 })
  expect(await cutin.evaluate((el) => el.querySelector('.ult-title small')?.textContent)).toBe('ENEMY ALL FLEET BARRAGE')
  await page.screenshot({ path: `${shots}/ultimate-enemy-cutin.png`, animations: 'disabled' })
  await expect(page.locator('.ult-reticle.enemy b')).toHaveText('敵 照準固定', { timeout: 8_000 })
  await page.screenshot({ path: `${shots}/ultimate-enemy-lock.png` })
  await expect(page.locator('.ult-total.enemy')).toBeVisible({ timeout: 8_000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${shots}/ultimate-enemy-finale.png` })
  await expect(page.locator('.battle-screen.ult-active')).toHaveCount(0, { timeout: 8_000 })
})

test('a barrage over a locked-on enemy keeps its own cut-in, not the locked-on one', async ({ page }) => {
  await doctor(page, 'player', { marked: true })
  await deploy(page)
  await expect(cell(page, 2, 3).locator('.ship-token.marked')).toBeVisible()

  await page.locator('.cmd-btn.ultimate').click()
  await cell(page, 2, 2).click()
  await expect(page.locator('.cmd-btn.go')).toHaveClass(/ready/)
  await expect(page.locator('.special-hint')).toHaveCount(0)
  await page.screenshot({ path: `${shots}/ultimate-marked-aim.png` })

  // Watch every cut-in that plays: the locked-on one must never show up.
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { cutins: string[] }).cutins = [])
    new MutationObserver(() => document.querySelectorAll('.cutin').forEach((el) => seen.push(el.className))).observe(document.body, { childList: true, subtree: true })
  })
  await page.locator('.cmd-btn.go').click()
  await page.waitForSelector('.cutin.ultimate')
  await page.screenshot({ path: `${shots}/ultimate-marked-cutin.png`, animations: 'disabled' })
  await expect(page.locator('.battle-log li').first()).toContainText('全艦斉射', { timeout: 20_000 })
  const seen = await page.evaluate(() => (window as unknown as { cutins: string[] }).cutins)
  expect(seen.some((c) => c.includes('ultimate'))).toBeTruthy()
  expect(seen.filter((c) => c.includes('special'))).toEqual([])
})

test("ships sunk earlier in the round sit out the enemy's barrage", async ({ page }) => {
  let fleet = 0
  let hp = 0
  await page.route('**/api/games/current', async (route) => {
    const res = await route.fetch()
    const m = (await res.json()) as MatchResponse
    fleet = m.game.enemyShips.length
    hp = m.game.enemyShips[0].hp
    Object.assign(m.game.enemyShips[0], { spotted: true, spottedTurn: 1, pos: { row: 2, col: 3 } })
    await route.fulfill({ response: res, json: m })
  })
  // Our shot sinks the spotted enemy first, then what is left of their fleet opens up.
  await page.route('**/api/games/*/actions', async (route) => {
    const res = await route.fetch({ postData: JSON.stringify({ type: 'attack', shipId: 0, target: { row: 1, col: 1 } }) })
    const r = (await res.json()) as ActionResponse
    const round = r.results[0]?.round ?? 1
    const target = { row: 2, col: 3 }
    r.results = [
      { side: 'player', type: 'attack', shipId: 0, round, speed: 10, target, shots: [{ target, hitShipId: 0, damage: hp, sunk: true }], combo: 1, gauge: 0 },
      barrage('cpu', { row: 1, col: 1 }, { row: 0, col: 0 }, round, 140),
    ]
    await route.fulfill({ response: res, json: r })
  })
  await deploy(page)
  expect(fleet).toBeGreaterThan(1)

  await page.locator('[data-plate="p0"]').click()
  await page.locator('.cmd-btn.attack').click()
  await cell(page, 1, 1).click()
  await page.locator('.cmd-btn.go').click()
  const cutin = await page.waitForSelector('.cutin.ultimate.enemy-side', { timeout: 20_000 })
  expect(await cutin.evaluate((el) => el.querySelectorAll('.ult-card').length)).toBe(fleet - 1)
  await page.screenshot({ path: `${shots}/ultimate-enemy-after-sink.png`, animations: 'disabled' })
})
