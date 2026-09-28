export type Side = 'player' | 'cpu'
export type ShipClass = 'battleship' | 'destroyer' | 'submarine'
export type ActionType = 'attack' | 'move'
export type Direction = 'north' | 'south' | 'east' | 'west'

export interface Pos {
  row: number
  col: number
}

export interface ShipSpec {
  class: ShipClass
  name: string
  hp: number
  ammo: number
}

export interface FleetInfo {
  boardSize: number
  ships: ShipSpec[]
}

export interface ShipView {
  id: number
  class: ShipClass
  name: string
  hp: number
  maxHp: number
  ammo: number
  maxAmmo: number
  pos?: Pos
  attackTargets?: Pos[]
  moveTargets?: Pos[]
}

export interface Result {
  side: Side
  type: ActionType
  shipId: number
  target?: Pos
  hitShipId?: number
  sunk?: boolean
  splash?: boolean
  direction?: Direction
  distance?: number
}

export interface GameView {
  boardSize: number
  turn: number
  status: 'in_progress' | 'finished'
  winner?: Side
  playerShips: ShipView[]
  enemyShips: ShipView[]
  history: Result[]
}

export interface GameResponse {
  id: string
  game: GameView
}

export interface ActionResponse {
  player: Result
  cpu?: Result
  game: GameView
}

export interface GameSummary {
  id: string
  turn: number
  winner: Side
  finishedAt: string
}

export interface Stats {
  played: number
  wins: number
  losses: number
}

export const samePos = (a?: Pos | null, b?: Pos | null) => !!a && !!b && a.row === b.row && a.col === b.col

export const posLabel = (p: Pos) => `${'ABCDE'[p.col]}${p.row + 1}`
