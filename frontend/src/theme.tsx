// Optional local asset packs, both git-ignored under public/legacy:
//  - legacy: restored by scripts/salvage-legacy-assets.sh (portraits, banners, BGM/SE)
//  - ui:     imported by scripts/import-ui-assets.sh (home port, cut-in sprites, bands)
// Everything here must degrade gracefully when either pack is absent.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
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

export type Fx = 'search' | 'found' | 'sighted' | 'observe' | 'reticle' | 'ring' | 'column' | 'burst'

export const assets = {
  portrait: (c: ShipClass) => `${BASE}/img/ship/${c}.png`,
  // b: healthy, c: damaged, d: sunk
  banner: (c: ShipClass, state: 'b' | 'c' | 'd') => `${BASE}/img/ship/${c}_${state}.png`,
  enemyBanner: (damaged: boolean) => `${BASE}/img/ship/enemy_${damaged ? 'c' : 'b'}.png`,
  battleStart: `${BASE}/img/battle_start.png`,
  sunk: `${BASE}/img/sunk.png`,
  explosion: `${BASE}/img/explosion.png`,
  fx: (name: Fx) => `${UI}/fx/${name}.png`,
  band: (name: 'green' | 'red' | 'red_diag') => `${UI}/band_${name}.png`,
  strip: `${UI}/strip_green.png`,
}

type Bgm = 'title' | 'battle'
type Se = 'click' | 'launch' | 'move' | 'explosion1' | 'explosion2' | 'explosion3'

class Sound {
  enabled = false
  muted = readMuted()
  private bgm?: HTMLAudioElement
  private bgmName?: Bgm

  playBgm(name: Bgm) {
    if (!this.enabled || this.bgmName === name) return
    this.stopBgm()
    this.bgmName = name
    this.bgm = new Audio(`${BASE}/bgm/${name}.mp3`)
    this.bgm.loop = true
    this.bgm.volume = 0.25
    this.bgm.muted = this.muted
    // Autoplay can be refused until the first user gesture; the next call retries.
    this.bgm.play().catch(() => (this.bgmName = undefined))
  }

  stopBgm() {
    this.bgm?.pause()
    this.bgm = undefined
    this.bgmName = undefined
  }

  se(name: Se, volume = 0.5) {
    this.play(`${BASE}/se/${name}.mp3`, volume)
  }

  voice() {
    this.play(`${BASE}/voice/${1 + Math.floor(Math.random() * 3)}.mp3`, 0.6)
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.bgm) this.bgm.muted = m
    try {
      localStorage.setItem('muted', m ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  private play(src: string, volume: number) {
    if (!this.enabled || this.muted) return
    const a = new Audio(src)
    a.volume = volume
    a.play().catch(() => {})
  }
}

function readMuted() {
  try {
    return localStorage.getItem('muted') === '1'
  } catch {
    return false
  }
}

export const sound = new Sound()

const PacksContext = createContext<Packs & { ready: boolean }>({ legacy: false, ui: false, ready: false })

export function AssetProvider({ children }: { children: ReactNode }) {
  const [packs, setPacks] = useState({ legacy: false, ui: false, ready: false })
  useEffect(() => {
    Promise.all([detect(`${BASE}/manifest.json`), detect(`${UI}/manifest.json`)]).then(([legacy, ui]) => {
      sound.enabled = legacy
      setPacks({ legacy, ui, ready: true })
    })
  }, [])
  return <PacksContext.Provider value={packs}>{children}</PacksContext.Provider>
}

export const useAssets = () => useContext(PacksContext)
