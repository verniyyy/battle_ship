// Modelled explosions: gunfire and detonations computed sample by sample from how a
// real blast sounds on a microphone at sea, instead of patched from oscillators and
// filtered noise (which always ends up sounding like a drum or a synth). The parts and
// their proportions were matched against field recordings of guns and explosions.
//
//   blast wave   Friedlander pulse: an instant jump in pressure, a decay through zero and a
//                longer suction phase. Its length scales with the charge, so a battleship
//                pushes a long, deep thud and a destroyer a short, hard crack.
//   roar         the fireball's turbulence: noise that starts bright and darkens as it
//                cools, its level puffing irregularly, with the gas jet's crackle on top.
//   body         the pressure felt in the chest: a dark, unpitched swell under it all.
//   sea surface  the water reflects the blast a few milliseconds late, the hollow
//                outdoor colour of every recording made over water or flat ground.
//   echoes       the blast comes back off far ships and swells: each echo later, quieter
//                and darker (air soaks up the highs over distance), smeared, never a copy.
//   rolling      the reverberant tail: a continuous roar whose top end sinks over a second
//                or two and whose level surges as clusters of reflections arrive.
//   microphone   a real recording overloads on the peak; the saturation flattens the
//                attack and is what makes an explosion sound crunchy and enormous.
//
// Distance takes the highs off the direct sound and softens its front, so the enemy's
// guns are a dull thump across the water with the tail carrying more of the sound.
// Detonations add what flies out of them: shrapnel and fittings clattering down (struck
// steel rings at a few inharmonic modes), the struck hull booming, and on a magazine
// hit, follow-up detonations and the hull creaking as it gives.

export type BlastKind = 'gun' | 'hit' | 'magazine' | 'barrage'

export interface BlastOpts {
  kind: BlastKind
  /** Gun calibre, 0 light .. 2 heavy; interpolated between. */
  size?: number
  /** Heard from across the water rather than up close. */
  far?: boolean
}

interface Spec {
  /** Positive-phase length of the blast wave, seconds. */
  pulse: number
  /** Decay of the fireball's roar, how bright it starts and the floor it darkens to. */
  roar: number
  bright: number
  floor: number
  /** Decay and cut-off of the low body. */
  body: number
  bodyF: number
  /** Seconds for the tail to die away (60 dB), and how many discrete echoes come back. */
  tail: number
  echoes: number
  /** Gas-jet crackle per second at the start. */
  crackle: number
  /** Mix of the parts, relative to the blast wave. */
  mix: { roar: number; body: number; echo: number; roll: number }
  /** Microphone overload: 0 clean, higher is crunchier. */
  drive: number
  /** Pieces clattering down after a detonation, and how long they keep coming. */
  debris?: { count: number; span: number }
  /** Struck hull ringing at our own position. */
  hull?: boolean
  /** Follow-up detonations: [delay s, scale of the charge, pan]. */
  chain?: [number, number, number][]
  /** Hull creaking as it gives (magazine hits). */
  creak?: boolean
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const at3 = (xs: readonly [number, number, number], s: number) => (s <= 1 ? lerp(xs[0], xs[1], s) : lerp(xs[1], xs[2], s - 1))
const noise = () => Math.random() * 2 - 1
/** Per-sample factor of an exponential decay with time constant `tau` seconds. */
const decayOf = (tau: number, rate: number) => Math.exp(-1 / (tau * rate))
/** Filter coefficients are recomputed this often (samples): moving cut-offs don't need more. */
const BLOCK = 16

function specOf(o: BlastOpts): Spec {
  const s = Math.min(2, Math.max(0, o.size ?? 1))
  switch (o.kind) {
    case 'gun':
      return {
        pulse: at3([0.0032, 0.0052, 0.0085], s),
        roar: at3([0.05, 0.075, 0.11], s),
        bright: at3([6000, 5000, 4200], s),
        floor: at3([900, 750, 600], s),
        body: at3([0.1, 0.16, 0.26], s),
        bodyF: at3([240, 190, 150], s),
        tail: at3([2, 2.6, 3.3], s),
        echoes: Math.round(at3([4, 5, 7], s)),
        crackle: at3([220, 170, 130], s),
        mix: { roar: 0.8, body: at3([0.7, 0.9, 1.1], s), echo: 0.3, roll: at3([0.42, 0.5, 0.58], s) },
        drive: at3([2.4, 2.6, 3], s),
      }
    case 'hit':
      return {
        pulse: 0.0065,
        roar: 0.3,
        bright: 4500,
        floor: 900,
        body: 0.24,
        bodyF: 200,
        tail: 2.8,
        echoes: 5,
        crackle: 240,
        mix: { roar: 1.3, body: 1, echo: 0.3, roll: 0.58 },
        drive: 2.8,
        debris: { count: 12, span: 1.1 },
        hull: !o.far,
      }
    case 'magazine':
      return {
        pulse: 0.012,
        roar: 0.32,
        bright: 5200,
        floor: 650,
        body: 0.45,
        bodyF: 150,
        tail: 3.8,
        echoes: 7,
        crackle: 450,
        mix: { roar: 1.15, body: 1.1, echo: 0.3, roll: 0.62 },
        drive: 3.2,
        debris: { count: 22, span: 2 },
        hull: !o.far,
        chain: [[0.24, 0.6, -0.45], [0.52, 0.45, 0.5], [0.9, 0.3, -0.15]],
        creak: true,
      }
    case 'barrage':
      return {
        pulse: 0.014,
        roar: 0.4,
        bright: 5500,
        floor: 650,
        body: 0.55,
        bodyF: 140,
        tail: 3.8,
        echoes: 7,
        crackle: 550,
        mix: { roar: 1.2, body: 1.15, echo: 0.3, roll: 0.66 },
        drive: 3.4,
        debris: { count: 26, span: 2.2 },
        chain: [0, 1, 2, 3, 4, 5, 6].map((i) => [0.12 + i * 0.12 + Math.random() * 0.03, 0.75 - i * 0.07, (i % 2 ? 1 : -1) * (0.25 + i * 0.1)]),
      }
  }
}

/** Topology-preserving state-variable filter: stays stable while its cut-off moves. */
class Svf {
  private s1 = 0
  private s2 = 0
  bp = 0
  hp = 0
  private g = 0
  private k = 1
  private a1 = 1
  /** f in Hz; q is the resonance (0.707 flat). */
  set(f: number, q: number, rate: number) {
    this.g = Math.tan((Math.PI * Math.min(f, rate * 0.45)) / rate)
    this.k = 1 / q
    this.a1 = 1 / (1 + this.g * (this.g + this.k))
    return this
  }
  /** Returns the low-pass; band- and high-pass are left in `bp` and `hp`. */
  tick(x: number) {
    const v3 = x - this.s2
    const v1 = this.a1 * (this.s1 + this.g * v3)
    const v2 = this.s2 + this.g * v1
    this.s1 = 2 * v1 - this.s1
    this.s2 = 2 * v2 - this.s2
    this.bp = v1
    this.hp = x - this.k * v1 - v2
    return v2
  }
}

const peakOf = (xs: Float32Array) => {
  let p = 1e-9
  for (let i = 0; i < xs.length; i++) p = Math.max(p, Math.abs(xs[i]))
  return p
}

/** Equal-power gains for a pan position, at unity in the centre. */
const panGains = (pan: number): [number, number] => {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]
}

/** Mixes `src` into the pair from `at` seconds, with gain and pan. */
function mixIn(L: Float32Array, R: Float32Array, src: Float32Array, at: number, gain: number, pan: number, rate: number) {
  const [gl, gr] = panGains(pan)
  const off = Math.floor(at * rate)
  const n = Math.min(src.length, L.length - off)
  for (let i = 0; i < n; i++) {
    L[off + i] += src[i] * gain * gl
    R[off + i] += src[i] * gain * gr
  }
}

/** How long a take of this explosion runs, in seconds. */
export const blastLength = (o: BlastOpts) => specOf(o).tail + 0.3

/**
 * Renders one explosion as a stereo pair at `rate`, at a fixed loudness. Every call is a fresh
 * take: the noise, the echoes and the debris are random, so no two shots are identical.
 */
export function blast(o: BlastOpts, rate: number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const spec = specOf(o)
  // A gun heard from the enemy line is kilometres off. A hit far off is still the one the
  // player is watching land, so it keeps most of its bite.
  const far = o.far ? (o.kind === 'gun' ? 1 : 0.35) : 0
  const len = Math.ceil(blastLength(o) * rate)
  const L = new Float32Array(len)
  const R = new Float32Array(len)

  const direct = charge(spec, far, rate)
  echoes(L, R, direct, spec.echoes, spec, far, rate, 1)
  mixIn(L, R, direct, 0, 1, 0, rate)
  for (const [delay, scale, pan] of spec.chain ?? []) {
    const sub = charge({ ...spec, pulse: spec.pulse * (0.5 + scale * 0.4), roar: spec.roar * (0.4 + scale * 0.4), body: spec.body * 0.5 }, far, rate)
    echoes(L, R, sub, 2, spec, far, rate, scale * 0.6, delay)
    mixIn(L, R, sub, delay, scale, pan, rate)
  }
  roll(L, R, spec, far, rate)
  if (spec.debris) debris(L, R, spec.debris, far, rate)
  if (spec.hull) hull(L, R, rate, spec.chain ? 1 : 0.6)
  if (spec.creak) creak(L, R, rate)

  // The microphone: overloads on the peak, then its own low cut takes out the
  // sub-sonic push that a speaker can't play and would only eat headroom.
  const peak = Math.max(peakOf(L), peakOf(R))
  const drive = spec.drive * (1 - far * 0.4)
  const norm = Math.tanh(drive)
  const fade = Math.floor(rate * 0.05)
  for (const ch of [L, R]) {
    const hp = new Svf().set(30, 0.707, rate)
    for (let i = 0; i < len; i++) {
      hp.tick(Math.tanh((ch[i] / peak) * drive) / norm)
      ch[i] = hp.hp
    }
    // A short fade so the take never ends on a click.
    for (let i = len - fade; i < len; i++) ch[i] *= (len - i) / fade
  }
  // Level by loudness over the first moments rather than by peak, so every take of a
  // sound lands as loud as the last whatever the dice did; the peak still stays in range.
  let sum = 0
  const head = Math.min(len, Math.floor(rate * 0.4))
  for (let i = 0; i < head; i++) sum += L[i] * L[i] + R[i] * R[i]
  const gain = Math.min(0.22 / Math.sqrt(sum / (2 * head)), 1 / Math.max(peakOf(L), peakOf(R)))
  for (const ch of [L, R]) for (let i = 0; i < len; i++) ch[i] *= gain
  return [L, R]
}

/** The sound arriving straight from the blast: wave, roar, body and the sea's reflection. Mono. */
function charge(spec: Spec, far: number, rate: number) {
  const T = spec.pulse * (0.92 + Math.random() * 0.16)
  const n = Math.ceil(Math.max(spec.roar * 7, spec.body * 7, 0.3) * rate)

  // Blast wave: Friedlander's (1 - t/T) e^(-bt/T), the shape every free-air blast follows.
  const out = new Float32Array(n)
  for (let i = 0; i < n && i < T * 12 * rate; i++) {
    const t = i / rate
    out[i] = (1 - t / T) * Math.exp((-1.8 * t) / T)
  }

  // Roar: turbulence, bright at first and darkening as the fireball cools, its level
  // puffing irregularly, with the gas jet's crackle riding on top.
  const roar = new Float32Array(n)
  const tone = new Svf()
  const puff = new Svf().set(24, 1.1, rate)
  const crack = new Svf().set(2400, 1.1, rate)
  const top = spec.bright * (1 - far * 0.6)
  const kAtt = decayOf(0.0008, rate)
  const kDec = decayOf(spec.roar, rate)
  const kTone = decayOf(spec.roar * 0.5, rate)
  const kCrack = decayOf(spec.roar * 1.4, rate)
  let att = 1
  let dec = 1
  let sweep = 1
  let pops = spec.crackle / rate
  let quiet = 0
  for (let i = 0; i < n; i++) {
    if (i % BLOCK === 0) tone.set(spec.floor + (top - spec.floor) * sweep, 0.8, rate)
    att *= kAtt
    dec *= kDec
    sweep *= kTone
    pops *= kCrack
    const m = Math.max(0, 1 + puff.tick(noise()) * 8)
    let x = tone.tick(noise() * (1 - att) * dec * m)
    // Crackle: sparse sharp pops, thinning out as the jet dies down.
    let pop = 0
    if (--quiet < 0 && Math.random() < pops) {
      pop = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6)
      quiet = rate * 0.002
    }
    crack.tick(pop)
    x += crack.bp * 0.8 * (1 - far * 0.8)
    roar[i] = x
  }

  // Body: the low swell felt more than heard.
  const body = new Float32Array(n)
  const b1 = new Svf().set(spec.bodyF, 0.9, rate)
  const b2 = new Svf().set(spec.bodyF, 0.9, rate)
  const kBodyAtt = decayOf(0.006, rate)
  const kBody = decayOf(spec.body, rate)
  att = 1
  dec = 1
  for (let i = 0; i < n; i++) {
    att *= kBodyAtt
    dec *= kBody
    body[i] = b2.tick(b1.tick(noise() * (1 - att) * dec))
  }

  const r = spec.mix.roar / peakOf(roar)
  const b = spec.mix.body / peakOf(body)
  for (let i = 0; i < n; i++) out[i] += roar[i] * r + body[i] * b

  // Distance: the air takes the highs and blunts the front of the wave.
  if (far) {
    const f = 1400 * Math.pow(10, 1 - far)
    const a = new Svf().set(f, 0.75, rate)
    const c = new Svf().set(f, 0.6, rate)
    for (let i = 0; i < n; i++) out[i] = c.tick(a.tick(out[i])) * (1 + far * 0.3)
  }

  // The sea surface: the same blast again a few milliseconds behind, a little duller.
  const gap = Math.floor(rate * (0.0016 + Math.random() * 0.0025))
  const sea = new Svf().set(4500, 0.7, rate)
  const refl = new Float32Array(n)
  for (let i = gap; i < n; i++) refl[i] = sea.tick(out[i - gap]) * 0.6
  for (let i = 0; i < n; i++) out[i] += refl[i]
  return out
}

/**
 * The blast coming back off far ships and swells: later, quieter, darker, and smeared
 * into a short swell by the many facets that reflect it (a wave face is not a mirror).
 */
function echoes(L: Float32Array, R: Float32Array, src: Float32Array, count: number, spec: Spec, far: number, rate: number, gain: number, from = 0) {
  // Only the loud head of the source is worth echoing; tapered so it doesn't cut off.
  const n = Math.min(src.length, Math.floor(rate * 0.5))
  const taper = Math.floor(rate * 0.15)
  for (let e = 0; e < count; e++) {
    const delay = 0.1 + spec.tail * 0.35 * Math.pow((e + Math.random()) / count, 1.3)
    const g = gain * spec.mix.echo * Math.exp((-delay * 6.9) / spec.tail) * (0.5 + Math.random() * 0.5)
    const cut = 160 + 1700 * Math.exp(-delay / 0.35) * (1 - far * 0.6)
    const lp1 = new Svf().set(cut, 0.7, rate)
    const lp2 = new Svf().set(cut, 0.7, rate)
    const dark = new Float32Array(n)
    for (let i = 0; i < n; i++) dark[i] = lp2.tick(lp1.tick(src[i])) * (i > n - taper ? (n - i) / taper : 1)
    const pan = Math.random() * 1.6 - 0.8
    const taps = 8
    for (let k = 0; k < taps; k++) mixIn(L, R, dark, from + delay + Math.random() * 0.07, (g / Math.sqrt(taps)) * (Math.random() < 0.5 ? -1 : 1), pan + (Math.random() - 0.5) * 0.4, rate)
  }
}

/**
 * The reverberant tail: a continuous roar whose top end sinks as it fades, partly
 * different in each ear, surging as clusters of reflections come back.
 */
function roll(L: Float32Array, R: Float32Array, spec: Spec, far: number, rate: number) {
  const n = L.length
  const surges = Array.from({ length: 5 + Math.round(spec.tail * 2) }, () => ({
    at: 0.15 + Math.pow(Math.random(), 1.3) * spec.tail * 0.6,
    w: 0.08 + Math.random() * 0.25,
    a: 0.2 + Math.random() * 0.6,
  }))
  const top = 5000 * (1 - far * 0.6)
  const bottom = 380 * (1 - far * 0.3)
  const kDec = decayOf(spec.tail / 6.9, rate)
  const kAtt = decayOf(0.04, rate)
  const kSweep = decayOf(spec.tail * 0.25, rate)
  const filt = [0, 1, 2].map(() => [new Svf(), new Svf()])
  const brown = [0, 0, 0]
  const v = [0, 0, 0]
  const tail = [new Float32Array(n), new Float32Array(n)]
  let dec = 1
  let att = 1
  let sweep = 1
  let swell = 1
  for (let i = 0; i < n; i++) {
    if (i % BLOCK === 0) {
      const f = bottom + (top - bottom) * sweep
      for (const [a, b] of filt) {
        a.set(f, 0.6, rate)
        b.set(f, 0.6, rate)
      }
      const t = i / rate
      swell = 1
      for (const u of surges) swell += u.a * Math.exp(-(((t - u.at) / u.w) ** 2))
    }
    dec *= kDec
    att *= kAtt
    sweep *= kSweep
    const env = (1 - att) * dec * swell
    // Each side's own noise plus a shared one: wide, but still one event.
    for (let c = 0; c < 3; c++) {
      brown[c] = brown[c] * 0.996 + noise() * 0.06
      v[c] = filt[c][1].tick(filt[c][0].tick(noise() * 0.8 + brown[c] * 0.5))
    }
    tail[0][i] = (v[2] * 0.6 + v[0] * 0.4) * env
    tail[1][i] = (v[2] * 0.6 + v[1] * 0.4) * env
  }
  const g = (spec.mix.roll * (1 + far * 0.5)) / Math.max(peakOf(tail[0]), peakOf(tail[1]))
  for (let i = 0; i < n; i++) {
    L[i] += tail[0][i] * g
    R[i] += tail[1][i] * g
  }
}

/**
 * Struck steel: a few inharmonic modes ringing down, the way a plate or a shard does.
 * Ratios are a free plate's; the jitter keeps every piece different.
 */
function strike(L: Float32Array, R: Float32Array, at: number, f0: number, decay: number, amp: number, pan: number, rate: number, highs = 1) {
  const start = Math.floor(at * rate)
  const n = Math.min(L.length - start, Math.ceil(decay * 7 * rate))
  if (n <= 0) return
  const ring = new Float32Array(n)
  ;[1, 1.59, 2.14, 2.65, 3.6].forEach((ratio, k) => {
    // A damped resonator run as a rotating phasor: one multiply-add per sample.
    const w = (2 * Math.PI * f0 * ratio * (1 + (Math.random() - 0.5) * 0.04)) / rate
    if (w >= Math.PI) return
    const r = decayOf(decay / (1 + k * 0.6), rate)
    const c = Math.cos(w) * r
    const s = Math.sin(w) * r
    const ph = Math.random() * Math.PI * 2
    let re = Math.cos(ph)
    let im = Math.sin(ph)
    const a = (k ? 0.6 / k : 1) * (0.6 + Math.random() * 0.4) * (k > 1 ? highs : 1)
    for (let i = 0; i < n; i++) {
      ring[i] += a * im
      const nr = re * c - im * s
      im = re * s + im * c
      re = nr
    }
  })
  // The sharp tick as it lands, before the ring.
  const click = Math.ceil(0.002 * rate)
  for (let i = 0; i < click && i < n; i++) ring[i] += noise() * 1.6 * (1 - i / click) * highs
  mixIn(L, R, ring, at, amp, pan, rate)
}

/** Shrapnel and fittings coming down on the decks and into the sea around the blast. */
function debris(L: Float32Array, R: Float32Array, d: { count: number; span: number }, far: number, rate: number) {
  for (let i = 0; i < d.count; i++) {
    const at = 0.12 + Math.pow(Math.random(), 1.5) * d.span
    const fade = Math.exp(-at / (d.span * 0.6))
    const big = Math.random() < 0.25
    const f = big ? 400 + Math.random() * 600 : 1200 + Math.random() * 2400
    const decay = big ? 0.03 : 0.006 + Math.random() * 0.01
    strike(L, R, at, f, decay, 0.045 * fade * (big ? 1.4 : 1) * (1 - far * 0.5), Math.random() * 1.6 - 0.8, rate, lerp(0.8, 0.3, far))
    // Some of it goes into the water instead: a short, dull splash.
    if (Math.random() < 0.45) splash(L, R, at + Math.random() * 0.2, 0.035 * fade, Math.random() * 1.6 - 0.8, rate)
  }
}

function splash(L: Float32Array, R: Float32Array, at: number, amp: number, pan: number, rate: number) {
  const n = Math.ceil(0.14 * rate)
  const f = new Svf().set(600 + Math.random() * 900, 0.9, rate)
  const kAtt = decayOf(0.005, rate)
  const kDec = decayOf(0.035, rate)
  let att = 1
  let dec = 1
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    att *= kAtt
    dec *= kDec
    f.tick(noise() * (1 - att) * dec)
    s[i] = f.bp * 3
  }
  mixIn(L, R, s, at, amp, pan, rate)
}

/** The struck hull around us booming: low steel modes, long and dark. */
function hull(L: Float32Array, R: Float32Array, rate: number, amp: number) {
  strike(L, R, 0.004, 58 + Math.random() * 20, 0.5, 0.09 * amp, -0.2, rate, 0.4)
  strike(L, R, 0.01, 100 + Math.random() * 30, 0.35, 0.06 * amp, 0.25, rate, 0.4)
}

/**
 * Steel creaking as the hull gives: stick-slip friction, a train of tiny slips whose rate
 * wanders and slows, each one ringing a few resonances of the structure.
 */
function creak(L: Float32Array, R: Float32Array, rate: number) {
  const n = Math.min(L.length - Math.floor(0.5 * rate), Math.floor(2.4 * rate))
  if (n <= 0) return
  const bands = [170, 390, 720, 1150].map((f) => new Svf().set(f * (0.95 + Math.random() * 0.1), 14, rate))
  const kAtt = decayOf(0.35, rate)
  const kDec = decayOf(0.9, rate)
  let att = 1
  let dec = 1
  let next = 0
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    att *= kAtt
    dec *= kDec
    let x = 0
    if (i >= next) {
      x = 0.5 + Math.random() * 0.5
      const hz = (34 - 18 * (i / n)) * (0.8 + Math.random() * 0.4)
      next = i + Math.floor(rate / hz)
    }
    let v = 0
    for (const b of bands) {
      b.tick(x)
      v += b.bp
    }
    s[i] = v * (1 - att) * dec
  }
  mixIn(L, R, s, 0.5, 0.05, 0.15, rate)
}
