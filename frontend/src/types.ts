export type Side = 'player' | 'cpu'
export type ShipClass = 'battleship' | 'cruiser' | 'destroyer' | 'submarine' | 'carrier'
export type SkillKind = 'barrage' | 'flare' | 'sonar' | 'torpedo' | 'airstrike'
export type ActionType = 'attack' | 'move' | 'skill' | 'ultimate'
export type Direction = 'north' | 'south' | 'east' | 'west'
export type EndReason = 'annihilated' | 'disarmed' | 'judgment'
export type Rarity = 0 | 1 | 2 | 3 | 4

export interface Pos {
  row: number
  col: number
}

export interface Spec {
  key: string
  class: ShipClass
  name: string
  rarity: number
  hp: number
  ammo: number
  skill: number
  crit: number
  evasion: number
  boss?: boolean
}

export interface ShipView {
  id: number
  key: string
  class: ShipClass
  name: string
  rarity: number
  boss?: boolean
  hp: number
  maxHp: number
  ammo: number
  maxAmmo: number
  skillKind: SkillKind
  skill: number
  maxSkill: number
  crit: number
  evasion: number
  pos?: Pos
  spotted?: boolean
  spottedTurn?: number
  attackTargets?: Pos[]
  moveTargets?: Pos[]
  skillTargets?: Pos[]
}

export interface Shot {
  target: Pos
  hitShipId?: number
  damage?: number
  crit?: boolean
  evaded?: boolean
  sunk?: boolean
  splash?: boolean
}

export interface Sighting {
  shipId: number
  pos: Pos
  turn: number
}

export interface Result {
  side: Side
  type: ActionType
  shipId: number
  skill?: SkillKind
  target?: Pos
  shots?: Shot[]
  path?: Pos[]
  scanned?: Pos[]
  revealed?: Sighting[]
  direction?: Direction
  distance?: number
  hidden?: boolean
  combo: number
  gauge: number
}

export interface GameView {
  boardSize: number
  turn: number
  maxTurns: number
  status: 'in_progress' | 'finished'
  winner?: Side
  endReason?: EndReason
  gauge: number
  enemyGauge: number
  combo: number
  maxCombo: number
  playerShips: ShipView[]
  enemyShips: ShipView[]
  history: Result[]
}

export interface Stage {
  id: string
  area: number
  no: number
  name: string
  brief: string
  size: number
  maxTurns: number
  starTurns: number
  ai: number
  enemies: string[]
  boss?: boolean
  coins: number
  exp: number
  firstGems: number
  dropRate: number
  dropWeights: number[]
  floor?: number
}

export interface Area {
  no: number
  name: string
  theme: string
}

export interface Card {
  id: string
  class: ShipClass
  name: string
  title: string
  rarity: Rarity
  color: string
  hp: number
  ammo: number
  skill: number
  crit: number
  evasion: number
  intro: string
  attack: string
  home: string[]
}

export interface Gain {
  card: string
  uid: string
  rarity: Rarity
  new: boolean
  stars: number
  gems?: number
}

export interface Grant {
  coins?: number
  gems?: number
  exp?: number
  cards?: Gain[]
}

export interface Chest {
  tier: number
  grant: Grant
}

export interface LevelUp {
  from: number
  to: number
  gems: number
  coins: number
}

export interface ShipGrowth {
  uid: string
  card: string
  from: number
  to: number
  exp: number
  mvp?: boolean
}

export interface Reward {
  win: boolean
  rank: 'S' | 'A' | 'B' | 'C' | 'D' | 'E'
  endReason: EndReason
  turns: number
  stars: number
  newStars: number
  floor?: number
  record?: boolean
  streak: number
  stats: { hits: number; shots: number; crits: number; sunk: number; lost: number; skills: number; ultimates: number; maxCombo: number }
  mvp: number
  lines: { label: string; coins?: number; gems?: number }[]
  coins: number
  gems: number
  exp: number
  fromLevel: number
  fromExp: number
  toLevel: number
  toExp: number
  levelUp?: LevelUp
  ships: ShipGrowth[]
  drop?: Gain
  chests: Chest[]
  picked: number
}

export interface MatchResponse {
  id: string
  game: GameView
  stage: Stage
  fleet: string[]
  reward?: Reward
}

export interface ActionResponse {
  player: Result
  cpu?: Result
  game: GameView
  reward?: Reward
  profile?: Profile
}

export interface OwnedShip {
  uid: string
  card: string
  level: number
  exp: number
  stars: number
  obtained: string
  stats: Spec
  power: number
  maxLevel: number
  nextExp: number
  trainCost: number
}

export interface Mission {
  id: string
  title: string
  stat: string
  goal: number
  gems?: number
  coins?: number
}

export interface Profile {
  id: string
  name: string
  level: number
  exp: number
  nextExp: number
  coins: number
  gems: number
  ships: OwnedShip[]
  fleet: string[]
  fleetSlots: number
  fleetPower: number
  secretary: string
  stages: Record<string, number>
  totalStars: number
  endless: number
  gacha: { pity: number; pulls: number; freeTenUsed: boolean }
  pityLeft: number
  login: { last: string; day: number; total: number }
  daily: { date: string; progress: Record<string, number>; claimed: Record<string, boolean> }
  achievements: Record<string, boolean>
  stats: {
    battles: number
    wins: number
    losses: number
    streak: number
    bestStreak: number
    sunk: number
    hits: number
    crits: number
    maxCombo: number
    ultimates: number
    skills: number
    ssrs: number
  }
  badges: { login: boolean; missions: number; achievements: number; freeTen: boolean }
}

export interface Catalog {
  cards: Card[]
  areas: Area[]
  stages: Stage[]
  enemies: Spec[]
  pullRates: number[]
  pullCost: number
  tenPullCost: number
  pityPulls: number
  missions: Mission[]
  dailyAll: Mission
  achievements: Mission[]
  loginRewards: Grant[]
}

export interface GameSummary {
  id: string
  stageId: string
  turn: number
  winner: Side
  rank: string
  finishedAt: string
}

export const samePos = (a?: Pos | null, b?: Pos | null) => !!a && !!b && a.row === b.row && a.col === b.col

export const COLS = 'ABCDEFGH'
export const posLabel = (p: Pos) => `${COLS[p.col]}${p.row + 1}`
