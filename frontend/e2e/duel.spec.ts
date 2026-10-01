import { expect, test, type Page } from '@playwright/test'
import { call, newAdmiral, toHome } from './helpers'
import type { DuelLobby } from '../src/types'

const shots = 'e2e/results/shots'

// Orders one round: the first ship sails to the first cell it can reach.
async function sail(page: Page) {
  await expect(page.locator('.flagship-line')).toContainText('行動する艦を選んで', { timeout: 30_000 })
  await page.locator('[data-plate="p0"]').click()
  await page.locator('.cmd-btn.move').click()
  await page.locator('.cell.target-move').first().click()
  await page.locator('.cmd-btn.go').click()
}

test('duel: two admirals meet by room code, deploy, play a round and one surrenders', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await newAdmiral(page)

  const ctx = await browser.newContext()
  const other = await ctx.newPage()
  await newAdmiral(other)
  await call(other, 'POST', '/profile/name', { name: '好敵手提督', comment: '' })

  // I open a room from the harbour.
  await toHome(page)
  await expect(page.locator('.duel-btn')).toContainText('対人戦')
  await page.screenshot({ path: `${shots}/duel-harbour.png` })
  await page.locator('.duel-btn').click()
  await expect(page.locator('.duel-start')).toBeVisible()
  await expect(page.locator('.duel-tally')).toContainText('0勝 0敗 0分')
  await page.waitForTimeout(900) // the curtain opens
  await page.screenshot({ path: `${shots}/duel-lobby.png` })
  await page.getByRole('button', { name: '部屋を作る' }).first().click()
  const code = page.getByTestId('room-code')
  await expect(code).toHaveText(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${shots}/duel-room.png` })

  // They join with the code, typed loosely.
  await toHome(other)
  await other.locator('.duel-btn').click()
  await other.getByLabel('部屋番号').fill((await code.innerText()).toLowerCase())
  await other.getByRole('button', { name: '入室' }).click()
  await expect(other.locator('.duel-deploy-board')).toBeVisible()
  await expect(other.locator('.duel-who.foe')).toContainText('E2E提督')

  // I see them arrive, and both of us deploy in our own three rows.
  await expect(page.locator('.duel-who.foe')).toContainText('好敵手提督', { timeout: 10_000 })
  await expect(page.locator('.cell.placeable')).toHaveCount(24)
  await page.locator('.cell.placeable').first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${shots}/duel-deploy.png` })
  for (const p of [page, other]) {
    await p.getByRole('button', { name: 'おまかせ配置' }).click()
    await p.getByRole('button', { name: /配置完了/ }).click()
  }

  // The battle begins on both screens; my fleet sits at the bottom of the sea for each of us.
  for (const p of [page, other]) {
    await expect(p.locator('.battle-board')).toBeVisible({ timeout: 15_000 })
    await expect(p.locator('.stage-chip')).toContainText('対人戦')
  }
  for (const p of [page, other]) {
    await expect(p.locator('.flagship-line')).toContainText('行動する艦を選んで', { timeout: 30_000 })
    const rows = await p.locator('.cell:has(.ship-token:not(.enemy))').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-cell')!.split('-')[0])))
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r).toBeGreaterThanOrEqual(5)
  }
  await page.screenshot({ path: `${shots}/duel-battle.png` })

  // I order first and wait; they see that I am ready.
  await sail(page)
  await expect(page.locator('.duel-waiting')).toContainText('好敵手提督')
  await expect(page.locator('.duel-clock')).toContainText('相手待ち')
  await page.screenshot({ path: `${shots}/duel-waiting.png` })
  await expect(other.locator('.duel-ready-note')).toBeVisible({ timeout: 10_000 })
  await other.screenshot({ path: `${shots}/duel-opponent-ready.png` })

  // Their order completes the round, which plays out on both screens.
  await sail(other)
  for (const p of [page, other]) {
    await expect(p.locator('.turn-plate b')).toHaveText('2', { timeout: 30_000 })
    await expect(p.locator('.battle-log li').first()).not.toHaveClass(/muted/)
  }

  // I surrender (it asks twice); both see the outcome.
  await expect(page.locator('.flagship-line')).toContainText('行動する艦を選んで', { timeout: 30_000 })
  await page.getByRole('button', { name: '降伏' }).click()
  await page.getByRole('button', { name: '本当に降伏？' }).click()
  await expect(page.locator('.duel-result.lose')).toContainText('降伏しました', { timeout: 15_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${shots}/duel-result-lose.png` })
  await expect(other.locator('.duel-result.win')).toContainText('相手提督が降伏しました', { timeout: 30_000 })
  await other.waitForTimeout(600)
  await other.screenshot({ path: `${shots}/duel-result-win.png` })

  // The lobby keeps the record.
  await other.getByRole('button', { name: 'ロビーへ' }).click()
  await expect(other.locator('.duel-tally')).toContainText('1勝 0敗 0分')
  await expect(other.locator('.duel-record li.win')).toContainText('vs E2E提督')
  await other.screenshot({ path: `${shots}/duel-lobby-after.png` })
  const lobby = await call<DuelLobby>(page, 'GET', '/duels')
  expect(lobby.duel).toBeNull()
  expect(lobby.record.losses).toBe(1)
  await ctx.close()
})

test('duel: the guest sees the host leave a deployment and returns to the lobby', async ({ page, browser }) => {
  await newAdmiral(page)
  const ctx = await browser.newContext()
  const other = await ctx.newPage()
  await newAdmiral(other)
  const { duel } = await call<{ duel: { code: string } }>(page, 'POST', '/duels')
  await call(other, 'POST', '/duels/join', { code: duel.code })
  // A second room while in one is refused.
  const res = await other.request.post('/api/duels', { data: '{}' })
  expect(res.status()).toBe(409)

  await toHome(other)
  await other.locator('.duel-btn').click()
  await expect(other.locator('.duel-deploy-board')).toBeVisible()
  const { id } = await call<DuelLobby>(page, 'GET', '/duels')
  await call(page, 'POST', `/duels/${id}/leave`)
  await expect(other.locator('.toast-pop').filter({ hasText: '対戦は中止されました' })).toBeVisible({ timeout: 10_000 })
  await expect(other.locator('.duel-start')).toBeVisible()
  await ctx.close()
})
