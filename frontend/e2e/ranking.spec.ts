import { expect, test } from '@playwright/test'
import { call, newAdmiral, toHome } from './helpers'
import type { Ranking } from '../src/types'

const shots = 'e2e/results/shots'

test('ranking: the harbour opens the boards and shows where I stand', async ({ page }) => {
  await newAdmiral(page)
  await toHome(page)
  await page.screenshot({ path: `${shots}/ranking-harbour-tile.png` })
  await page.locator('.menu-tile.ranking').click()
  await expect(page.locator('.ranking-screen')).toBeVisible()

  // The level board comes first and agrees with the server about my place.
  const { ranking: level } = await call<{ ranking: Ranking }>(page, 'GET', '/rankings/level')
  expect(level.me.rank).toBeGreaterThan(0)
  await expect(page.locator('.my-rank-place')).toHaveAttribute('data-rank', String(level.me.rank))
  await expect(page.locator('.my-rank')).toContainText(`全 ${level.total.toLocaleString()} 名中`)
  await expect(page.locator('.rank-row')).toHaveCount(level.entries.length)
  await expect(page.locator('.rank-row').first()).toHaveAttribute('data-rank', '1')
  await expect(page.locator('.rank-row.me')).toHaveCount(level.entries.some((e) => e.me) ? 1 : 0)
  await page.waitForTimeout(500) // the rows slide in
  await page.screenshot({ path: `${shots}/ranking-level.png` })

  // A new admiral has won nothing yet, so is not on the wins board.
  await page.locator('.ranking-tabs').getByRole('button', { name: /勝利数/ }).click()
  await expect(page.locator('.my-rank-place')).toContainText('ランク外')
  await expect(page.locator('.my-rank')).toContainText('勝利数の記録を作るとランキングに載ります')
  await expect(page.locator('.ranking-list')).toHaveAttribute('aria-label', '勝利数ランキング')
  await page.locator('.ranking-tabs').getByRole('button', { name: /艦隊戦力/ }).click()
  await expect(page.locator('.my-rank-score')).toContainText('艦隊戦力')
  await expect(page.locator('.my-rank-place')).not.toHaveAttribute('data-rank', '0')

  // Unknown boards are refused.
  const res = await page.request.get('/api/rankings/gems')
  expect(res.status()).toBe(404)
})

test('ranking: medals, ties, me and friends on a board', async ({ page }) => {
  // The local database's admirals vary, so this board is drawn as given.
  const card = (rank: number, name: string, score: number, extra = {}) => ({ rank, score, name, comment: '', level: 30 - rank, secretary: 'bb_guren', ...extra })
  const board: Ranking = {
    board: 'endless',
    total: 8,
    entries: [
      card(1, '紅蓮提督', 42, { comment: '最深部を目指して！' }),
      card(2, '蒼海の守り手', 38, { friend: true }),
      card(2, '霧島の提督', 38),
      card(4, 'E2E提督', 31, { me: true }),
      card(5, '南方艦隊', 20),
      card(6, '北方艦隊', 12),
      card(7, '練習艦隊', 5),
      card(8, '新米提督', 1),
    ],
    me: card(4, 'E2E提督', 31, { me: true }),
  }
  await newAdmiral(page)
  await page.route('**/api/rankings/endless', (r) => r.fulfill({ json: { ranking: board } }))
  await toHome(page)
  await page.locator('.menu-tile.ranking').click()
  await page.locator('.ranking-tabs').getByRole('button', { name: /無限海域/ }).click()

  const rows = page.locator('.rank-row')
  await expect(rows).toHaveCount(8)
  await expect(rows.nth(0).locator('.rank-place.medal.m1')).toHaveText('1')
  await expect(rows.nth(1).locator('.rank-place')).toHaveText('2')
  await expect(rows.nth(2).locator('.rank-place')).toHaveText('2')
  await expect(rows.nth(3).locator('.rank-place')).toHaveText('4')
  await expect(rows.nth(0)).toContainText('第42層')
  await expect(rows.nth(1).locator('.rank-tag.friend')).toBeVisible()
  await expect(page.locator('.rank-row.me')).toContainText('あなた')
  await expect(page.locator('.my-rank-place')).toContainText('第4位')
  await page.getByRole('button', { name: 'リストで自分を見る' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${shots}/ranking-endless.png` })
})
