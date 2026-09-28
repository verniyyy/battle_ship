import type {
  ActionResponse,
  ActionType,
  Catalog,
  Chest,
  GameSummary,
  Gain,
  Grant,
  MatchResponse,
  Pos,
  Profile,
  Reward,
} from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const PLAYER_KEY = 'playerId'

// randomUUID only exists in secure contexts; plain-http LAN play needs the fallback.
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// The admiral is identified by a UUID kept in this browser.
function playerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_KEY)
    if (!id) {
      id = uuid()
      localStorage.setItem(PLAYER_KEY, id)
    }
    return id
  } catch {
    // Storage is unavailable (private mode): keep one id for this page load.
    return (fallbackId ??= uuid())
  }
}
let fallbackId: string | undefined

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Player-Id': playerId(), ...init?.headers },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`)
  }
  return body as T
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

type WithProfile<T = object> = T & { profile: Profile }

export const api = {
  catalog: () => request<Catalog>('/catalog'),
  profile: () => request<WithProfile>('/profile'),
  claimLogin: () => post<WithProfile<{ day: number; grant: Grant }>>('/profile/login'),
  setFleet: (uids: string[]) => post<WithProfile>('/profile/fleet', { uids }),
  setSecretary: (uid: string) => post<WithProfile>('/profile/secretary', { uid }),
  train: (uid: string) => post<WithProfile>(`/ships/${uid}/train`),
  pull: (count: 1 | 10) => post<WithProfile<{ gains: Gain[] }>>('/gacha', { count }),
  claimMission: (id: string) => post<WithProfile<{ grant: Grant }>>(`/missions/${id}/claim`),
  claimAchievement: (id: string) => post<WithProfile<{ grant: Grant }>>(`/achievements/${id}/claim`),

  createGame: (stageId: string, placements: Pos[]) => post<MatchResponse>('/games', { stageId, placements }),
  getGame: (id: string) => request<MatchResponse>(`/games/${id}`),
  act: (id: string, type: ActionType, shipId: number, target: Pos) =>
    post<ActionResponse>(`/games/${id}/actions`, { type, shipId, target }),
  openChest: (id: string, index: number) => post<WithProfile<{ chest: Chest; reward: Reward }>>(`/games/${id}/chest`, { index }),
  history: (limit = 20) => request<{ games: GameSummary[] }>(`/games?limit=${limit}`),
}
