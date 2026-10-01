import { expect, test, type Page } from '@playwright/test'
import { call, newAdmiral, toHome } from './helpers'
import type { ActionResponse, GameView, MatchResponse, Pos } from '../src/types'

const shots = 'e2e/results/shots'
const pick = (ps: Pos[]) => ps[Math.floor(Math.random() * ps.length)]

/** Plays a 1-1 battle through the API with a trigger-happy fleet until it ends. */
async function fight(page: Page, placements: Pos[]): Promise<{ id: string; game: GameView }> {
  const m = await call<MatchResponse>(page, 'POST', '/games', { stageId: '1-1', placements })
  let g = m.game
  for (let step = 0; g.status !== 'finished' && step < 300; step++) {
    const alive = g.playerShips.filter((s) => s.hp > 0)
    const s = alive[Math.floor(Math.random() * alive.length)]
    const action =
      g.gauge >= 100
        ? { type: 'ultimate', shipId: s.id, target: { row: 2, col: 2 } }
        : s.attackTargets?.length
          ? { type: 'attack', shipId: s.id, target: pick(s.attackTargets) }
          : { type: 'move', shipId: s.id, target: pick(s.moveTargets ?? []) }
    g = (await call<ActionResponse>(page, 'POST', `/games/${m.id}/actions`, action)).game
  }
  return { id: m.id, game: g }
}

test('after a win on a campaign stage, 再戦 sorties there again with the same deployment', async ({ page }) => {
  test.setTimeout(180_000)
  const p = await newAdmiral(page)
  await call(page, 'POST', '/profile/fleet', { uids: p.fleet })
  const placements = [
    { row: 0, col: 0 },
    { row: 2, col: 2 },
    { row: 4, col: 4 },
  ].slice(0, p.fleet.length)

  let won: string | undefined
  for (let i = 0; i < 8 && !won; i++) {
    const { id, game } = await fight(page, placements)
    if (game.winner === 'player') won = id
  }
  test.skip(!won, 'no win in eight tries')

  // Bring the finished battle up through the resume banner so its result shows.
  await page.route('**/api/games/current', async (route) => {
    const res = await page.request.fetch(`/api/games/${won}`)
    await route.fulfill({ response: res })
  })
  await toHome(page)
  await page.locator('.resume-banner').click()
  await page.getByRole('button', { name: '戦闘に復帰' }).click()

  const result = page.locator('.result.win')
  await expect(result).toBeVisible()
  await result.click() // skip the reveal
  const again = page.locator('.result-actions').getByRole('button', { name: '再戦' })
  await expect(again).toBeVisible()
  await expect(page.locator('.result-actions').getByRole('button', { name: /次の海域へ/ })).toBeVisible()
  await page.screenshot({ path: `${shots}/result-win-rematch.png` })

  await page.unroute('**/api/games/current')
  await again.click()
  await expect(page.locator('.result')).toBeHidden()
  await expect(page.locator('.battle-board')).toBeVisible()
  const current = await call<MatchResponse>(page, 'GET', '/games/current')
  expect(current.id).not.toBe(won)
  expect(current.stage.id).toBe('1-1')
  expect(current.game.status).toBe('in_progress')
  expect(current.game.playerShips.map((s) => s.pos)).toEqual(placements)
  await page.screenshot({ path: `${shots}/result-win-rematch-battle.png` })
})
