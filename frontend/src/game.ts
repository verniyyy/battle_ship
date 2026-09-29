// Pure helpers that turn API data into things the UI shows.
import type { ActionType, Card, Catalog, FxPreset, GameView, Pos, Rarity, Result, ShipClass, ShipView, SkillKind, Special, Stage, Stats, Weather } from './types'
import { posLabel } from './types'

export const DIRECTION = { north: '北', south: '南', east: '東', west: '西' } as const

// gun / move mirror game.Classes on the server: main-gun reach and cells per move.
export const CLASS_INFO: Record<ShipClass, { kanji: string; name: string; color: string; gun: number; move: number; role: string }> = {
  battleship: { kanji: '戦', name: '戦艦', color: '#e0a93a', gun: 2, move: 1, role: '主砲は十字に着弾。外れても水柱で敵を足止め' },
  cruiser: { kanji: '巡', name: '巡洋艦', color: '#9b7bff', gun: 2, move: 2, role: '射程 2 の主砲と魚雷を併せ持つ万能艦' },
  destroyer: { kanji: '駆', name: '駆逐艦', color: '#3fa6f0', gun: 1, move: 3, role: '最速。砲撃は潜水艦に 2 倍、魚雷も強力' },
  submarine: { kanji: '潜', name: '潜水艦', color: '#e25d8a', gun: 0, move: 2, role: 'ソナーでしか見つからず移動も秘匿。ただし紙装甲' },
  carrier: { kanji: '空', name: '空母', color: '#3fcf8e', gun: 1, move: 1, role: '全域へ高威力の爆撃。敵艦隊の対空で威力減' },
}
export const KANJI = Object.fromEntries(Object.entries(CLASS_INFO).map(([k, v]) => [k, v.kanji])) as Record<ShipClass, string>

export const SKILL_INFO: Record<SkillKind, { name: string; short: string; desc: string; icon: string }> = {
  barrage: { name: '一斉射', short: '3×3砲撃', desc: '3マス先までの3×3を砲撃（火力70%）。外れても水柱で足止め', icon: '✚' },
  flare: { name: '照明弾', short: '3×3索敵', desc: '3マス先までの3×3を照らし水上艦を発見（潜水艦は映らない）', icon: '✦' },
  sonar: { name: 'ソナー', short: '縦横索敵', desc: '自艦の縦横一列を探信し潜水艦も含め全艦を発見', icon: '◎' },
  spread: { name: '扇状雷撃', short: '3列魚雷', desc: '並んだ3本の魚雷を同時に放つ（雷装80%・後攻・発射位置が露見）', icon: '⋙' },
  airstrike: { name: '航空攻撃', short: '全域爆撃', desc: '海域のどこでも1マスを爆撃。回避されにくいが敵の対空で減衰', icon: '✈' },
}

export const TORPEDO_INFO = { name: '雷撃', icon: '➤', desc: '縦横に海の端まで直進し、最初の水上艦に命中。必ず後攻になり、雷跡で発射位置が露見する' }

export const SPECIAL_INFO: Record<Special, { name: string; en: string; desc: string }> = {
  spotting: { name: '着弾観測射撃', en: 'SPOTTING FIRE', desc: '直前に砲撃した地点へ戦艦・巡洋艦の主砲を再び撃つと必ず会心' },
  precision: { name: '精密爆撃', en: 'PRECISION STRIKE', desc: '追跡中の敵艦を爆撃すると対空・回避を無視' },
  pointblank: { name: '肉薄雷撃', en: 'POINT-BLANK TORPEDO', desc: '2マス以内の敵に魚雷が命中すると必ず会心' },
}

export const WEATHER_INFO: Record<Weather, { name: string; icon: string; desc: string }> = {
  clear: { name: '快晴', icon: '☀', desc: '特殊効果なし' },
  fog: { name: '濃霧', icon: '≋', desc: '全艦の回避+10%。爆撃も普通に回避される' },
  storm: { name: '時化', icon: '≈', desc: '移動距離-1（最低1）。魚雷の威力-25%' },
  night: { name: '夜戦', icon: '☾', desc: '魚雷の威力+25%。航空攻撃の威力半減' },
}

export const skillOf = (c: ShipClass): SkillKind =>
  (({ battleship: 'barrage', cruiser: 'flare', destroyer: 'sonar', submarine: 'spread', carrier: 'airstrike' }) as const)[c]

// Bar scales for stat displays: roughly the best a maxed ship reaches.
const STAT_SCALE = { hp: 1000, firepower: 320, torpedo: 460, air: 500, aa: 80, armor: 35, speed: 40, crit: 40, evasion: 40 }

/** The stats worth showing for a ship, as [label, value, bar scale, unit]. Zero weapons are skipped. */
export function statRows(s: Stats): [string, number, number, string][] {
  const rows: [string, number, number, string][] = [['耐久', s.hp, STAT_SCALE.hp, '']]
  if (s.firepower) rows.push(['火力', s.firepower, STAT_SCALE.firepower, ''])
  if (s.torpedo) rows.push(['雷装', s.torpedo, STAT_SCALE.torpedo, ''])
  if (s.air) rows.push(['航空', s.air, STAT_SCALE.air, ''])
  rows.push(
    ['対空', s.aa, STAT_SCALE.aa, ''],
    ['装甲', s.armor, STAT_SCALE.armor, '%'],
    ['速力', s.speed, STAT_SCALE.speed, ''],
    ['会心', s.crit, STAT_SCALE.crit, '%'],
    ['回避', s.evasion, STAT_SCALE.evasion, '%'],
  )
  return rows
}

/** Uses per battle, e.g. "砲7・雷3・一斉射2". */
export function usesLine(s: Stats, cls: ShipClass) {
  const parts: string[] = []
  if (s.ammo) parts.push(`砲${s.ammo}`)
  if (s.torps) parts.push(`雷${s.torps}`)
  parts.push(`${SKILL_INFO[skillOf(cls)].name}${s.skill}`)
  return parts.join('・')
}

export const RARITY = ['N', 'R', 'SR', 'SSR', 'UR'] as const
export const rarityName = (r: number) => RARITY[r] ?? 'N'

// Mirrors game.Footprint on the server so aims can be previewed.
export function footprint(size: number, type: ActionType, kind: SkillKind | undefined, cls: ShipClass | undefined, from: Pos, target: Pos): Pos[] {
  const out: Pos[] = []
  const inside = (p: Pos) => p.row >= 0 && p.row < size && p.col >= 0 && p.col < size
  const add = (p: Pos) => {
    if (inside(p)) out.push(p)
  }
  const area = () => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) add({ row: target.row + dr, col: target.col + dc })
  }
  const lane = (start: Pos, dr: number, dc: number) => {
    for (let p = start; inside(p); p = { row: p.row + dr, col: p.col + dc }) out.push(p)
  }
  const dr = target.row - from.row
  const dc = target.col - from.col
  if (type === 'ultimate') area()
  else if (type === 'attack' && cls === 'battleship') {
    add(target)
    for (const [r, c] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      add({ row: target.row + r, col: target.col + c })
  } else if (type === 'torpedo') lane(target, dr, dc)
  else if (type === 'skill' && kind === 'spread') {
    for (const k of [-1, 0, 1]) lane({ row: target.row + k * dc, col: target.col + k * dr }, dr, dc)
  } else if (type === 'skill' && (kind === 'barrage' || kind === 'flare')) area()
  else if (type === 'skill' && kind === 'sonar') {
    for (let i = 0; i < size; i++) {
      if (i !== from.col) add({ row: from.row, col: i })
      if (i !== from.row) add({ row: i, col: from.col })
    }
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

const DIR_LABEL = (from: Pos | undefined, to: Pos | undefined) => {
  if (!from || !to) return ''
  if (to.row < from.row) return '北'
  if (to.row > from.row) return '南'
  return to.col > from.col ? '東' : '西'
}

// describe turns a public action result into a battle report line.
export function describe(r: Result, game: GameView): LogLine {
  const mine = r.side === 'player'
  const actor = shipName(game, r.side, r.shipId)
  const key = ++logSeq
  const victims = mine ? game.enemyShips : game.playerShips
  const line = (text: string, tone: Tone): LogLine => ({ key, turn: r.round, text, tone })

  if (r.cancelled) {
    const sunk = (mine ? game.playerShips : game.enemyShips)[r.shipId]?.hp <= 0
    return line(`${actor}は${sunk ? '行動前に撃沈された' : '水柱に阻まれ動けなかった'}`, mine ? 'bad' : 'good')
  }
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
  const torpedo = r.type === 'torpedo' || r.skill === 'spread'
  const how =
    r.special
      ? SPECIAL_INFO[r.special].name
      : r.type === 'ultimate'
        ? '全艦斉射'
        : r.type === 'torpedo'
          ? TORPEDO_INFO.name
          : r.type === 'skill'
            ? SKILL_INFO[r.skill!].name
            : '砲撃'
  const at = torpedo ? `${DIR_LABEL(r.origin, r.target)}へ` : r.target ? `${posLabel(r.target)}へ` : ''
  const parts: string[] = []
  if (sunk.length) parts.push(`${sunk.map((s) => victims[s.hitShipId!]?.name).join('・')}を撃沈！`)
  const dmg = hits.reduce((a, s) => a + (s.damage ?? 0), 0)
  if (hits.length && hits.length > sunk.length) parts.push(`${dmg}ダメージ${hits.some((h) => h.crit) ? '（会心！）' : ''}`)
  if (evaded.length) parts.push('回避された')
  if (!parts.length) parts.push(shots.some((s) => s.splash) ? '水しぶき！付近に艦影' : torpedo ? '魚雷は外れた' : '外れ')
  if (r.columns?.length) parts.push('水柱で足止め')
  if (torpedo && !mine) parts.push('（雷跡で位置判明）')
  const tone: Tone = hits.length ? (mine ? (sunk.length ? 'great' : 'good') : 'bad') : 'info'
  return line(`${actor}の${how}${at ? ' → ' + at : ''} ${parts.join(' ')}`, tone)
}

// Rebuilds the log (newest first).
export function historyLog(game: GameView): LogLine[] {
  return game.history.map((r) => describe(r, game)).reverse()
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
  fx?: FxPreset
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

export const lookOfCard = (c: Card): Look => ({ cls: c.class, name: c.name, rarity: c.rarity, color: c.color, cardId: c.id, fx: c.fx })

export function stageLabel(s: Stage) {
  return s.floor ? `EX-${s.floor}` : s.id
}

export const TIPS = [
  '毎ターン、両軍が同時に行動を決め、速力の高い艦から動きます。魚雷だけは必ず最後。',
  '同じ地点へ戦艦・巡洋艦の主砲を 2 連続で撃つと「着弾観測射撃」。必ず会心になります。',
  '追跡中の敵艦を爆撃すると「精密爆撃」。対空砲火も回避も無視します。',
  '2 マス以内の敵に魚雷を当てると「肉薄雷撃」。必ず会心！',
  '戦艦の砲弾が外れても、周りの水上艦は水柱で次のターンまで動けません。',
  '一度見つけた水上艦は、どこへ移動しても追跡され続けます。逃げるより撃ち合いを。',
  '潜水艦はソナーでしか見つからず、移動も秘匿。ただし魚雷を撃つと雷跡で位置がばれます。',
  '駆逐艦の砲撃は潜水艦に 2 倍のダメージ。潜水艦狩りは駆逐艦の仕事です。',
  '空母の爆撃は敵艦隊の対空合計で弱まります。対空の高い艦から沈めるのも手。',
  '海況は出撃ごとに変わります。夜戦は魚雷が冴え、艦載機が鈍る海。',
  '攻撃手段が尽きた艦隊は戦略的撤退。弾薬の使いどころを見極めましょう。',
]

export const RANK_TEXT = { S: '完全勝利', A: '勝利', B: '辛勝', C: '戦術的敗北', D: '敗北', E: '惨敗' } as const
