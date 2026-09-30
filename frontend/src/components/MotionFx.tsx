// Motion effects played over a card's art on showcase screens, per card
// preset (Card.fx). The portrait is never redrawn: effects run on two
// canvases, one behind the figure and one in front of it, and light that
// falls on the character is a layer masked by the portrait's own alpha,
// so it lands exactly on her and nowhere else.
//
//   sun   - golden motes rising around her, a pulsing sun glow behind,
//           glints twinkling at her edges and a sheen passing over her
//   storm - slanting rain in two depths, lightning striking behind her
//           that flashes the scene and lights her from the bolt's side
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import type { FxPreset } from '../types'
import type { Frame } from './ShipArt'
import type { Portrait } from '../theme'

export interface FxRefs {
  back: RefObject<HTMLCanvasElement | null>
  front: RefObject<HTMLCanvasElement | null>
  light: RefObject<HTMLDivElement | null>
  flash: RefObject<HTMLDivElement | null>
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Starts the preset's engine on the layers once they are mounted, pausing
// while the art is off screen or the tab is hidden.
export function useMotionFx(preset: FxPreset | undefined): FxRefs & { on: boolean } {
  const refs: FxRefs = {
    back: useRef<HTMLCanvasElement>(null),
    front: useRef<HTMLCanvasElement>(null),
    light: useRef<HTMLDivElement>(null),
    flash: useRef<HTMLDivElement>(null),
  }
  const on = !!preset && !reducedMotion()
  useEffect(() => {
    const back = refs.back.current
    const front = refs.front.current
    if (!on || !preset || !back || !front) return
    const scene = preset === 'storm' ? new Storm() : new Sun()
    const engine = new Engine(scene, back, front, refs.light.current, refs.flash.current)
    return () => engine.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, on])
  return { ...refs, on }
}

// The layers, split around the portrait: FxBack goes before it in the DOM,
// FxFront after it.
export function FxBack({ fx }: { fx: FxRefs }) {
  return <canvas ref={fx.back} className="fx-canvas fx-back" aria-hidden />
}

export function FxFront({ fx, preset, portrait, frame }: { fx: FxRefs; preset: FxPreset; portrait?: Portrait; frame: Frame }) {
  return (
    <>
      {portrait && <PortraitLight ref={fx.light} portrait={portrait} frame={frame} className={`fx-light fx-${preset}`} />}
      <canvas ref={fx.front} className="fx-canvas fx-front" aria-hidden />
      <div ref={fx.flash} className={`fx-flash fx-${preset}`} aria-hidden />
    </>
  )
}

// A box laid exactly over the portrait image and masked by it.
function PortraitLight({ ref, portrait, frame, className }: { ref: RefObject<HTMLDivElement | null>; portrait: Portrait; frame: Frame; className: string }) {
  const bust = frame === 'bust' && !!portrait.face
  const mask = `url("${portrait.src}")`
  const style: CSSProperties = {
    maskImage: mask,
    WebkitMaskImage: mask,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskSize: bust ? '100% 100%' : 'contain',
    WebkitMaskSize: bust ? '100% 100%' : 'contain',
    maskPosition: '50% 100%',
    WebkitMaskPosition: '50% 100%',
  }
  if (bust && portrait.face) {
    const [x0, y0, x1, y1] = portrait.face
    Object.assign(style, {
      ['--ar' as string]: portrait.w / portrait.h,
      ['--fh' as string]: y1 - y0,
      ['--fx' as string]: (x0 + x1) / 2,
      ['--fy' as string]: y0,
    })
  }
  return <div ref={ref} className={`portrait-img ${bust ? 'bust' : 'full'} ${className}`} style={style} aria-hidden />
}

// ---- engine ----

interface View {
  w: number // CSS px
  h: number
  dpr: number
}

interface Scene {
  // Draw one frame; t in seconds since start, dt since the last frame.
  frame(back: CanvasRenderingContext2D, front: CanvasRenderingContext2D, v: View, t: number, dt: number): void
  // Light on the character and over the whole art, 0..1, for this frame.
  light?(t: number): { on: number; flash: number; angle?: number }
  resize?(v: View): void
}

const MAX_DPR = 1.5

class Engine {
  private raf = 0
  private last = 0
  private t = 0
  private visible = true
  private view: View = { w: 0, h: 0, dpr: 1 }
  private ro: ResizeObserver
  private io: IntersectionObserver
  private bc: CanvasRenderingContext2D
  private fc: CanvasRenderingContext2D
  private scene: Scene
  private back: HTMLCanvasElement
  private front: HTMLCanvasElement
  private light: HTMLElement | null
  private flash: HTMLElement | null

  constructor(scene: Scene, back: HTMLCanvasElement, front: HTMLCanvasElement, light: HTMLElement | null, flash: HTMLElement | null) {
    this.scene = scene
    this.back = back
    this.front = front
    this.light = light
    this.flash = flash
    this.bc = back.getContext('2d')!
    this.fc = front.getContext('2d')!
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(back)
    this.io = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting
      this.schedule()
    })
    this.io.observe(back)
    document.addEventListener('visibilitychange', this.schedule)
    this.resize()
    this.schedule()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro.disconnect()
    this.io.disconnect()
    document.removeEventListener('visibilitychange', this.schedule)
  }

  private resize() {
    const r = this.back.getBoundingClientRect()
    const dpr = Math.min(devicePixelRatio || 1, MAX_DPR)
    this.view = { w: r.width, h: r.height, dpr }
    for (const c of [this.back, this.front]) {
      c.width = Math.max(1, Math.round(r.width * dpr))
      c.height = Math.max(1, Math.round(r.height * dpr))
    }
    this.scene.resize?.(this.view)
  }

  private schedule = () => {
    const run = this.visible && !document.hidden
    if (run && !this.raf) {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.tick)
    } else if (!run && this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
  }

  private tick = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.t += dt
    const { w, h, dpr } = this.view
    if (w > 0 && h > 0) {
      for (const c of [this.bc, this.fc]) {
        c.setTransform(dpr, 0, 0, dpr, 0, 0)
        c.clearRect(0, 0, w, h)
      }
      this.scene.frame(this.bc, this.fc, this.view, this.t, dt)
      const l = this.scene.light?.(this.t)
      if (l) {
        if (this.light) {
          this.light.style.opacity = l.on.toFixed(3)
          if (l.angle !== undefined) this.light.style.setProperty('--fx-angle', `${l.angle}deg`)
        }
        if (this.flash) this.flash.style.opacity = l.flash.toFixed(3)
      }
    }
    this.raf = requestAnimationFrame(this.tick)
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

// A soft round glow, pre-rendered once per colour and drawn scaled.
function glowSprite(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, color)
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}

// ---- sun ----

interface Mote {
  x: number
  y: number
  r: number
  vy: number
  sway: number
  phase: number
  front: boolean
}

interface Glint {
  x: number
  y: number
  size: number
  born: number
  life: number
}

class Sun implements Scene {
  private motes: Mote[] = []
  private glints: Glint[] = []
  private nextGlint = 0.5
  private gold = glowSprite('rgba(255,207,74,0.85)')
  private pale = glowSprite('rgba(255,222,140,0.7)')

  resize(v: View) {
    const n = Math.round((v.w * v.h) / 4000)
    this.motes = Array.from({ length: n }, (_, i) => this.mote(v, Math.random() * v.h, i % 4 === 0))
  }

  private mote(v: View, y: number, front: boolean): Mote {
    const unit = Math.min(v.w, v.h) / 100
    return {
      x: rand(0, v.w),
      y,
      r: front ? rand(1.4, 2.6) * unit : rand(0.5, 1.3) * unit,
      vy: front ? rand(10, 18) * unit : rand(4, 9) * unit,
      sway: rand(0.6, 2) * unit,
      phase: rand(0, Math.PI * 2),
      front,
    }
  }

  frame(back: CanvasRenderingContext2D, front: CanvasRenderingContext2D, v: View, t: number, dt: number) {
    // The sun behind her, breathing slowly.
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.3)
    const sx = v.w * 0.5
    const sy = v.h * 0.3
    const sr = Math.max(v.w, v.h) * (0.55 + 0.05 * pulse)
    const sun = back.createRadialGradient(sx, sy, 0, sx, sy, sr)
    sun.addColorStop(0, `rgba(255,214,120,${0.2 + 0.08 * pulse})`)
    sun.addColorStop(0.35, `rgba(255,180,60,${0.09 + 0.04 * pulse})`)
    sun.addColorStop(1, 'rgba(255,160,40,0)')
    back.globalCompositeOperation = 'lighter'
    back.fillStyle = sun
    back.fillRect(0, 0, v.w, v.h)

    front.globalCompositeOperation = 'lighter'
    for (const m of this.motes) {
      m.y -= m.vy * dt
      if (m.y < -m.r * 4) Object.assign(m, this.mote(v, v.h + m.r * 4, m.front))
      const x = m.x + Math.sin(t * 0.9 + m.phase) * m.sway * 4
      const tw = 0.55 + 0.45 * Math.sin(t * 3 + m.phase * 3)
      // Motes fade in from the bottom and out near the top.
      const life = Math.min(1, (v.h - m.y) / (v.h * 0.25), m.y / (v.h * 0.2))
      const ctx = m.front ? front : back
      ctx.globalAlpha = Math.max(0, tw * life * (m.front ? 0.45 : 0.7))
      const s = m.r * (m.front ? 5 : 4)
      ctx.drawImage(m.front ? this.pale : this.gold, x - s / 2, m.y - s / 2, s, s)
    }
    front.globalAlpha = back.globalAlpha = 1

    // Glints: four-point stars flaring now and then around her.
    if (t > this.nextGlint) {
      this.nextGlint = t + rand(0.35, 1.1)
      const side = Math.random() < 0.5 ? rand(0.12, 0.34) : rand(0.66, 0.88)
      this.glints.push({ x: side * v.w, y: rand(0.15, 0.85) * v.h, size: rand(3, 6) * (Math.min(v.w, v.h) / 100), born: t, life: rand(0.9, 1.5) })
    }
    this.glints = this.glints.filter((g) => t - g.born < g.life)
    for (const g of this.glints) {
      const k = Math.sin(((t - g.born) / g.life) * Math.PI)
      star(front, g.x, g.y, g.size * (0.4 + 0.6 * k), k)
    }
    front.globalCompositeOperation = back.globalCompositeOperation = 'source-over'
  }

  light(t: number) {
    // A warm light on her that swells with the sun; the sheen is CSS.
    return { on: 0.6 + 0.2 * Math.sin(t * 1.3), flash: 0 }
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, a: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.globalAlpha = a
  ctx.fillStyle = '#fff6d8'
  ctx.shadowColor = '#ffcf4a'
  ctx.shadowBlur = s * 1.5
  ctx.beginPath()
  const w = s * 0.18
  ctx.moveTo(0, -s)
  ctx.quadraticCurveTo(w, -w, s, 0)
  ctx.quadraticCurveTo(w, w, 0, s)
  ctx.quadraticCurveTo(-w, w, -s, 0)
  ctx.quadraticCurveTo(-w, -w, 0, -s)
  ctx.fill()
  ctx.restore()
}

// ---- storm ----

interface Drop {
  x: number
  y: number
  len: number
  v: number
  front: boolean
}

interface Bolt {
  paths: [number, number][][]
  born: number
  side: number // -1 left of her, 1 right
}

// Strike brightness over a bolt's life: a flash, a dip, a re-strike, then a fade.
export function strikeLevel(age: number): number {
  if (age < 0) return 0
  if (age < 0.05) return 1
  if (age < 0.11) return 0.25
  if (age < 0.19) return 0.9
  return Math.max(0, 0.9 * (1 - (age - 0.19) / 0.45))
}

// A jagged path from a to b by midpoint displacement.
export function jagged(a: [number, number], b: [number, number], spread: number, depth: number): [number, number][] {
  if (depth === 0) return [a, b]
  const mid: [number, number] = [(a[0] + b[0]) / 2 + rand(-spread, spread), (a[1] + b[1]) / 2 + rand(-spread, spread) * 0.3]
  return [...jagged(a, mid, spread / 2, depth - 1), ...jagged(mid, b, spread / 2, depth - 1).slice(1)]
}

// Horizontal drift of the rain per unit fall. Negative: it slants down to
// the left, the same way as the rain painted in the staged illustration.
const WIND = -0.22

class Storm implements Scene {
  private drops: Drop[] = []
  private bolt: Bolt | null = null
  private nextStrike = rand(0.8, 2)

  resize(v: View) {
    const n = Math.round((v.w * v.h) / 900)
    this.drops = Array.from({ length: n }, (_, i) => this.drop(v, rand(-v.h, v.h), i % 5 === 0))
  }

  private drop(v: View, y: number, front: boolean): Drop {
    const unit = v.h / 100
    // Spawn upwind far enough that the drift still covers the whole width.
    const drift = v.h * WIND
    return { x: rand(Math.min(0, -drift), v.w + Math.max(0, -drift)), y, len: front ? rand(7, 12) * unit : rand(3, 6) * unit, v: front ? rand(150, 190) * unit : rand(90, 120) * unit, front }
  }

  private strike(v: View, t: number) {
    const side = Math.random() < 0.5 ? -1 : 1
    const x = v.w * (0.5 + side * rand(0.18, 0.42))
    const end: [number, number] = [x + rand(-0.15, 0.15) * v.w, v.h * rand(0.55, 0.85)]
    const main = jagged([x + rand(-0.1, 0.1) * v.w, -4], end, v.w * 0.22, 6)
    const paths = [main]
    for (let i = 0; i < 2; i++) {
      const from = main[Math.floor(rand(0.25, 0.6) * main.length)]
      paths.push(jagged(from, [from[0] + side * rand(0.08, 0.2) * v.w, from[1] + rand(0.12, 0.25) * v.h], v.w * 0.08, 4))
    }
    this.bolt = { paths, born: t, side }
  }

  frame(back: CanvasRenderingContext2D, front: CanvasRenderingContext2D, v: View, t: number, dt: number) {
    if (t > this.nextStrike) {
      this.strike(v, t)
      this.nextStrike = t + rand(2.2, 5.5)
    }
    const level = this.bolt ? strikeLevel(t - this.bolt.born) : 0

    if (this.bolt && level > 0) {
      back.save()
      back.lineCap = back.lineJoin = 'round'
      for (const [i, p] of this.bolt.paths.entries()) {
        const width = i === 0 ? 1 : 0.5
        back.globalAlpha = level
        back.strokeStyle = 'rgba(179,136,255,0.55)'
        back.shadowColor = '#b388ff'
        back.shadowBlur = 18
        back.lineWidth = 7 * width
        trace(back, p)
        back.strokeStyle = '#f4efff'
        back.shadowBlur = 6
        back.lineWidth = 2 * width
        trace(back, p)
      }
      back.restore()
    } else if (this.bolt && t - this.bolt.born > 1) {
      this.bolt = null
    }

    for (const ctx of [back, front]) {
      ctx.lineCap = 'round'
      ctx.strokeStyle = ctx === front ? 'rgba(226,220,255,0.42)' : 'rgba(196,184,255,0.3)'
      ctx.lineWidth = ctx === front ? 1.6 : 1
      ctx.beginPath()
      for (const d of this.drops) {
        if (d.front !== (ctx === front)) continue
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x - d.len * WIND, d.y - d.len)
      }
      ctx.stroke()
    }
    for (const d of this.drops) {
      d.y += d.v * dt
      d.x += d.v * dt * WIND
      if (d.y - d.len > v.h) Object.assign(d, this.drop(v, rand(-v.h * 0.2, 0), d.front))
    }
  }

  light(t: number) {
    const level = this.bolt ? strikeLevel(t - this.bolt.born) : 0
    // Light comes from the bolt's side of her.
    return { on: level * 0.85, flash: level * 0.28, angle: this.bolt && this.bolt.side < 0 ? 100 : 260 }
  }
}

function trace(ctx: CanvasRenderingContext2D, p: [number, number][]) {
  ctx.beginPath()
  ctx.moveTo(p[0][0], p[0][1])
  for (const [x, y] of p.slice(1)) ctx.lineTo(x, y)
  ctx.stroke()
}
