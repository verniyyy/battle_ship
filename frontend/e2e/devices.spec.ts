import { expect, test, type Page } from '@playwright/test'
import { call, newAdmiral, toBattle, toHome } from './helpers'
import type { Profile } from '../src/types'

const shots = 'e2e/results/shots'
const uidOf = (p: Profile, card: string) => p.ships.find((s) => s.card === card)!.uid

/** Fires the battleship's guns at the first cell they reach and waits for the round to end. */
async function fire(page: Page) {
  await page.locator('[data-plate="p0"]').click()
  await page.locator('.cmd-btn.attack').click()
  await page.locator('.cell.target-attack').first().click()
  await page.locator('.cmd-btn.go').click()
}

test('a battle played on from another device is reloaded, not acted on blind', async ({ page }) => {
  const p = await newAdmiral(page)
  await toBattle(page, [uidOf(p, 'bb_kurogane'), uidOf(p, 'dd_asanagi'), uidOf(p, 'ss_senryu')], [
    { row: 2, col: 2 },
    { row: 0, col: 0 },
    { row: 4, col: 0 },
  ])

  // The same admiral opens the battle on a second device (same account, same session).
  const other = await page.context().newPage()
  await toHome(other)
  await other.locator('.resume-banner').click()
  await other.getByRole('button', { name: '戦闘に復帰' }).click()
  await expect(other.locator('.turn-plate b')).toHaveText('1')

  // The first device plays a round.
  await fire(page)
  await expect(page.locator('.turn-plate b')).toHaveText('2', { timeout: 30_000 })

  // The second, still on turn 1, is told and catches up instead of firing.
  await fire(other)
  await expect(other.locator('.cutin.notice')).toContainText('他の端末で戦況が進んだため')
  await other.screenshot({ path: `${shots}/devices-stale-notice.png` })
  await expect(other.locator('.turn-plate b')).toHaveText('2')
  await expect(other.locator('.flagship-line')).toContainText('行動する艦を選んで')
  await expect(other.locator('.battle-log li')).toHaveCount(await page.locator('.battle-log li').count())
  await other.screenshot({ path: `${shots}/devices-caught-up.png` })

  // Now up to date, it plays the next round normally.
  await fire(other)
  await expect(other.locator('.turn-plate b')).toHaveText('3', { timeout: 30_000 })
})

test('coins spent on another device show up when the tab comes back', async ({ page }) => {
  const p = await newAdmiral(page)
  await toHome(page)
  await page.locator('.menu-tile.gacha').click()
  const coins = page.locator('.wallet-pill.coins')
  await expect(coins).toHaveText(p.coins.toLocaleString())

  // Another device trains a ship meanwhile.
  const { profile } = await call<{ profile: Profile }>(page, 'POST', `/ships/${p.fleet[0]}/train`)
  expect(profile.coins).toBeLessThan(p.coins)
  await expect(coins).toHaveText(p.coins.toLocaleString())

  // Coming back to this tab refetches the wallet.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(coins).toHaveText(profile.coins.toLocaleString())
})
