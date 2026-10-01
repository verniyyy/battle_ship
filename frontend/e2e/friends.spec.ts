import { expect, test } from '@playwright/test'
import { call, newAdmiral, toHome } from './helpers'
import type { FriendList, Profile } from '../src/types'

const shots = 'e2e/results/shots'

test('friends: two admirals swap codes, become friends, cheer and part', async ({ page, browser }) => {
  const me = await newAdmiral(page)
  // Gifts for everyone in the local database would pop up over the harbour.
  await call(page, 'POST', '/gifts/claim', {})

  // The other admiral, in a browser of their own.
  const ctx = await browser.newContext()
  const other = await ctx.newPage()
  await newAdmiral(other)
  await call(other, 'POST', '/gifts/claim', {})
  await call(other, 'POST', '/profile/name', { name: '僚艦提督', comment: 'よろしくお願いします！' })
  const { friends: theirs } = await call<{ friends: FriendList }>(other, 'GET', '/friends')

  // I open the friends screen from the harbour and ask by their code, typed loosely.
  await toHome(page)
  await page.locator('.friend-bar').click()
  await expect(page.locator('.friends-screen')).toBeVisible()
  await expect(page.locator('.friend-empty')).toContainText('まだフレンドがいません')
  await expect(page.locator('.friend-code')).toHaveText(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/)
  await page.screenshot({ path: `${shots}/friends-empty.png` })
  const loose = `${theirs.code.slice(0, 4)}-${theirs.code.slice(4)}`.toLowerCase()
  await page.getByLabel('フレンドコード').fill(loose)
  await page.getByRole('button', { name: '申請する' }).click()
  await expect(page.locator('.toast-pop').filter({ hasText: 'フレンド申請を送りました' })).toBeVisible()
  await expect(page.locator(`[data-friend="${theirs.code}"]`)).toContainText('返事待ち')
  // Asking twice is turned down with the reason.
  await page.getByLabel('フレンドコード').fill(theirs.code)
  await page.getByRole('button', { name: '申請する' }).click()
  await expect(page.locator('.toast-pop').filter({ hasText: 'すでに申請しています' })).toBeVisible()

  // They see the request at the harbour, look at me, and say yes.
  await toHome(other)
  await expect(other.locator('.friend-bar')).toContainText('申請 1 件')
  await other.screenshot({ path: `${shots}/friends-harbour-bar.png` })
  await other.locator('.friend-bar').click()
  await other.locator('.friends-tabs').getByRole('button', { name: /届いた申請/ }).click()
  const request = other.locator(`[data-friend]`).filter({ hasText: 'E2E提督' })
  await request.locator('.friend-who').click()
  const card = other.getByRole('dialog', { name: '提督の詳細' })
  await expect(card.locator('.friend-fleet .card')).toHaveCount(me.fleet.length)
  await other.waitForTimeout(400) // the dialog fades in
  await other.screenshot({ path: `${shots}/friends-request-detail.png` })
  await card.getByRole('button', { name: '承認する' }).click()
  await expect(other.locator('.toast-pop').filter({ hasText: 'E2E提督とフレンドになりました' })).toBeVisible()
  await other.locator('.friends-tabs').getByRole('button', { name: /フレンド/ }).first().click()
  const mine = other.locator('.friend-row').filter({ hasText: 'E2E提督' })
  await mine.getByRole('button', { name: 'エール' }).click()
  await expect(mine.getByRole('button', { name: '送信済' })).toBeDisabled()

  // I collect the cheer.
  await page.reload()
  await page.locator('.title-screen').click()
  await expect(page.locator('.friend-bar')).toContainText('エール 1 件')
  await page.locator('.friend-bar').click()
  const friend = page.locator('.friend-row').filter({ hasText: '僚艦提督' })
  await expect(friend).toContainText('よろしくお願いします！')
  await expect(friend).toContainText('エールが届きました')
  await expect(page.locator('.cheer-box b')).toHaveText('1')
  await page.screenshot({ path: `${shots}/friends-list.png` })
  const before = (await call<{ profile: Profile }>(page, 'GET', '/profile')).profile.coins
  await page.locator('.cheer-box').getByRole('button', { name: '受け取る' }).click()
  await expect(page.locator('.cheer-box b')).toHaveText('0')
  expect((await call<{ profile: Profile }>(page, 'GET', '/profile')).profile.coins).toBe(before + 200)

  // Cheer back to everyone, then part from the friend's card.
  await page.getByRole('button', { name: /全員にエール/ }).click()
  await expect(friend.getByRole('button', { name: '送信済' })).toBeDisabled()
  await friend.locator('.friend-who').click()
  const detail = page.getByRole('dialog', { name: '提督の詳細' })
  await expect(detail).toContainText('今日のエールは送信済')
  await page.screenshot({ path: `${shots}/friends-detail.png` })
  await detail.getByRole('button', { name: 'フレンド解除' }).click()
  await detail.getByRole('button', { name: '解除する' }).click()
  await expect(detail).toBeHidden()
  await expect(page.locator('.friend-empty')).toBeVisible()
  const { friends: after } = await call<{ friends: FriendList }>(other, 'GET', '/friends')
  expect(after.friends).toHaveLength(0)
  await ctx.close()
})
