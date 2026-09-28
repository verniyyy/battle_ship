import type { ActionResponse, ActionType, FleetInfo, GameResponse, GameSummary, Pos, Stats } from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`)
  }
  return body as T
}

export const api = {
  fleet: () => request<FleetInfo>('/fleet'),
  createGame: (placements: Pos[]) =>
    request<GameResponse>('/games', { method: 'POST', body: JSON.stringify({ placements }) }),
  getGame: (id: string) => request<GameResponse>(`/games/${id}`),
  act: (id: string, type: ActionType, shipId: number, target: Pos) =>
    request<ActionResponse>(`/games/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ type, shipId, target }),
    }),
  history: (limit = 10) => request<{ games: GameSummary[] }>(`/games?limit=${limit}`),
  stats: () => request<Stats>('/stats'),
}
