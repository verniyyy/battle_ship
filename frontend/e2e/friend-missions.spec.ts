import { expect, test } from '@playwright/test'
import { call, newAdmiral, toHome } from './helpers'
import type { FriendList } from '../src/types'

const shots = 'e2e/results/shots'

test('friend missions: a cheer clears the daily mission and a friend earns an achievement', async ({ page, browser }) => {
  await newAdmiral(page)
  const ctx = await browser.newContext()
  const other = await ctx.newPage()
  await newAdmiral(other)
  await call(other, 'POST', '/profile/name', { name: '僚艦提督', comment: '' })
  const { friends: mine } = await call<{ friends: FriendList }>(page, 'GET', '/friends')
  const { friends: theirs } = await call<{ friends: FriendList }>(other, 'GET', '/friends')
  await call(page, 'POST', '/friends/requests', { code: theirs.code })
  await call(other, 'POST', `/friends/requests/${mine.code}/accept`)

  // I cheer my new friend from the friends screen.
  await toHome(page)
  await page.locator('.menu-tile.friends').click()
  const friend = page.locator('.friend-row').filter({ hasText: '僚艦提督' })
  await friend.getByRole('button', { name: 'エール' }).click()
  await expect(friend.getByRole('button', { name: '送信済' })).toBeDisabled()

  // The daily mission for it is ready, and the all-clear still counts only the rest.
  await page.locator('.back-btn').click()
  await page.locator('.menu-tile.missions').click()
  const cheer = page.locator('[data-mission="d_cheer"]')
  await expect(cheer).toContainText('フレンドにエールを送る')
  await expect(cheer).toContainText('1/1')
  await expect(page.locator('[data-mission="d_all"] small')).toHaveText(/^0\/9$/)
  await page.waitForTimeout(800) // the rows slide in
  await page.screenshot({ path: `${shots}/friend-missions-daily.png` })
  await cheer.getByRole('button', { name: '受け取る' }).click()
  await expect(cheer.getByRole('button', { name: '受取済' })).toBeDisabled()

  // The first friend is an achievement.
  await page.locator('.dock-tabs').getByRole('button', { name: /勲功/ }).click()
  const first = page.locator('[data-mission="a_friends_1"]')
  await expect(first).toContainText('フレンドを 1 人つくる')
  await expect(first.getByRole('button', { name: '受け取る' })).toBeEnabled()
  await expect(page.locator('[data-mission="a_cheers_10"]')).toContainText('1/10')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${shots}/friend-missions-achievements.png` })
  await first.getByRole('button', { name: '受け取る' }).click()
  await expect(page.locator('[data-mission="a_friends_5"]')).toContainText('1/5')
  await ctx.close()
})
