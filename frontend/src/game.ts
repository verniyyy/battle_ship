// Pure helpers that turn API data into things the UI shows.
import type { ActionType, Card, Catalog, GameView, Pos, Rarity, Result, ShipClass, ShipView, SkillKind, Stage } from './types'
import { posLabel } from './types'

export const DIRECTION = { north: '北', south: '南', east: '東', west: '西' } as const

export const CLASS_INFO: Record<ShipClass, { kanji: string; name: string; color: string }> = {
  battleship: { kanji: '戦', name: '戦艦', color: '#e0a93a' },
  cruiser: { kanji: '巡', name: '巡洋艦', color: '#9b7bff' },
  destroyer: { kanji: '駆', name: '駆逐艦', color: '#3fa6f0' },
  submarine: { kanji: '潜', name: '潜水艦', color: '#e25d8a' },
  carrier: { kanji: '空', name: '空母', color: '#3fcf8e' },
}
export const KANJI = Object.fromEntries(Object.entries(CLASS_INFO).map(([k, v]) => [k, v.kanji])) as Record<ShipClass, string>

export const SKILL_INFO: Record<SkillKind, { name: string; short: string; desc: string; icon: string }> = {
  barrage: { name: '一斉射', short: '十字砲撃', desc: '2マス先までの地点を中心に十字5マスを砲撃', icon: '✚' },
  flare: { name: '照明弾', short: '3×3索敵', desc: '3マス先までの3×3を照らし水上艦を発見（潜水艦は映らない）', icon: '✦' },
  sonar: { name: 'ソナー', short: '縦横索敵', desc: '自艦の縦横一列を探信し潜水艦も含め全艦を発見', icon: '◎' },
  torpedo: { name: '魚雷', short: '直線2ダメ', desc: '縦横に直進し最初に当たった敵へ2ダメージ', icon: '➤' },
  airstrike: { name: '航空攻撃', short: '全域爆撃', desc: '海域のどこでも1マスを爆撃（位置を悟られない）', icon: '✈' },
}

export const RARITY = ['N', 'R', 'SR', 'SSR', 'UR'] as const
export const rarityName = (r: number) => RARITY[r] ?? 'N'

// Mirrors game.Footprint on the server so aims can be previewed.
export function footprint(size: number, type: ActionType, kind: SkillKind | undefined, from: Pos, target: Pos): Pos[] {
  const out: Pos[] = []
  const add = (p: Pos) => {
    if (p.row >= 0 && p.row < size && p.col >= 0 && p.col < size) out.push(p)
  }
  const area = () => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) add({ row: target.row + dr, col: target.col + dc })
  }
  if (type === 'ultimate') area()
  else if (type === 'skill' && kind === 'barrage') {
    add(target)
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      add({ row: target.row + dr, col: target.col + dc })
  } else if (type === 'skill' && kind === 'flare') area()
  else if (type === 'skill' && kind === 'sonar') {
    for (let i = 0; i < size; i++) {
      if (i !== from.col) add({ row: from.row, col: i })
      if (i !== from.row) add({ row: i, col: from.col })
    }
  } else if (type === 'skill' && kind === 'torpedo') {
    const dr = target.row - from.row
    const dc = target.col - from.col
    for (let p = target; p.row >= 0 && p.row < size && p.col >= 0 && p.col < size; p = { row: p.row + dr, col: p.col + dc }) out.push(p)
  } else add(target)
  return out
}

export type Tone = 'good' | 'bad' | 'info' | 'great'
export interface LogLine {
  key: number
  turn: number
  text: string
  tone: Tone
}

let logSeq = 0

export function shipName(game: GameView, side: 'player' | 'cpu', id: number) {
  const s = (side === 'player' ? game.playerShips : game.enemyShips)[id]
  return s ? (side === 'cpu' ? s.name : s.name) : '?'
}

// describe turns a public action result into a battle report line.
export function describe(r: Result, game: GameView, turn: number): LogLine {
  const mine = r.side === 'player'
  const actor = shipName(game, r.side, r.shipId)
  const key = ++logSeq
  const victims = mine ? game.enemyShips : game.playerShips
  const line = (text: string, tone: Tone): LogLine => ({ key, turn, text, tone })

  if (r.type === 'move') {
    if (r.hidden) return line(`${actor}、潜航して移動（位置不明）`, 'info')
    return line(`${actor}、${DIRECTION[r.direction!]}へ${r.distance}マス航行`, 'info')
  }
  if (r.revealed !== undefined || r.scanned) {
    const n = r.revealed?.length ?? 0
    const what = SKILL_INFO[r.skill!].name
    if (!mine) return line(`${actor}の${what}！${n ? `味方${n}隻が発見された` : '味方は見つからなかった'}`, n ? 'bad' : 'info')
    return line(`${actor}の${what}！${n ? `敵艦${n}隻を発見！` : '反応なし'}`, n ? 'great' : 'info')
  }
  const shots = r.shots ?? []
  const hits = shots.filter((s) => (s.damage ?? 0) > 0)
  const sunk = shots.filter((s) => s.sunk)
  const evaded = shots.filter((s) => s.evaded)
  const how = r.type === 'ultimate' ? '全艦斉射' : r.type === 'skill' ? SKILL_INFO[r.skill!].name : '砲撃'
  const at = r.target ? `${posLabel(r.target)}へ` : ''
  const parts: string[] = []
  if (sunk.length) parts.push(`${sunk.map((s) => victims[s.hitShipId!]?.name).join('・')}を撃沈！`)
  const dmg = hits.reduce((a, s) => a + (s.damage ?? 0), 0)
  if (hits.length && hits.length > sunk.length) parts.push(`${dmg}ダメージ${hits.some((h) => h.crit) ? '（クリティカル！）' : ''}`)
  if (evaded.length) parts.push('回避された')
  if (!parts.length) parts.push(shots.some((s) => s.splash) ? '水しぶき！付近に艦影' : r.skill === 'torpedo' ? '魚雷は外れた' : '外れ')
  const tone: Tone = hits.length ? (mine ? (sunk.length ? 'great' : 'good') : 'bad') : 'info'
  return line(`${actor}の${how}${at ? ' → ' + at : ''} ${parts.join(' ')}`, tone)
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
export const DAMAGE_LABEL: Record<Damage, string> = { none: '', light: '小破', moderate: '中破', heavy: '大破', sunk: '撃沈' }

export function damageOf(s: { hp: number; maxHp: number }): Damage {
  if (s.hp <= 0) return 'sunk'
  const r = s.hp / s.maxHp
  if (r >= 1) return 'none'
  if (r > 0.5) return 'light'
  if (r > 0.25) return 'moderate'
  return 'heavy'
}

export const cardOf = (cat: Catalog | null, id: string): Card | undefined => cat?.cards.find((c) => c.id === id)

/** Card-like description of any ship (owned card or enemy template). */
export interface Look {
  cls: ShipClass
  name: string
  rarity: Rarity
  color: string
  enemy?: boolean
  boss?: boolean
  cardId?: string
}

export function lookOfShip(cat: Catalog | null, s: ShipView, enemy: boolean): Look {
  const c = enemy ? undefined : cardOf(cat, s.key)
  return {
    cls: s.class,
    name: s.name,
    rarity: (s.rarity ?? 0) as Rarity,
    color: c?.color ?? (enemy ? (s.boss ? '#ff3b5c' : '#b33a3a') : CLASS_INFO[s.class].color),
    enemy,
    boss: s.boss,
    cardId: c?.id,
  }
}

export const lookOfCard = (c: Card): Look => ({ cls: c.class, name: c.name, rarity: c.rarity, color: c.color, cardId: c.id })

export function stageLabel(s: Stage) {
  return s.floor ? `EX-${s.floor}` : s.id
}

export const TIPS = [
  '「水しぶき」は着弾点の周囲 8 マスに水上艦がいる合図。潜水艦は水しぶきに映りません。',
  '潜水艦の移動は敵に通知されません。見つかったら潜って逃げましょう。',
  'ソナーは潜水艦も発見できます。照明弾は水上艦だけ。',
  '命中を続けるとコンボが伸び、決戦ゲージが一気に溜まります。',
  '決戦ゲージが満タンになったら「全艦斉射」で 3×3 を一網打尽！',
  '空母の航空攻撃は海域のどこにでも届き、自分の位置を悟られません。',
  'ターン制限に達すると残り耐久の割合で判定。粘り勝ちも立派な戦術です。',
  '連勝するほど報酬がアップ。ストリークを途切れさせるな！',
  '同じ艦を重ねると限界突破。レベル上限とステータスが伸びます。',
]

export const RANK_TEXT = { S: '完全勝利', A: '勝利', B: '辛勝', C: '戦術的敗北', D: '敗北', E: '惨敗' } as const
