import { expect, test } from '@playwright/test'
import { call, newAdmiral, toHome } from './helpers'
import type { Profile } from '../src/types'

const shots = 'e2e/results/shots'

test('gifts: an admin sends a gift to one admiral, who collects it at the harbour', async ({ page, browser }) => {
  // The admiral who will be compensated. Players cannot open the console.
  await newAdmiral(page)
  // Gifts for everyone already in the local database are collected first, so
  // only the one sent here waits in the box.
  const { profile: player } = await call<{ profile: Profile }>(page, 'POST', '/gifts/claim', {})
  const res = await page.request.get('/api/admin/gifts')
  expect(res.status()).toBe(403)

  // The operator signs in as the dev admin in a browser of their own.
  const ctx = await browser.newContext()
  const op = await ctx.newPage()
  const operator = await newAdmiral(op)
  await call(op, 'POST', '/auth/dev', { guest: operator.id, admin: true })
  await toHome(op)
  await op.locator('.chip.admin').click()
  await expect(op.locator('.admin-screen')).toBeVisible()

  const title = `E2E補償 ${Date.now()}`
  await op.getByRole('button', { name: '新しい配布' }).click()
  const form = op.locator('.admin-form')
  await form.getByPlaceholder('例：メンテナンス延長のお詫び').fill(title)
  await form.getByPlaceholder('提督に届くメッセージ').fill('不具合でご迷惑をおかけしました。')
  await form.locator('input[type="number"]').first().fill('500')
  await form.locator('select').selectOption('cv_kosame')
  await form.getByRole('button', { name: '追加', exact: true }).first().click()
  await form.getByLabel('指定した提督').check()
  await form.getByPlaceholder('提督名・メールアドレス・ID で検索').fill(player.id)
  await form.getByRole('button', { name: '検索' }).click()
  await form.locator('.admin-players li').filter({ hasText: player.id }).getByRole('button', { name: '追加' }).click()
  await expect(form.locator('textarea.mono')).toHaveValue(player.id)
  await op.screenshot({ path: `${shots}/admin-form.png` })

  await form.getByRole('button', { name: '内容を確認' }).click()
  const confirm = op.getByRole('dialog', { name: 'この内容で配布しますか？' })
  await expect(confirm).toContainText('1 人')
  await op.screenshot({ path: `${shots}/admin-confirm.png` })
  await confirm.getByRole('button', { name: '配布する' }).click()

  const row = op.locator('.admin-gifts > li').filter({ hasText: title })
  await expect(row).toContainText('配布中')
  await expect(row).toContainText('1 人')
  await op.screenshot({ path: `${shots}/admin-list.png` })

  // The admiral finds it waiting at the harbour.
  await toHome(page, { gifts: true })
  await expect(page.locator('.gift-banner')).toBeVisible()
  const box = page.getByRole('dialog', { name: '贈り物' })
  await expect(box).toBeVisible()
  const gift = box.locator('.gift-list > li').filter({ hasText: title })
  await expect(gift).toContainText('不具合でご迷惑をおかけしました。')
  await expect(gift).toContainText('💎500')
  await page.screenshot({ path: `${shots}/gift-box.png` })
  await gift.getByRole('button', { name: '受け取る' }).click()
  await expect(gift).toBeHidden()
  await expect(page.locator('.toast-pop').filter({ hasText: '小雨' })).toBeVisible()
  const { profile } = await call<{ profile: { gems: number; ships: { card: string }[] } }>(page, 'GET', '/profile')
  expect(profile.gems).toBe(player.gems + 500)
  expect(profile.ships.some((s) => s.card === 'cv_kosame')).toBeTruthy()
  await box.getByRole('button', { name: '閉じる' }).last().click()
  await expect(page.locator('.gift-banner')).toBeHidden()
  await expect(page.locator('.chip.admin')).toHaveCount(0)
  await page.screenshot({ path: `${shots}/gift-claimed.png` })

  // Back in the console: the claim shows, the gift can be stopped and the log has both.
  await op.reload()
  await op.locator('.title-screen').click()
  await op.locator('.chip.admin').click()
  await expect(row).toContainText('受取 1 件')
  await row.getByRole('button', { name: '停止' }).click()
  await op.getByRole('dialog', { name: '配布を停止' }).getByRole('button', { name: '停止する' }).click()
  await expect(row).toContainText('停止')
  await op.getByRole('button', { name: '操作ログ' }).click()
  await expect(op.locator('.admin-audit tbody tr').first()).toContainText('配布を停止')
  await op.screenshot({ path: `${shots}/admin-audit.png` })
  await ctx.close()
})
