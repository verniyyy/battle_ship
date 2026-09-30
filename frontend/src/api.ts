import type {
  ActionResponse,
  AuthSession,
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

// Before sign-in existed, the admiral was a UUID kept in this browser. Signing
// in for the first time carries that progress over to the Google account.
function guestId(): string | undefined {
  try {
    return localStorage.getItem('playerId') ?? undefined
  } catch {
    return undefined
  }
}

let unauthorized: () => void = () => {}

/** Registers what to do when the session has run out mid-game. */
export function onUnauthorized(fn: () => void) {
  unauthorized = fn
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401) unauthorized()
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`)
  }
  return body as T
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

type WithProfile<T = object> = T & { profile: Profile }

export const auth = {
  session: () => request<AuthSession>('/auth/session'),
  /** Leaves for Google's sign-in page; the browser comes back to / afterwards. */
  google: () => {
    const g = guestId()
    location.href = `/api/auth/google/login${g ? `?guest=${encodeURIComponent(g)}` : ''}`
  },
  dev: () => post<void>('/auth/dev', { guest: guestId() }),
  logout: () => post<void>('/auth/logout'),
}

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
