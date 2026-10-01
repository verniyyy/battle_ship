export type Side = 'player' | 'cpu'
export type ShipClass = 'battleship' | 'cruiser' | 'destroyer' | 'submarine' | 'carrier'
export type SkillKind = 'barrage' | 'flare' | 'sonar' | 'spread' | 'airstrike'
export type ActionType = 'attack' | 'torpedo' | 'move' | 'skill' | 'ultimate'
export type Special = 'spotting' | 'precision' | 'pointblank' | 'marked'
export type Weather = 'clear' | 'fog' | 'storm' | 'night'
export type Direction = 'north' | 'south' | 'east' | 'west'
export type EndReason = 'annihilated' | 'disarmed' | 'judgment' | 'abandoned'
export type Rarity = 0 | 1 | 2 | 3 | 4

export interface Pos {
  row: number
  col: number
}

/** A ship's battle numbers. */
export interface Stats {
  hp: number
  firepower: number
  torpedo: number
  air: number
  aa: number
  armor: number
  speed: number
  ammo: number
  torps: number
  skill: number
  crit: number
  evasion: number
}

export interface Spec extends Stats {
  key: string
  class: ShipClass
  name: string
  rarity: number
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
  torps: number
  maxTorps: number
  skillKind: SkillKind
  skill: number
  maxSkill: number
  firepower: number
  torpedo: number
  air: number
  aa: number
  armor: number
  speed: number
  crit: number
  evasion: number
  gunRange: number
  moveRange: number
  pinned?: boolean
  /** A flare or sonar locked on: hits on it cannot miss and always crit, until the end of next round. */
  marked?: boolean
  /** Moved last round: moving again resolves late. */
  underWay?: boolean
  pos?: Pos
  spotted?: boolean
  spottedTurn?: number
  attackTargets?: Pos[]
  torpedoTargets?: Pos[]
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
  /** The ship hit was locked on to by a scouting skill. */
  marked?: boolean
}

export interface Sighting {
  shipId: number
  pos: Pos
  turn: number
}

export interface Result {
  side: Side
  /** 'recon' is a scout-plane report after a quiet spell; its shipId is -1. */
  type: ActionType | 'recon'
  shipId: number
  skill?: SkillKind
  round: number
  speed: number
  late?: boolean
  cancelled?: boolean
  special?: Special
  target?: Pos
  shots?: Shot[]
  origin?: Pos
  paths?: Pos[][]
  columns?: Pos[]
  scanned?: Pos[]
  revealed?: Sighting[]
  direction?: Direction
  distance?: number
  hidden?: boolean
  blocked?: boolean
  contact?: boolean
  combo: number
  gauge: number
}

export interface GameView {
  boardSize: number
  turn: number
  maxTurns: number
  weather: Weather
  status: 'in_progress' | 'finished'
  winner?: Side
  endReason?: EndReason
  gauge: number
  enemyGauge: number
  combo: number
  maxCombo: number
  aa: number
  enemyAa: number
  lastGun?: Pos
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

export interface Card extends Stats {
  id: string
  class: ShipClass
  name: string
  title: string
  rarity: Rarity
  color: string
  intro: string
  attack: string
  home: string[]
  fx?: FxPreset
}

// Motion effects over a card's art on showcase screens (see MotionFx).
export type FxPreset = 'sun' | 'storm'

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
  /** The round's actions, player's and CPU's, in the order they resolved. */
  results: Result[]
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
  /** How far the current coins can train the ship, and what that costs. */
  maxTrainLevel: number
  maxTrainCost: number
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
  comment: string
  /** A new admiral who has yet to register a name. */
  unnamed: boolean
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
  created: string
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

export interface AuthSession {
  signedIn: boolean
  email?: string
  /** May open the admin console. */
  admin?: boolean
  /** Sign-in methods the server offers. */
  google: boolean
  dev: boolean
}

/** A present from the operators, collected from the harbour's gift box. */
export interface Gift {
  id: string
  title: string
  message: string
  gems?: number
  coins?: number
  cards?: string[]
  startsAt: string
  endsAt: string
  /** For every admiral (who joined before joinedBefore), or only listed ones. */
  everyone: boolean
  joinedBefore?: string
}

export interface ClaimedGift {
  gift: Gift
  grant: Grant
}

/** A gift as the admin console lists it. */
export interface GiftRecord extends Gift {
  createdBy: string
  createdAt: string
  revokedBy?: string
  revokedAt?: string
  recipients: number
  claims: number
}

export interface PlayerSummary {
  id: string
  name: string
  level: number
  email?: string
  gems: number
  coins: number
  created: string
}

export interface AuditEntry {
  id: number
  at: string
  actor: string
  action: string
  target: string
  detail: unknown
}

/** Another admiral as friend lists show them, named by their friend code. */
export interface FriendCard {
  code: string
  name: string
  comment: string
  level: number
  /** Card id of their secretary ship. */
  secretary: string
  fleetPower: number
  lastActive: string
}

export interface Friend extends FriendCard {
  since: string
  /** Cheered by me today, and cheering me today. */
  cheered: boolean
  cheeredMe: boolean
}

export interface FriendRequest extends FriendCard {
  at: string
}

/** The friends screen: my code, friends, requests both ways and uncollected cheers. */
export interface FriendList {
  code: string
  friends: Friend[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  cheers: number
}

/** What a friend may look at: their fleet in formation order and some records. */
export interface FriendProfile extends FriendCard {
  fleet: { card: string; level: number; stars: number; power: number }[]
  ships: number
  totalStars: number
  endless: number
  battles: number
  wins: number
  bestStreak: number
  sunk: number
  loginDays: number
  created: string
}

export type Board = 'level' | 'power' | 'wins' | 'endless'

/** An admiral on a ranking board, shown by name only. */
export interface RankEntry {
  /** 1 for the top; tied admirals share it. 0 when not on the board. */
  rank: number
  score: number
  name: string
  comment: string
  level: number
  /** Card id of their secretary ship. */
  secretary: string
  me?: boolean
  friend?: boolean
}

/** A board's top admirals, how many are on it, and where I stand. */
export interface Ranking {
  board: Board
  entries: RankEntry[]
  total: number
  me: RankEntry
}
