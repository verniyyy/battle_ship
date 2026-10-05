// Screen-space juice: a canvas particle system laid over the whole stage, plus
// shake, hit-stop and flash helpers. Coordinates are stage pixels (1280x720).

import { liteFx } from './gfx'

type Kind = 'spark' | 'ember' | 'smoke' | 'debris' | 'ring' | 'glow' | 'drop' | 'confetti' | 'star' | 'coin' | 'bubble' | 'ray' | 'shard'

interface Particle {
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  rot: number
  vr: number
  gravity: number
  drag: number
  grow: number
  // Homing target (coins flying to the wallet).
  tx?: number
  ty?: number
  delay: number
  additive: boolean
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

export const RAINBOW = ['#ff5a5a', '#ffb23f', '#fff35c', '#5cff8a', '#4fd5ff', '#8a7dff', '#ff7ae0']

class FxEngine {
  private canvas?: HTMLCanvasElement
  private ctx?: CanvasRenderingContext2D
  private parts: Particle[] = []
  private raf = 0
  private last = 0
  private frozenUntil = 0
  stage?: HTMLElement
  shaker?: HTMLElement
  private flashEl?: HTMLElement

  attach(canvas: HTMLCanvasElement, stage: HTMLElement, shaker: HTMLElement, flash: HTMLElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d') ?? undefined
    this.stage = stage
    this.shaker = shaker
    this.flashEl = flash
  }

  detach() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.canvas = this.ctx = undefined
    this.parts = []
  }

  /** Centre of an element in stage coordinates. */
  center(el: Element | null | undefined): { x: number; y: number } {
    if (!el || !this.stage) return { x: 640, y: 360 }
    const r = el.getBoundingClientRect()
    const s = this.stage.getBoundingClientRect()
    const k = s.width / 1280 || 1
    return { x: (r.left + r.width / 2 - s.left) / k, y: (r.top + r.height / 2 - s.top) / k }
  }

  private add(p: Partial<Particle> & { x: number; y: number }) {
    if (!this.ctx) return
    this.parts.push({
      kind: 'spark',
      vx: 0,
      vy: 0,
      life: 0,
      max: 1,
      size: 4,
      color: '#fff',
      rot: 0,
      vr: 0,
      gravity: 0,
      drag: 0.98,
      grow: 0,
      delay: 0,
      additive: true,
      ...p,
    })
    const cap = liteFx() ? 600 : 1400
    if (this.parts.length > cap) this.parts.splice(0, this.parts.length - cap)
    if (!this.raf) {
      this.canvas!.style.visibility = 'visible'
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.tick)
    }
  }

  // ---------------- emitters ----------------

  /** A fireball; smoke scales the cloud it leaves (the barrage's dozens of blasts would bury the board). */
  explosion(x: number, y: number, scale = 1, hot = '#ffb347', smoke = 1) {
    this.add({ kind: 'glow', x, y, size: 90 * scale, max: 0.45, color: '#fff3c4', grow: 1.5 })
    this.add({ kind: 'ring', x, y, size: 10, max: 0.55, color: hot, grow: 260 * scale })
    for (let i = 0; i < 46 * scale; i++) {
      const a = rand(0, Math.PI * 2)
      const v = rand(80, 520) * scale
      this.add({
        kind: 'ember',
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 60,
        size: rand(2, 6) * Math.sqrt(scale),
        max: rand(0.4, 1.1),
        color: pick(['#fff4c2', '#ffd36b', hot, '#ff6a2e', '#ff3b1f']),
        gravity: 420,
        drag: 0.93,
      })
    }
    for (let i = 0; i < 14 * scale * smoke; i++) {
      const a = rand(0, Math.PI * 2)
      const v = rand(30, 140) * scale
      this.add({
        kind: 'smoke',
        x: x + rand(-10, 10),
        y: y + rand(-10, 10),
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 40,
        size: rand(18, 34) * scale,
        max: rand(0.9, 1.6),
        color: pick(['#3a3a44', '#55505a', '#2a2630']),
        grow: 40,
        drag: 0.95,
        additive: false,
      })
    }
    for (let i = 0; i < 10 * scale; i++) {
      const a = rand(-Math.PI, 0)
      const v = rand(200, 480) * scale
      this.add({
        kind: 'debris',
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        size: rand(3, 7),
        max: rand(0.8, 1.4),
        color: pick(['#222', '#3a3a3a', '#6b5b4b']),
        gravity: 900,
        drag: 0.99,
        vr: rand(-12, 12),
        additive: false,
      })
    }
  }

  splash(x: number, y: number, scale = 1) {
    this.add({ kind: 'ring', x, y, size: 6, max: 0.7, color: '#bff4ff', grow: 120 * scale })
    this.add({ kind: 'ring', x, y, size: 4, max: 0.9, color: '#6fd8ff', grow: 80 * scale, delay: 0.12 })
    for (let i = 0; i < 38 * scale; i++) {
      const a = rand(-Math.PI * 0.85, -Math.PI * 0.15)
      const v = rand(160, 460) * scale
      this.add({
        kind: 'drop',
        x: x + rand(-8, 8),
        y,
        vx: Math.cos(a) * v * 0.6,
        vy: Math.sin(a) * v,
        size: rand(2, 5),
        max: rand(0.6, 1.1),
        color: pick(['#e9fbff', '#9fe6ff', '#58c8ff']),
        gravity: 980,
        drag: 0.99,
      })
    }
  }

  sparkle(x: number, y: number, color = '#fff6b0', n = 18, spread = 140) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2)
      const v = rand(20, spread)
      this.add({
        kind: 'star',
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        size: rand(3, 8),
        max: rand(0.5, 1.2),
        color,
        vr: rand(-6, 6),
        drag: 0.94,
      })
    }
  }

  ring(x: number, y: number, color = '#7ff', grow = 200, max = 0.6) {
    this.add({ kind: 'ring', x, y, size: 6, max, color, grow })
  }

  rays(x: number, y: number, color = '#fff2a8', n = 14, max = 1.2) {
    for (let i = 0; i < n; i++) {
      this.add({ kind: 'ray', x, y, rot: (i / n) * Math.PI * 2, vr: 0.6, size: 900, max, color, grow: 0 })
    }
  }

  bubbles(x: number, y: number, n = 6) {
    for (let i = 0; i < n; i++) {
      this.add({
        kind: 'bubble',
        x: x + rand(-10, 10),
        y: y + rand(-6, 6),
        vx: rand(-20, 20),
        vy: rand(-80, -30),
        size: rand(2, 6),
        max: rand(0.5, 1),
        color: '#cfefff',
        drag: 0.97,
        additive: false,
      })
    }
  }

  confetti(n = 160, colors = RAINBOW) {
    for (let i = 0; i < n; i++) {
      this.add({
        kind: 'confetti',
        x: rand(0, 1280),
        y: rand(-200, -10),
        vx: rand(-60, 60),
        vy: rand(80, 260),
        size: rand(6, 12),
        max: rand(2.5, 4.5),
        color: pick(colors),
        rot: rand(0, 6),
        vr: rand(-10, 10),
        gravity: 60,
        drag: 0.995,
        additive: false,
      })
    }
  }

  /** Coins (or gems) bursting from one point and homing into another. */
  coins(from: { x: number; y: number }, to: { x: number; y: number }, n = 14, color = '#ffd24a') {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2)
      const v = rand(120, 320)
      this.add({
        kind: 'coin',
        x: from.x,
        y: from.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 120,
        size: rand(6, 9),
        max: 1.6,
        color,
        tx: to.x,
        ty: to.y,
        delay: i * 0.025,
        drag: 0.9,
        additive: false,
      })
    }
  }

  /** A firework shell: a ring of falling sparks around a flash, with twinkles. */
  firework(x: number, y: number, colors = RAINBOW, n = 64) {
    const main = pick(colors)
    this.add({ kind: 'glow', x, y, size: 70, max: 0.3, color: '#fff', grow: 1 })
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.06, 0.06)
      const v = rand(250, 330)
      this.add({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        size: rand(2, 4),
        max: rand(0.9, 1.5),
        color: Math.random() < 0.75 ? main : pick(colors),
        gravity: 170,
        drag: 0.94,
      })
    }
    for (let i = 0; i < n / 3; i++) {
      const a = rand(0, Math.PI * 2)
      const v = rand(40, 200)
      this.add({ kind: 'star', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: rand(3, 7), max: rand(0.8, 1.6), color: '#fff', vr: rand(-8, 8), gravity: 60, drag: 0.95, delay: rand(0.1, 0.4) })
    }
  }

  /** The screen breaking: glass shards flung out from a point. */
  shatter(x: number, y: number, n = 70, color = '#e6f8ff') {
    for (let i = 0; i < n; i++) {
      const sx = rand(0, 1280)
      const sy = rand(0, 720)
      const a = Math.atan2(sy - y, sx - x) + rand(-0.3, 0.3)
      const v = rand(200, 700)
      this.add({
        kind: 'shard',
        x: sx,
        y: sy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 120,
        size: rand(14, 46),
        max: rand(0.8, 1.4),
        color,
        rot: rand(0, 6),
        vr: rand(-9, 9),
        gravity: 900,
        drag: 0.98,
        additive: false,
      })
    }
  }

  /** Coins raining from the top of the screen. */
  coinRain(n = 60, color = '#ffd24a') {
    for (let i = 0; i < n; i++) {
      this.add({
        kind: 'coin',
        x: rand(0, 1280),
        y: rand(-120, -10),
        vx: rand(-40, 40),
        vy: rand(120, 360),
        size: rand(6, 10),
        max: 2.6,
        color,
        gravity: 320,
        drag: 0.995,
        delay: rand(0, 1.2),
        additive: false,
      })
    }
  }

  // ---------------- screen effects ----------------

  shake(power = 10, ms = 380) {
    const el = this.shaker
    if (!el || power <= 0) return
    const frames: Keyframe[] = []
    const n = 10
    for (let i = 0; i < n; i++) {
      const k = power * (1 - i / n)
      frames.push({ transform: `translate(${rand(-k, k)}px, ${rand(-k, k)}px) rotate(${rand(-k, k) * 0.05}deg)` })
    }
    frames.push({ transform: 'none' })
    el.animate(frames, { duration: ms, easing: 'linear' })
  }

  /** Freezes animation briefly to sell a heavy impact. */
  hitstop(ms = 90): Promise<void> {
    this.frozenUntil = performance.now() + ms
    document.documentElement.classList.add('hitstop')
    return new Promise((r) =>
      setTimeout(() => {
        document.documentElement.classList.remove('hitstop')
        r()
      }, ms),
    )
  }

  flash(color = '#fff', ms = 260, opacity = 0.8) {
    // Hidden between flashes (see .fx-flash), so it isn't a full-stage layer the whole time.
    this.flashEl?.animate([{ background: color, opacity, visibility: 'visible' }, { background: color, opacity: 0, visibility: 'visible' }], { duration: ms, easing: 'ease-out' })
  }

  /** Zoom punch on the shaker (camera kick). */
  punch(scale = 1.04, ms = 260) {
    this.shaker?.animate([{ transform: `scale(${scale})` }, { transform: 'none' }], { duration: ms, easing: 'cubic-bezier(.2,.8,.3,1)' })
  }

  // ---------------- loop ----------------

  private tick = (now: number) => {
    const ctx = this.ctx
    if (!ctx || !this.canvas) {
      this.raf = 0
      return
    }
    let dt = Math.min((now - this.last) / 1000, 0.05)
    this.last = now
    if (now < this.frozenUntil) dt = 0
    ctx.clearRect(0, 0, 1280, 720)
    const alive: Particle[] = []
    for (const p of this.parts) {
      if (p.delay > 0) {
        p.delay -= dt
        alive.push(p)
        continue
      }
      p.life += dt
      if (p.life >= p.max) continue
      if (p.tx !== undefined && p.ty !== undefined && p.life > 0.35) {
        // Home in with an ease that speeds up.
        const k = Math.min(1, (p.life - 0.35) * 5)
        p.vx += (p.tx - p.x) * 18 * k * dt
        p.vy += (p.ty - p.y) * 18 * k * dt
        p.vx *= 0.9
        p.vy *= 0.9
        if (Math.hypot(p.tx - p.x, p.ty - p.y) < 14) continue
      }
      p.vy += p.gravity * dt
      const d = Math.pow(p.drag, dt * 60)
      p.vx *= d
      p.vy *= d
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
      p.size += p.grow * dt
      this.draw(ctx, p)
      alive.push(p)
    }
    this.parts = alive
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    if (alive.length) this.raf = requestAnimationFrame(this.tick)
    else {
      this.raf = 0
      // An idle canvas still costs a full-stage compositor layer; hide it until the next burst.
      this.canvas.style.visibility = 'hidden'
    }
  }

  private draw(ctx: CanvasRenderingContext2D, p: Particle) {
    const t = p.life / p.max
    const fade = 1 - t
    ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over'
    ctx.globalAlpha = Math.max(0, fade)
    ctx.fillStyle = p.color
    ctx.strokeStyle = p.color
    switch (p.kind) {
      case 'spark':
      case 'ember':
      case 'drop': {
        ctx.lineWidth = p.size
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03)
        ctx.stroke()
        break
      }
      case 'smoke':
        ctx.globalAlpha = Math.max(0, fade * 0.55)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'glow': {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size)
        g.addColorStop(0, p.color)
        g.addColorStop(1, 'rgba(255,200,120,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        p.size *= 1.02
        break
      }
      case 'ring':
        ctx.lineWidth = Math.max(1, 8 * fade)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.stroke()
        break
      case 'debris':
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx.restore()
        break
      case 'star': {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        const s = p.size * (1 - t * 0.5)
        ctx.beginPath()
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2
          ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s)
          ctx.lineTo(Math.cos(a + Math.PI / 4) * s * 0.3, Math.sin(a + Math.PI / 4) * s * 0.3)
        }
        ctx.closePath()
        ctx.fill()
        ctx.restore()
        break
      }
      case 'confetti':
        ctx.globalAlpha = Math.min(1, fade * 3)
        ctx.save()
        ctx.translate(p.x + Math.sin(p.life * 6 + p.rot) * 8, p.y)
        ctx.rotate(p.rot)
        ctx.scale(1, Math.abs(Math.cos(p.life * 8 + p.rot)))
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        ctx.restore()
        break
      case 'coin': {
        ctx.globalAlpha = 1
        const w = Math.abs(Math.cos(p.life * 10)) * p.size
        ctx.beginPath()
        ctx.ellipse(p.x, p.y, Math.max(w, 1.5), p.size, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 0.6
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
        break
      }
      case 'bubble':
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.stroke()
        break
      case 'shard': {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        // Tumbling: the shard's width flickers as it turns edge-on.
        ctx.scale(1, 0.25 + Math.abs(Math.cos(p.life * 7 + p.rot)) * 0.75)
        ctx.beginPath()
        ctx.moveTo(-p.size * 0.5, -p.size * 0.3)
        ctx.lineTo(p.size * 0.6, -p.size * 0.1)
        ctx.lineTo(-p.size * 0.1, p.size * 0.5)
        ctx.closePath()
        ctx.globalAlpha = Math.max(0, fade * 0.55)
        ctx.fill()
        ctx.globalAlpha = Math.max(0, fade)
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()
        break
      }
      case 'ray': {
        ctx.globalAlpha = Math.max(0, Math.sin(t * Math.PI) * 0.35)
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        const g = ctx.createLinearGradient(0, 0, p.size, 0)
        g.addColorStop(0, p.color)
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(p.size, -40)
        ctx.lineTo(p.size, 40)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
        break
      }
    }
  }
}

export const fx = new FxEngine()
