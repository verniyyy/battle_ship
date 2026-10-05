// Light effects mode for phones. Every element a CSS animation moves is a
// compositor layer of its own (and drags whatever is drawn over it into
// layers too), each a texture at device resolution. The harbour, the dock
// and the card art move dozens of small parts at once, which a desktop GPU
// holds easily but a phone browser answers by killing the tab.
//
// In light mode html carries .lowfx: the styles hold the decorative loops
// still (twinkles, sparks, glints, the cards' staging) while the big moves
// (waves, clouds, the build's rings) and every effect that answers a tap stay.
// The card motion effects (MotionFx) and the particle canvas scale down too.
//
// It starts on for touch devices and can be switched in the sound panel.

const KEY = 'gfx'

export type GfxMode = 'auto' | 'full' | 'lite'

type Listener = () => void
const listeners = new Set<Listener>()

function stored(): GfxMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'full' || v === 'lite' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

let mode: GfxMode = stored()
let lite: boolean | undefined

/** Phones and tablets: a touch screen as the main pointer, or a small memory budget. */
function constrained(): boolean {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return coarse || (memory !== undefined && memory <= 4)
}

/** Whether light mode is in effect now. */
export function liteFx(): boolean {
  lite ??= mode === 'lite' || (mode === 'auto' && constrained())
  return lite
}

export function gfxMode(): GfxMode {
  return mode
}

export function setGfxMode(m: GfxMode) {
  mode = m
  lite = undefined
  try {
    if (m === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, m)
  } catch {
    // Private mode: the choice lasts for this visit.
  }
  apply()
  listeners.forEach((f) => f())
}

export function onGfxChange(f: Listener) {
  listeners.add(f)
  return () => void listeners.delete(f)
}

export function apply() {
  document.documentElement.classList.toggle('lowfx', liteFx())
}
