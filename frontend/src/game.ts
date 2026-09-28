// Pure helpers that turn API data into things the UI shows.
import { posLabel, type GameView, type Result, type ShipClass, type ShipView } from './types'

export const DIRECTION = { north: '北', south: '南', east: '東', west: '西' } as const
export const KANJI: Record<ShipClass, string> = { battleship: '戦', destroyer: '駆', submarine: '潜' }

export type Tone = 'good' | 'bad' | 'info'
export interface LogLine {
  key: number
  turn: number
  text: string
  tone: Tone
}

let logSeq = 0

// describe turns a public action result into a battle report line.
export function describe(r: Result, game: GameView, turn: number): LogLine {
  const mine = r.side === 'player'
  const actor = (mine ? game.playerShips : game.enemyShips)[r.shipId]?.name ?? '?'
  const actorName = mine ? actor : `敵${actor}`
  const key = ++logSeq
  if (r.type === 'move') {
    return { key, turn, tone: 'info', text: `${actorName}、${DIRECTION[r.direction!]}へ${r.distance}マス航行` }
  }
  const at = posLabel(r.target!)
  const victims = mine ? game.enemyShips : game.playerShips
  if (r.hitShipId !== undefined) {
    const victim = (mine ? '敵' : '') + victims[r.hitShipId].name
    const outcome = r.sunk ? `${victim}を撃沈！` : `${victim}に命中！`
    return { key, turn, tone: mine ? 'good' : 'bad', text: `${actorName} → ${at} ${outcome}` }
  }
  if (r.splash) {
    return { key, turn, tone: mine ? 'good' : 'bad', text: `${actorName} → ${at} 水しぶき！${mine ? '付近に敵影' : '至近弾'}` }
  }
  return { key, turn, tone: 'info', text: `${actorName} → ${at} 外れ` }
}

// Rebuilds the log (newest first) with the turn each action happened in.
export function historyLog(game: GameView): LogLine[] {
  let turn = 0
  return game.history
    .map((r) => {
      if (r.side === 'player') turn++
      return describe(r, game, turn)
    })
    .reverse()
}

export type Damage = 'none' | 'light' | 'moderate' | 'heavy' | 'sunk'
export const DAMAGE_LABEL: Record<Damage, string> = {
  none: '',
  light: '小破',
  moderate: '中破',
  heavy: '大破',
  sunk: '撃沈',
}

export function damageOf(s: ShipView): Damage {
  if (s.hp <= 0) return 'sunk'
  const r = s.hp / s.maxHp
  if (r >= 1) return 'none'
  if (r > 0.5) return 'light'
  if (r > 0.25) return 'moderate'
  return 'heavy'
}

export type Rank = 'S' | 'A' | 'B' | 'C' | 'D' | 'E'

export interface Report {
  rank: Rank
  win: boolean
  sunkEnemies: number
  lostShips: number
  shots: number
  hits: number
  mvp?: ShipView
  mvpHits: number
}

export function report(game: GameView): Report {
  const win = game.winner === 'player'
  const sunkEnemies = game.enemyShips.filter((s) => s.hp <= 0).length
  const lostShips = game.playerShips.filter((s) => s.hp <= 0).length
  const rank: Rank = win ? (['S', 'A', 'B'] as const)[Math.min(lostShips, 2)] : (['E', 'D', 'C'] as const)[Math.min(sunkEnemies, 2)]

  const score = game.playerShips.map(() => 0)
  let shots = 0
  let hits = 0
  for (const r of game.history) {
    if (r.side !== 'player' || r.type !== 'attack') continue
    shots++
    if (r.hitShipId !== undefined) {
      hits++
      score[r.shipId] += r.sunk ? 3 : 2
    } else if (r.splash) {
      score[r.shipId] += 1
    }
  }
  const best = score.reduce((b, v, i) => (v > score[b] ? i : b), 0)
  return {
    rank,
    win,
    sunkEnemies,
    lostShips,
    shots,
    hits,
    mvp: shots > 0 ? game.playerShips[best] : undefined,
    mvpHits: game.history.filter((r) => r.side === 'player' && r.shipId === best && r.hitShipId !== undefined).length,
  }
}

export const SECRETARY_LINES: Record<ShipClass, string[]> = {
  battleship: [
    '主砲の整備は万全です。いつでも出撃できますよ！',
    '敵の配置を読み切れば、勝機は必ずあります。',
    '砲撃戦なら任せてください。',
    '提督、作戦会議の時間ですね？',
  ],
  destroyer: [
    '司令官、準備はできているよ。',
    '水しぶきが上がったら、近くに敵がいる合図だ。',
    '小さい艦だけど、甘く見ないでほしいな。',
    'ん……今日も海は静かだね。',
  ],
  submarine: [
    '潜航準備、完了です！',
    '海の中から、こっそり狙っちゃいます。',
    '弾は一発だけ……外さないようにしなきゃ。',
    '提督、ちゃんと見ててくださいね？',
  ],
}

export const TIPS = [
  '砲撃が「水しぶき」なら、着弾点の周囲 8 マスに敵艦が潜んでいます。',
  '敵が移動すると、方角と距離だけが通知されます。直前の位置と照らし合わせましょう。',
  '潜水艦の主砲は 1 発のみ。撃ち尽くした艦は移動でかく乱に回りましょう。',
  '自艦の位置が敵に割れたら、移動して狙いを外させるのも手です。',
  '全艦が撃沈されるか、弾切れになった側の負けです。残弾管理も勝負のうち。',
]
