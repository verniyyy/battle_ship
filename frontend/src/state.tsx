// App-wide data: the sign-in session, the static catalog, the admiral's profile and toasts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, auth, onUnauthorized } from './api'
import { audio } from './audio'
import { fx } from './fx'
import type { AuthSession, Card, Catalog, Grant, Profile } from './types'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'good' | 'error' | 'gold'
}

interface GameData {
  /** null until the server has said whether this browser is signed in. */
  session: AuthSession | null
  reloadSession: () => Promise<void>
  signOut: () => Promise<void>
  catalog: Catalog | null
  profile: Profile | null
  error: string | null
  setProfile: (p: Profile) => void
  refresh: () => Promise<void>
  card: (id: string) => Card | undefined
  toasts: Toast[]
  notify: (text: string, tone?: Toast['tone']) => void
}

const Ctx = createContext<GameData | null>(null)

// DOM anchors of the wallet counters, so rewards can fly into them.
export const anchors: { coins?: HTMLElement | null; gems?: HTMLElement | null; level?: HTMLElement | null } = {}

/** Plays the "money flies into the wallet" effect for a grant, from an element or point. */
export function celebrateGrant(g: Grant | undefined, from: Element | { x: number; y: number } | null) {
  if (!g) return
  const origin = from && 'x' in from ? from : fx.center(from as Element | null)
  if (g.coins) {
    fx.coins(origin, fx.center(anchors.coins), Math.min(24, 6 + Math.floor(g.coins / 300)), '#ffd24a')
    audio.play('coin')
  }
  if (g.gems) {
    fx.coins(origin, fx.center(anchors.gems), Math.min(24, 6 + Math.floor(g.gems / 20)), '#7fe7ff')
    window.setTimeout(() => audio.play('gem'), 120)
  }
  fx.sparkle(origin.x, origin.y, '#fff6b0', 22)
}

export function GameDataProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([catalog ? Promise.resolve(catalog) : api.catalog(), api.profile()])
      setCatalog(c)
      setProfile(p.profile)
      setError(null)
    } catch (e) {
      setError(`司令部との通信に失敗: ${(e as Error).message}`)
    }
  }, [catalog])

  const reloadSession = useCallback(async () => {
    try {
      setSession(await auth.session())
    } catch (e) {
      setSession({ signedIn: false, google: false, dev: false })
      setError(`司令部との通信に失敗: ${(e as Error).message}`)
    }
  }, [])

  useEffect(() => {
    void reloadSession()
    onUnauthorized(() => {
      setSession((s) => s && { ...s, signedIn: false, email: undefined })
      setProfile(null)
    })
  }, [])

  useEffect(() => {
    if (session?.signedIn) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.signedIn])

  // The same admiral may be playing on another device too: coming back to this
  // tab picks up whatever was spent or earned there meanwhile.
  useEffect(() => {
    if (!session?.signedIn) return
    const onShow = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [session?.signedIn, refresh])

  const signOut = useCallback(async () => {
    await auth.logout()
    setProfile(null)
    setSession((s) => s && { ...s, signedIn: false, email: undefined })
  }, [])

  const notify = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-3), { id, text, tone }])
    if (tone === 'error') audio.play('error')
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])

  const cards = useMemo(() => new Map(catalog?.cards.map((c) => [c.id, c])), [catalog])
  const card = useCallback((id: string) => cards.get(id), [cards])

  return (
    <Ctx.Provider value={{ session, reloadSession, signOut, catalog, profile, error, setProfile, refresh, card, toasts, notify }}>{children}</Ctx.Provider>
  )
}

export function useGame() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useGame outside GameDataProvider')
  return v
}
