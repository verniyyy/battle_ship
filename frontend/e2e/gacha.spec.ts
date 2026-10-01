import { expect, test, type Page } from '@playwright/test'
import type { Profile } from '../src/types'
import { call, newAdmiral, toHome } from './helpers'

const shots = 'e2e/results/shots'

test('the construction banner can be turned by hand: arrows, dots, swipe and keys', async ({ page }) => {
  await newAdmiral(page)
  await toHome(page)
  await page.locator('.menu-tile.gacha').click()
  const banner = page.locator('.banner-art')
  const name = banner.locator('.banner-copy b')
  const dots = banner.locator('.banner-dots button')
  await expect(dots.first()).toBeVisible()
  const n = await dots.count()
  expect(n).toBeGreaterThan(2)
  const names = await dots.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

  const shownIndex = async () => names.indexOf(await name.innerText())
  const start = await shownIndex()
  await page.screenshot({ path: `${shots}/gacha-banner.png` })

  // Next and back with the arrows.
  await page.getByRole('button', { name: '次の艦' }).click()
  await expect(name).toHaveText(names[(start + 1) % n]!)
  await expect(dots.nth((start + 1) % n)).toHaveClass(/on/)
  await page.getByRole('button', { name: '前の艦' }).click()
  await expect(name).toHaveText(names[start]!)

  // Straight to a ship by its dot.
  const pick = (start + 3) % n
  await dots.nth(pick).click()
  await expect(name).toHaveText(names[pick]!)

  // A swipe to the left shows the next one.
  const box = (await banner.boundingBox())!
  const y = box.y + box.height * 0.3
  await page.mouse.move(box.x + box.width * 0.7, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.4, y, { steps: 5 })
  await page.mouse.up()
  await expect(name).toHaveText(names[(pick + 1) % n]!)

  // And the arrow keys, once the banner has focus.
  await banner.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(name).toHaveText(names[pick]!)
  await page.screenshot({ path: `${shots}/gacha-banner-picked.png` })

  // A ship picked by hand stays up longer than the auto-advance's 3.2 s.
  await page.waitForTimeout(4500)
  await expect(name).toHaveText(names[pick]!)
})

/**
 * Serves the next pulls with the given rarities (cards picked from the catalogue) and enough
 * gems to pay, so the top-rarity show can be checked without luck.
 */
async function rigPulls(page: Page, rarities: number[]) {
  const { cards } = await call<{ cards: { id: string; rarity: number }[] }>(page, 'GET', '/catalog')
  await page.route('**/api/profile', async (r) => {
    const res = await r.fetch()
    const json = await res.json()
    json.profile.gems = 99999
    await r.fulfill({ response: res, json })
  })
  await page.route('**/api/gacha', async (r) => {
    const { profile } = await call<{ profile: Profile }>(page, 'GET', '/profile')
    const gains = rarities.map((rarity, i) => ({ card: cards.find((c) => c.rarity === rarity)!.id, uid: `rig-${i}`, rarity, new: true, stars: 1 }))
    await r.fulfill({ json: { profile: { ...profile, gems: 99999 }, gains } })
  })
}

/**
 * Logs each beat of the top-rarity show as it happens (cut-in, the card turning, the ship's stage),
 * since the beats pass too quickly to catch one by one.
 */
async function recordShow(page: Page) {
  await page.evaluate(() => {
    const log: string[] = []
    ;(window as unknown as { showLog: string[] }).showLog = log
    const note = (e: string) => log[log.length - 1] !== e && log.push(e)
    new MutationObserver(() => {
      const word = document.querySelector('.spotlight.intro .intro-word')?.textContent
      if (word) note(`cutin:${word} open:${document.querySelectorAll('.flip.open').length}`)
      const hero = document.querySelector('.flip.hero.open')
      if (hero && !document.querySelector('.spotlight')) note(`turn:${[...hero.classList].find((c) => /^r\d$/.test(c))}`)
      const rarity = document.querySelector('.spot-rarity')?.textContent
      if (rarity) note(`spot:${rarity}`)
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  })
}

const shown = (page: Page) => page.evaluate(() => (window as unknown as { showLog: string[] }).showLog)

test('a ten-pull with a UR and an SSR plays the full top-rarity show', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await newAdmiral(page)
  await rigPulls(page, [1, 0, 3, 1, 0, 2, 0, 4, 1, 0])
  await toHome(page)
  await page.locator('.menu-tile.gacha').click()
  await recordShow(page)
  await page.locator('.pull-btn.ten').click()

  // A UR always opens on the glitch omen, then the dock hammers up to prism.
  await expect(page.locator('.omen-glitch')).toBeVisible()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${shots}/gacha-omen-glitch.png` })
  await expect(page.locator('.dock-light.o4')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.step-pips i.on')).toHaveCount(3)
  // The build-up is told in light and sound only, never in words.
  await expect(page.locator('.gacha-roll')).toHaveText('TAP TO SKIP')
  await page.screenshot({ path: `${shots}/gacha-roll-prism.png` })

  // The reveal holds its breath over the SSR before turning it.
  await expect(page.locator('.flip.tease.r3')).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: `${shots}/gacha-tease.png` })

  // The SSR stops the run (the cards after it stay face down) for its cut-in; then the card itself
  // turns at centre stage, and only after that does the ship's stage open.
  const spot = page.locator('.spotlight')
  await expect(spot.locator('.spot-rarity')).toHaveText('SSR', { timeout: 10_000 })
  expect(await shown(page)).toEqual(['cutin:SSR open:2', 'turn:r3', 'spot:SSR'])
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${shots}/gacha-spotlight-ssr.png` })
  await spot.click()

  // Then the run picks up again, up to the UR.
  await expect(spot.locator('.spot-rarity')).toHaveText('UR', { timeout: 15_000 })
  expect((await shown(page)).slice(3)).toEqual(['cutin:UR open:7', 'turn:r4', 'spot:UR'])
  await expect(spot.locator('.spot-new')).toBeVisible()
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${shots}/gacha-spotlight-ur.png` })
  await spot.click()

  // The haul calls out the double.
  await expect(page.locator('.haul em')).toHaveText('DOUBLE!!')
  await expect(page.locator('.haul b')).toHaveText('UR ×1SSR ×1獲得！')
  await expect(page.locator('.flip.open')).toHaveCount(10)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${shots}/gacha-haul.png` })
  expect(errors).toEqual([])
})

// Each rnd value picks one SSR omen (see rollPlan): 0.2 the red alert, 0.5 sonar, 0.69 searchlights.
for (const [omen, rnd] of [
  ['alert', 0.2],
  ['sonar', 0.5],
  ['flood', 0.69],
] as const)
  test(`an SSR single pull can open on the ${omen} omen, without a word on screen`, async ({ page }) => {
    await newAdmiral(page)
    await rigPulls(page, [3])
    await toHome(page)
    await page.locator('.menu-tile.gacha').click()
    await page.evaluate((r) => (Math.random = () => r), rnd)
    await recordShow(page)
    await page.locator('.pull-btn.one').click()
    await expect(page.locator(`.omen-${omen}`)).toBeVisible()
    await expect(page.locator('.gacha-roll')).toHaveText('TAP TO SKIP')
    for (const k of [1, 2, 3]) {
      await page.waitForTimeout(350)
      await page.screenshot({ path: `${shots}/gacha-omen-${omen}-${k}.png` })
    }
    // Skipping still lands on the cut-in, and the card still turns before the ship's stage.
    // (Taps on the stage itself: the screen shakes, so an element click would wait for it to settle.)
    await page.mouse.click(640, 640)
    await page.mouse.click(640, 640)
    await expect(page.locator('.spotlight .spot-rarity')).toHaveText('SSR', { timeout: 8_000 })
    expect(await shown(page)).toEqual(['cutin:SSR open:0', 'turn:r3', 'spot:SSR'])
  })
