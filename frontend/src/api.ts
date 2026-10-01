import type {
  ActionResponse,
  AuditEntry,
  AuthSession,
  ActionType,
  Catalog,
  Chest,
  ClaimedGift,
  GameSummary,
  FriendList,
  FriendProfile,
  Gain,
  Gift,
  GiftRecord,
  Grant,
  MatchResponse,
  PlayerSummary,
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
  /** Local development only; admin signs in as the dev admin the server may list. */
  dev: (admin = false) => post<void>('/auth/dev', { guest: guestId(), admin }),
  logout: () => post<void>('/auth/logout'),
}

export const api = {
  catalog: () => request<Catalog>('/catalog'),
  version: () => request<{ version: string }>('/version'),
  profile: () => request<WithProfile>('/profile'),
  claimLogin: () => post<WithProfile<{ day: number; grant: Grant }>>('/profile/login'),
  setFleet: (uids: string[]) => post<WithProfile>('/profile/fleet', { uids }),
  rename: (name: string, comment: string) => post<WithProfile>('/profile/name', { name, comment }),
  setSecretary: (uid: string) => post<WithProfile>('/profile/secretary', { uid }),
  /** Buys one level, or with max as many as the coins allow. */
  train: (uid: string, max = false) => post<WithProfile<{ levels: number }>>(`/ships/${uid}/train${max ? '?max=1' : ''}`),
  pull: (count: 1 | 10) => post<WithProfile<{ gains: Gain[] }>>('/gacha', { count }),
  claimMission: (id: string) => post<WithProfile<{ grant: Grant }>>(`/missions/${id}/claim`),
  claimAchievement: (id: string) => post<WithProfile<{ grant: Grant }>>(`/achievements/${id}/claim`),

  createGame: (stageId: string, placements: Pos[]) => post<MatchResponse>('/games', { stageId, placements }),
  getGame: (id: string) => request<MatchResponse>(`/games/${id}`),
  /** The unfinished battle to go back to, or null when there is none. */
  currentGame: () =>
    request<MatchResponse>('/games/current').catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }),
  act: (id: string, type: ActionType, shipId: number, target: Pos) =>
    post<ActionResponse>(`/games/${id}/actions`, { type, shipId, target }),
  /** Withdraw from the suspended battle for good; it is settled as a defeat. */
  abandon: (id: string) => post<ActionResponse>(`/games/${id}/abandon`),
  /** A fresh battle on the same stage with the fleet deployed as in game id. */
  rematch: (id: string) => post<MatchResponse>(`/games/${id}/rematch`),
  openChest: (id: string, index: number) => post<WithProfile<{ chest: Chest; reward: Reward }>>(`/games/${id}/chest`, { index }),
  history: (limit = 20) => request<{ games: GameSummary[] }>(`/games?limit=${limit}`),

  gifts: () => request<{ gifts: Gift[] }>('/gifts'),
  /** Collects one gift, or every pending one without an id. */
  claimGifts: (id?: string) => post<WithProfile<{ claimed: ClaimedGift[] }>>('/gifts/claim', { id }),
}

type WithFriends<T = object> = T & { friends: FriendList }
const friendPath = (code: string) => `/friends/${encodeURIComponent(code)}`

/** Friends, named by friend code. Every change answers with the list as it now stands. */
export const friends = {
  list: () => request<WithFriends>('/friends'),
  profile: (code: string) => request<{ friend: FriendProfile }>(friendPath(code)),
  /** befriended is true when they had already asked in return. */
  request: (code: string) => post<WithFriends<{ befriended: boolean }>>('/friends/requests', { code }),
  accept: (code: string) => post<WithFriends>(`/friends/requests/${encodeURIComponent(code)}/accept`),
  decline: (code: string) => post<WithFriends>(`/friends/requests/${encodeURIComponent(code)}/decline`),
  cancel: (code: string) => post<WithFriends>(`/friends/requests/${encodeURIComponent(code)}/cancel`),
  remove: (code: string) => post<WithFriends>(`${friendPath(code)}/remove`),
  /** Today's cheer to one friend, or to every friend not yet cheered. */
  cheer: (code?: string) => post<WithFriends<{ sent: number }>>(code ? `${friendPath(code)}/cheer` : '/friends/cheer'),
  claimCheers: () => post<WithFriends<WithProfile<{ count: number; grant: Grant }>>>('/friends/cheers/claim'),
}

/** A friend code as shown: two groups of four, e.g. K7QM-4XPA. */
export const showCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code)

/** A gift as drafted in the admin console. */
export type GiftDraft = Omit<Gift, 'id'>

/** The operators' console; the server lets only admins in. */
export const admin = {
  gifts: () => request<{ gifts: GiftRecord[] }>('/admin/gifts'),
  createGift: (gift: GiftDraft, recipients: string[]) => post<{ id: string }>('/admin/gifts', { gift, recipients }),
  revokeGift: (id: string) => post<void>(`/admin/gifts/${id}/revoke`),
  players: (q: string) => request<{ players: PlayerSummary[] }>(`/admin/players?q=${encodeURIComponent(q)}`),
  audit: () => request<{ entries: AuditEntry[] }>('/admin/audit'),
}
