import { expect, type Page } from '@playwright/test'
import { NEWS } from '../src/news'
import type { Profile } from '../src/types'

type WithProfile<T = object> = T & { profile: Profile }

/** Calls the API with the page's session cookie. */
export async function call<T>(page: Page, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await page.request.fetch(`/api${path}`, { method, data: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBeTruthy()
  return (res.status() === 204 ? undefined : await res.json()) as T
}

/**
 * Signs a fresh admiral in with the dev login, names them, takes the login
 * bonus (so its popup stays away) and spends the free ten-pull. Returns the
 * profile at the harbour.
 */
export async function newAdmiral(page: Page): Promise<Profile> {
  await page.goto('/')
  await call(page, 'POST', '/auth/dev', {})
  await call(page, 'POST', '/profile/name', { name: 'E2E提督', comment: '' })
  await call(page, 'POST', '/profile/login')
  const { profile } = await call<WithProfile>(page, 'POST', '/gacha', { count: 10 })
  return profile
}

/**
 * Opens the harbour through the title screen. The latest news counts as
 * read unless news is set, and the gift box is empty unless gifts is set, so
 * their popups stay out of the way: gifts for everyone left in the local
 * database (say, from trying the admin console) would cover the harbour.
 */
export async function toHome(page: Page, { news = false, gifts = false } = {}) {
  if (!news) await page.addInitScript((id) => localStorage.setItem('newsSeen', id), NEWS[0].id)
  if (!gifts) await page.route('**/api/gifts', (r) => r.fulfill({ json: { gifts: [] } }))
  await page.goto('/')
  await page.locator('.title-screen').click()
  await expect(page.locator('.menu-tile').first()).toBeVisible()
}

/**
 * Deploys fleet (ship uids, in order) on stage 1-1 at placements through the
 * API, then enters the battle from the harbour's resume banner.
 */
export async function toBattle(page: Page, fleet: string[], placements: { row: number; col: number }[]) {
  await call(page, 'POST', '/profile/fleet', { uids: fleet })
  await call(page, 'POST', '/games', { stageId: '1-1', placements })
  await toHome(page)
  await page.locator('.resume-banner').click()
  await page.getByRole('button', { name: '戦闘に復帰' }).click()
  await expect(page.locator('.battle-board')).toBeVisible()
  await expect(page.locator('.flagship-line')).toContainText('行動する艦を選んで')
}

export const cell = (page: Page, row: number, col: number) => page.locator(`[data-cell="${row}-${col}"]`)
