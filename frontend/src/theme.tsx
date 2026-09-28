// Optional local asset packs, both git-ignored under public/legacy:
//  - legacy: restored by scripts/salvage-legacy-assets.sh (portraits, banners, BGM)
//  - ui:     imported by scripts/import-ui-assets.sh (home port, cut-in sprites, bands)
// Everything here must degrade gracefully when either pack is absent.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { audio } from './audio'
import type { ShipClass } from './types'

const BASE = '/legacy'
const UI = `${BASE}/ui`

async function detect(manifest: string): Promise<boolean> {
  try {
    const res = await fetch(manifest)
    // Dev servers answer unknown paths with index.html, so insist on real JSON.
    return res.ok && (await res.json())?.version === 1
  } catch {
    return false
  }
}

export interface Packs {
  legacy: boolean
  ui: boolean
}

export type Backdrop = 'title' | 'home' | 'standby' | 'battle' | 'result'

export function backdropUrl(scene: Backdrop, p: Packs): string | undefined {
  switch (scene) {
    case 'title':
      return p.legacy ? `${BASE}/img/title.png` : undefined
    case 'home':
      return p.ui ? `${UI}/home.jpg` : p.legacy ? `${BASE}/img/standby.jpg` : undefined
    case 'standby':
      return p.legacy ? `${BASE}/img/standby.jpg` : undefined
    case 'battle':
      return p.ui ? `${UI}/battle.jpg` : p.legacy ? `${BASE}/img/battle.jpg` : undefined
    case 'result':
      return p.legacy ? `${BASE}/img/result.jpg` : undefined
  }
}

// Classes the legacy pack has character art for.
export const PORTRAIT_CLASSES: ShipClass[] = ['battleship', 'destroyer', 'submarine']
// The starter cards are the original three characters, so they wear the legacy art.
export const PORTRAIT_CARDS: Record<string, ShipClass> = {
  bb_kurogane: 'battleship',
  dd_asanagi: 'destroyer',
  ss_senryu: 'submarine',
}

export const assets = {
  portrait: (c: ShipClass) => `${BASE}/img/ship/${c}.png`,
  sunk: `${BASE}/img/sunk.png`,
  explosion: `${BASE}/img/explosion.png`,
}

const PacksContext = createContext<Packs & { ready: boolean }>({ legacy: false, ui: false, ready: false })

export function AssetProvider({ children }: { children: ReactNode }) {
  const [packs, setPacks] = useState({ legacy: false, ui: false, ready: false })
  useEffect(() => {
    Promise.all([detect(`${BASE}/manifest.json`), detect(`${UI}/manifest.json`)]).then(([legacy, ui]) => {
      audio.legacyBgm = legacy
      setPacks({ legacy, ui, ready: true })
    })
  }, [])
  return <PacksContext.Provider value={packs}>{children}</PacksContext.Provider>
}

export const useAssets = () => useContext(PacksContext)
