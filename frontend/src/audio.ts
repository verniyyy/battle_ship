// Procedural sound: every effect, the music and the sea ambience are
// synthesised with Web Audio, so the game is fully voiced without any asset.
//
// The graph is mixed like a small game soundtrack rather than a set of beeps:
//
//   effects ─┐                            ┌─> hall reverb ─┐
//   ui ──────┼─> (per sound: pan + send) ─┤                ├─> muffle ─> glue comp ─> limiter ─> volume ─> out
//   music ───┴─> duck ────────────────────┘                │
//   ambience ─────────────────────────────────────────────┘
//   guns, blasts ─> sea echo (two dark slap-backs off the horizon) ─> effects
//
// Effects are layered (transient, body, tail), slightly randomised so repeats
// don't sound mechanical, placed in stereo by where they happen on the board,
// and big moments duck the music so they land. Gunfire and detonations are the
// exception to the node graph: they are modelled sample by sample (blast.ts),
// echoes and tail included, so they barely use the shared hall or the sea echo.

import { blast, blastLength, type BlastOpts } from './blast'

export type Sfx =
  | 'tap'
  | 'select'
  | 'back'
  | 'lock'
  | 'cannon'
  | 'shell'
  | 'boom'
  | 'bigboom'
  | 'splash'
  | 'miss'
  | 'crit'
  | 'evade'
  | 'sonar'
  | 'flare'
  | 'torpedo'
  | 'airstrike'
  | 'charge'
  | 'combo'
  | 'coin'
  | 'gem'
  | 'levelup'
  | 'roll'
  | 'rare'
  | 'ssr'
  | 'chest'
  | 'victory'
  | 'defeat'
  | 'stamp'
  | 'tick'
  | 'whoosh'
  | 'alarm'
  | 'warn'
  | 'alert'
  | 'menace'
  | 'ultcharge'
  | 'ultboom'
  | 'order'
  | 'bosun'
  | 'founder'
  | 'bell'
  | 'sunk'
  | 'shellshock'
  | 'start'
  | 'move'
  | 'dive'
  | 'reveal'
  | 'star'
  | 'error'
  | 'heart'
  | 'stepup'
  | 'thunder'
  | 'shatter'
  | 'heartbeat'
  | 'jackpot'

export type Track = 'home' | 'battle' | 'boss' | 'gacha' | 'win' | 'lose'
export type Ambience = 'clear' | 'fog' | 'storm' | 'night'
export type Channel = 'bgm' | 'se'

export interface PlayOpts {
  /** Musical or intensity step for effects that climb (combo, coin, star…). */
  pitch?: number
  /** Stereo position, -1 (left) to 1 (right). */
  pan?: number
  /** Where a moving sound (a shell in flight) ends up. */
  panTo?: number
  /** How long a sound that tracks an animation (a shell's flight) lasts, in seconds. */
  dur?: number
  /** Gun calibre: 0 light (destroyer), 1 medium (cruiser), 2 heavy (battleship). */
  size?: number
  /** Heard from the enemy line: guns further off, hits on their ships, their shells inbound. */
  far?: boolean
}

const MUTE_KEY = 'muted'
const VOLUME_KEY = 'volume'

// Bus levels at a volume setting of 1; the player's BGM/SE settings scale these.
const MUSIC_LEVEL = 0.22
// A mastered recording runs much hotter than the synthesised songs; this sits it at their level.
const RECORDING_LEVEL = 0.5
const SFX_LEVEL = 0.8
const AMBIENCE_LEVEL = 0.25
const MASTER_LEVEL = 0.9
// Headroom after the limiter: its output sits near full scale, which is loud next to other tabs.
const OUTPUT_LEVEL = 0.6

// Gunfire and impacts sit this far under the rest of the SE: at the same level as the
// interface sounds, a salvo drowned the music and was reported as too loud.
const COMBAT_LEVEL = 0.5
const COMBAT = new Set<Sfx>(['cannon', 'shell', 'boom', 'bigboom', 'crit', 'splash', 'miss', 'founder', 'torpedo', 'airstrike', 'dive', 'shellshock'])

/** Slider position (0..1) to gain: squared so the slider moves evenly in loudness, not amplitude. */
const loudness = (v: number) => v * v

// Sounds fired in bursts (salvos, the full barrage) are rendered once offline and
// replayed as samples: a barrage of synthesised voices can outrun the audio thread
// (crackle, dropouts), while a buffer playback costs next to nothing. Each entry maps
// the options that change the sound to part of the cache key; pan is applied on playback.
const BAKE: Partial<Record<Sfx, (o: PlayOpts) => string>> = {
  cannon: (o) => `${calibre(o)}${o.far ? 'f' : ''}`,
  shell: (o) => `${flight(o)}${o.far ? 'f' : ''}`,
  boom: (o) => (o.far ? 'f' : ''),
  bigboom: (o) => (o.far ? 'f' : ''),
  ultboom: (o) => (o.far ? 'f' : ''),
  splash: () => '',
  miss: () => '',
  crit: () => '',
  evade: () => '',
  founder: (o) => (o.far ? 'f' : ''),
}
/** Takes kept per sound, so a salvo doesn't repeat one sample over and over. */
const TAKES: Partial<Record<Sfx, number>> = { cannon: 2, boom: 2, splash: 2 }
const BAKE_RATE = 24000
/** Explosions are modelled at the bake rate live too: there is little above 12kHz in them. */
const BLAST_RATE = BAKE_RATE
const BAKE_SECONDS = 4.5

const calibre = (o: PlayOpts) => Math.round(clamp(o.size ?? 1, 0, 2))
/** Shell flight in 50ms steps, so the few speed settings share a handful of takes. */
const flight = (o: PlayOpts) => Math.round(clamp(o.dur ?? 0.5, 0.12, 2) * 20)

interface Take {
  buf: AudioBuffer
  /** Mix moves (music ducks) the sound made while it was rendered, replayed with it. */
  moves: [depth: number, hold: number, back: number][]
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]
/** A small random detune factor so repeated sounds never repeat exactly. */
const vary = (amt = 0.04) => 1 + (Math.random() * 2 - 1) * amt

type Color = 'white' | 'pink' | 'brown'

interface Env {
  vol?: number
  /** Gate length: the release starts here. */
  dur: number
  a?: number
  /** Decay time constant; omit to hold the peak until the release. */
  d?: number
  /** Sustain as a fraction of the peak. */
  s?: number
  /** Release time constant. */
  r?: number
}

interface Shape {
  lp?: number
  lp2?: number
  lpT?: number
  q?: number
  hp?: number
  drive?: number
  /** Amplitude modulation depth (0..1) and rate. */
  trem?: number
  tremRate?: number
}

interface Voice extends Env, Shape {
  f: number
  f2?: number
  glide?: number
  type?: OscillatorType
  detune?: number
  /** Unison voices, their detune spread in cents and stereo width. */
  voices?: number
  spread?: number
  width?: number
  /** Vibrato depth in cents, rate and onset delay. */
  vib?: number
  vibRate?: number
  vibDelay?: number
}

interface NoiseVoice extends Env, Omit<Shape, 'lp' | 'lp2' | 'lpT'> {
  color?: Color
  filter?: BiquadFilterType
  f?: number
  f2?: number
  fT?: number
  /** Two decorrelated sources spread this far apart. */
  width?: number
}

interface FmVoice extends Env {
  f: number
  ratio: number
  index: number
  index2?: number
  indexT?: number
  lp?: number
}

// ---------------- music ----------------

type Note = [step: number, midi: number, len: number]
type Hit = [step: number, len: number]

interface Drums {
  kick?: string
  snare?: string
  hat?: string
  open?: string
  tom?: string
  shaker?: string
}

interface Song {
  bpm: number
  /** Delay of every other 16th, as a fraction of a step. */
  swing?: number
  /** One chord per bar, root first. */
  chords: number[][]
  pad?: 'strings' | 'choir' | 'warm'
  padVol?: number
  comp?: { kind: 'ep' | 'stab' | 'bell'; hits: Hit[]; octave?: number }
  /** [step, semitones above the bar root, length] */
  bass?: { kind: 'round' | 'drive'; notes: Note[] }
  arp?: { kind: 'pluck' | 'bell'; order: (number | null)[]; octave: number }
  /** [absolute step over the whole loop, MIDI note, length] */
  lead?: { kind: 'brass' | 'flute' | 'dark' | 'bell'; notes: Note[] }
  drums?: Drums
  /** Replaces the drums on the last bar of every four. */
  fill?: Drums
}

// Tracks the user supplies as recordings (frontend/public/bgm), looped instead of synthesised.
// A track with several recordings picks one at random each time it starts.
const FILES = {
  battle: ['/bgm/battle.mp3', '/bgm/battle2.mp3'],
  boss: ['/bgm/boss.mp3'],
} satisfies Partial<Record<Track, string[]>>
type FileTrack = keyof typeof FILES
const isFileTrack = (t: Track): t is FileTrack => t in FILES

const SONGS: Record<Exclude<Track, FileTrack>, Song> = {
  // Harbour: a warm, laid-back loop to sit in menus for a long time.
  home: {
    bpm: 84,
    swing: 0.14,
    chords: [
      [50, 54, 57, 61],
      [47, 50, 54, 57],
      [43, 47, 50, 54],
      [45, 50, 52, 55],
      [50, 54, 57, 61],
      [54, 57, 61, 64],
      [43, 47, 50, 54, 57],
      [45, 49, 52, 54],
    ],
    pad: 'warm',
    padVol: 0.5,
    comp: { kind: 'ep', hits: [[0, 5], [6, 2], [10, 5]], octave: 12 },
    bass: { kind: 'round', notes: [[0, 0, 5], [6, 7, 2], [10, 12, 3], [14, 7, 2]] },
    lead: {
      kind: 'flute',
      notes: [
        [64, 81, 3], [68, 78, 2], [70, 76, 2], [72, 74, 6], [78, 76, 2],
        [80, 78, 4], [84, 81, 4], [88, 85, 6], [94, 83, 2],
        [96, 81, 6], [102, 78, 2], [104, 74, 4], [108, 71, 4],
        [112, 73, 4], [116, 76, 4], [120, 81, 8],
      ],
    },
    drums: { kick: 'x.........x.....', snare: '....x.......x...', hat: '..x...x...x...x.', shaker: 'xxxxxxxxxxxxxxxx' },
    fill: { kick: 'x.........x.....', snare: '....x.......x.x.', hat: '..x...x...x...x.', shaker: 'xxxxxxxxxxxxxxxx' },
  },
  // Gacha: glittering music box over a soft lydian pad, all anticipation.
  gacha: {
    bpm: 116,
    chords: [
      [53, 57, 60, 64],
      [55, 59, 62, 64],
      [52, 55, 59, 62],
      [57, 60, 64, 67],
    ],
    pad: 'warm',
    padVol: 0.6,
    arp: { kind: 'bell', order: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3], octave: 24 },
    bass: { kind: 'round', notes: [[0, 0, 6], [8, 7, 4], [12, 12, 4]] },
    drums: { kick: 'x.......x.......', hat: '..x...x...x...x.', shaker: 'x.xxx.xxx.xxx.xx' },
  },
  // After a win: an unhurried, proud loop under the reward screen.
  win: {
    bpm: 96,
    chords: [
      [48, 52, 55, 60],
      [43, 47, 50, 55],
      [45, 48, 52, 57],
      [41, 45, 48, 53],
    ],
    pad: 'strings',
    padVol: 0.7,
    comp: { kind: 'bell', hits: [[0, 4], [6, 2], [8, 4], [14, 2]], octave: 24 },
    bass: { kind: 'round', notes: [[0, 0, 6], [8, 7, 4], [12, 12, 4]] },
    drums: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
  },
  // After a loss: slow and sparse, no drums.
  lose: {
    bpm: 68,
    chords: [
      [45, 48, 52],
      [41, 45, 48],
      [38, 41, 45],
      [40, 44, 47],
    ],
    pad: 'strings',
    padVol: 0.9,
    comp: { kind: 'ep', hits: [[0, 8], [8, 8]], octave: 12 },
    arp: { kind: 'bell', order: [0, null, 1, null, 2, null, 1, null, 3, null, 2, null, 1, null, null, null], octave: 24 },
    bass: { kind: 'round', notes: [[0, 0, 16]] },
  },
}

interface Channels {
  out: GainNode
  pad: AudioNode
  comp: AudioNode
  bass: AudioNode
  arp: AudioNode
  lead: AudioNode
  drums: AudioNode
  nodes: AudioNode[]
}

class AudioEngine {
  ctx?: AudioContext
  muted = readMuted()
  volume: Record<Channel, number> = readVolume()

  private master?: GainNode
  private muffle?: BiquadFilterNode
  private sfxBus?: GainNode
  private uiBus?: GainNode
  private musicBus?: GainNode
  private duckGain?: GainNode
  private volOut?: GainNode
  private ambBus?: GainNode
  private reverbIn?: GainNode
  private echoIn?: GainNode
  private noiseBufs = {} as Record<Color, AudioBuffer>
  private shapers = new Map<number, Float32Array<ArrayBuffer>>()
  private listeners = new Set<() => void>()

  // Nodes created for the sound being built, freed once its last voice ends.
  private group: AudioNode[] = []
  private groupEnd = 0
  private recent = new Map<Sfx, number[]>()

  private takes = new Map<string, Take[]>()
  private bakeQueue: { name: Sfx; opt: PlayOpts; key: string }[] = []
  private queued = new Set<string>()
  private baking = false
  /** Set while a sound is being rendered offline: collects its music ducks instead of applying them. */
  private moves?: Take['moves']
  /** Set while a sound is being built offline: the explosions it is waiting on before it can render. */
  private blasts?: Promise<void>[]

  private blaster?: Worker
  private blastSeq = 0
  private blastJobs = new Map<number, { o: BlastOpts; done: (pair: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]) => void }>()

  private track: Track | null = null
  private song?: Song
  private ch?: Channels
  private seqTimer?: number
  private nextTime = 0
  private step = 0

  private recordings = new Map<string, Promise<AudioBuffer | null>>()
  private recording?: { out: GainNode; src?: AudioBufferSourceNode }

  private ambience: Ambience | null = null
  private ambNodes: AudioNode[] = []
  private ambOut?: GainNode
  private ambTimer?: number

  /** Must be called from a user gesture to allow playback. */
  unlock() {
    if (!this.ctx) this.build()
    this.resume()
    void this.pump()
    const t = this.track
    if (t && !this.seqTimer && !this.recording) {
      this.track = null
      this.music(t)
    }
    const a = this.ambience
    if (a && !this.ambOut) {
      this.ambience = null
      this.setAmbience(a)
    }
  }

  private build() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = (this.ctx = new Ctx({ latencyHint: 'interactive' }))

    // Master: gentle glue compression, then a fast limiter so stacked explosions never clip.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.002
    limiter.release.value = 0.12
    const glue = ctx.createDynamicsCompressor()
    glue.threshold.value = -20
    glue.knee.value = 8
    glue.ratio.value = 3
    glue.attack.value = 0.008
    glue.release.value = 0.25
    this.muffle = ctx.createBiquadFilter()
    this.muffle.type = 'lowpass'
    this.muffle.frequency.value = 20000
    this.muffle.Q.value = 0.5
    this.master = ctx.createGain()
    this.master.gain.value = MASTER_LEVEL
    // A soft clipper after the limiter rounds off the few transients (gun cracks)
    // that get through its attack, instead of letting them hard-clip.
    const clip = ctx.createWaveShaper()
    clip.curve = softClip()
    // The player's volume is applied after the dynamics: in front of them it would just
    // be compressed and made up again, so turning it down barely made a difference.
    this.volOut = ctx.createGain()
    this.master.connect(this.muffle).connect(glue).connect(limiter).connect(clip).connect(this.volOut).connect(ctx.destination)

    // A single hall shared by everything gives the game one acoustic space.
    const reverb = ctx.createConvolver()
    reverb.buffer = this.impulse(1.6, 2.6)
    const reverbHp = ctx.createBiquadFilter()
    reverbHp.type = 'highpass'
    reverbHp.frequency.value = 180
    const reverbOut = ctx.createGain()
    // Kept well under the dry sound: a wetter hall smeared salvos into one long wash.
    reverbOut.gain.value = 0.55
    // Summed to mono before the (stereo) hall: two convolutions instead of four.
    this.reverbIn = ctx.createGain()
    this.reverbIn.channelCount = 1
    this.reverbIn.channelCountMode = 'explicit'
    this.reverbIn.connect(reverbHp).connect(reverb).connect(reverbOut).connect(this.master)

    this.sfxBus = ctx.createGain()
    this.sfxBus.connect(this.master)
    this.uiBus = ctx.createGain()
    this.uiBus.connect(this.master)
    this.duckGain = ctx.createGain()
    this.duckGain.connect(this.master)
    this.musicBus = ctx.createGain()
    this.musicBus.connect(this.duckGain)
    this.ambBus = ctx.createGain()
    this.ambBus.connect(this.master)
    this.applyLevels(0)

    this.echoIn = seaEcho(ctx, this.sfxBus)

    this.noiseBufs = { white: this.noiseBuffer('white'), pink: this.noiseBuffer('pink'), brown: this.noiseBuffer('brown') }
    // Fetched and decoded up front so a battle doesn't open in silence.
    for (const url of Object.values(FILES).flat()) void this.loadRecording(url)
  }

  /** The context can be suspended after the first gesture (tab switch, device change); wake it on the next one. */
  private resume() {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
  }

  /** Subscribes to mute and volume changes. */
  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  setMuted(m: boolean) {
    this.muted = m
    this.applyLevels(0.05)
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
    this.listeners.forEach((f) => f())
  }

  /**
   * Sets the bus and output gains from the volume settings. The louder channel's volume
   * is applied after the limiter; the buses only carry the balance between BGM and SE,
   * so the dynamics always see the mix at the same level.
   */
  private applyLevels(glide: number) {
    if (!this.ctx || !this.volOut) return
    const bgm = loudness(this.volume.bgm)
    const se = loudness(this.volume.se)
    const top = Math.max(bgm, se)
    const rel = (g: number) => (top > 0 ? g / top : 0)
    const now = this.ctx.currentTime
    const set = (p: AudioParam, v: number) => (glide > 0 ? p.setTargetAtTime(v, now, glide) : (p.value = v))
    set(this.volOut.gain, this.muted ? 0 : OUTPUT_LEVEL * top)
    set(this.musicBus!.gain, MUSIC_LEVEL * rel(bgm))
    set(this.sfxBus!.gain, SFX_LEVEL * rel(se))
    set(this.uiBus!.gain, SFX_LEVEL * rel(se))
    set(this.ambBus!.gain, AMBIENCE_LEVEL * rel(se))
  }

  /** Sets the BGM or SE volume (0..1) and remembers it. */
  setVolume(ch: Channel, v: number) {
    this.volume = { ...this.volume, [ch]: clamp(v, 0, 1) }
    this.applyLevels(0.05)
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(this.volume))
    } catch {
      /* storage unavailable */
    }
    this.listeners.forEach((f) => f())
  }

  /** Short vibration on phones that support it. */
  buzz(ms: number | number[]) {
    if (this.muted) return
    try {
      navigator.vibrate?.(ms)
    } catch {
      /* not allowed */
    }
  }

  // ---------------- buffers ----------------

  private noiseBuffer(color: Color) {
    const ctx = this.ctx!
    const len = ctx.sampleRate * 3
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (color === 'white') d[i] = w
      else if (color === 'pink') {
        // Paul Kellet's refined pink filter.
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.969 * b2 + w * 0.153852
        b3 = 0.8665 * b3 + w * 0.3104856
        b4 = 0.55 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.016898
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
        b6 = w * 0.115926
      } else {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      }
    }
    return buf
  }

  /** A stereo hall: early reflections, then a diffuse tail that darkens as it decays. */
  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!
    const rate = ctx.sampleRate
    const len = Math.floor(rate * seconds)
    const buf = ctx.createBuffer(2, len, rate)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      let lp = 0
      for (let i = 0; i < len; i++) {
        const t = i / rate
        const damp = 0.12 + 0.85 * Math.exp(-t * 2.2) // high frequencies die first
        lp += damp * (Math.random() * 2 - 1 - lp)
        d[i] = lp * Math.pow(1 - t / seconds, decay) * (t < 0.012 ? t / 0.012 : 1)
      }
      for (let k = 0; k < 8; k++) {
        const at = Math.floor(rate * (0.008 + k * 0.011 + Math.random() * 0.006))
        if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * 0.5 * Math.pow(0.8, k)
      }
    }
    return buf
  }

  private shaper(amount: number) {
    const key = Math.round(amount * 10)
    let curve = this.shapers.get(key)
    if (!curve) {
      curve = new Float32Array(1024)
      const k = amount * 4
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1
        curve[i] = Math.tanh(x * (1 + k)) / Math.tanh(1 + k)
      }
      this.shapers.set(key, curve)
    }
    const ws = this.ctx!.createWaveShaper()
    ws.curve = curve
    ws.oversample = 'none'
    return ws
  }

  // ---------------- primitives ----------------

  /** Shapes a gain parameter with attack, decay to sustain and release; returns when it is silent. */
  private env(p: AudioParam, t: number, e: Env) {
    const peak = e.vol ?? 0.2
    const a = e.a ?? 0.003
    const gate = Math.max(e.dur, a)
    const r = e.r ?? 0.04
    p.setValueAtTime(0, t)
    p.linearRampToValueAtTime(peak, t + a)
    if (e.d !== undefined) p.setTargetAtTime(peak * (e.s ?? 0), t + a, e.d)
    p.setTargetAtTime(0, t + gate, r)
    const silent = e.d !== undefined && !e.s ? Math.min(t + gate + r * 5, t + a + e.d * 6) : t + gate + r * 5
    this.groupEnd = Math.max(this.groupEnd, silent)
    return silent
  }

  /** Builds filter/drive/tremolo stages feeding `dest`; returns the input and the stages' LFOs. */
  private stages(dest: AudioNode, t: number, end: number, s: Shape, filter?: { type: BiquadFilterType; f: number; f2?: number; fT?: number; q?: number }) {
    const ctx = this.ctx!
    let input: AudioNode = dest
    if (s.trem) {
      const g = ctx.createGain()
      g.gain.value = 1 - s.trem / 2
      const lfo = ctx.createOscillator()
      lfo.frequency.value = s.tremRate ?? 8
      const depth = ctx.createGain()
      depth.gain.value = s.trem / 2
      lfo.connect(depth).connect(g.gain)
      lfo.start(t)
      lfo.stop(end)
      g.connect(input)
      input = g
    }
    const filters: { type: BiquadFilterType; f: number; f2?: number; fT?: number; q?: number }[] = []
    if (filter) filters.push(filter)
    if (s.lp) filters.push({ type: 'lowpass', f: s.lp, f2: s.lp2, fT: s.lpT, q: s.q })
    if (s.hp) filters.push({ type: 'highpass', f: s.hp })
    for (const spec of filters) {
      const f = ctx.createBiquadFilter()
      f.type = spec.type
      f.frequency.setValueAtTime(spec.f, t)
      if (spec.f2) f.frequency.exponentialRampToValueAtTime(Math.max(spec.f2, 10), t + (spec.fT ?? end - t))
      f.Q.value = spec.q ?? 0.7
      f.connect(input)
      input = f
    }
    if (s.drive) {
      const ws = this.shaper(s.drive)
      ws.connect(input)
      input = ws
    }
    return input
  }

  private osc(dest: AudioNode, t: number, v: Voice) {
    const ctx = this.ctx!
    const n = v.voices ?? 1
    const g = ctx.createGain()
    const end = this.env(g.gain, t, { ...v, vol: (v.vol ?? 0.2) / Math.sqrt(n) })
    g.connect(dest)
    const input = this.stages(g, t, end, v)
    let vib: GainNode | undefined
    if (v.vib) {
      const lfo = ctx.createOscillator()
      lfo.frequency.value = v.vibRate ?? 5.5
      vib = ctx.createGain()
      const on = t + (v.vibDelay ?? 0.12)
      vib.gain.setValueAtTime(0, t)
      vib.gain.setValueAtTime(0, on)
      vib.gain.linearRampToValueAtTime(v.vib, on + 0.25)
      lfo.connect(vib)
      lfo.start(t)
      lfo.stop(end)
    }
    // Wide unison: voices alternate between one left and one right panner.
    const sides = v.width && n > 1 ? [-v.width, v.width].map((pan) => {
      const p = ctx.createStereoPanner()
      p.pan.value = pan
      p.connect(input)
      return p
    }) : undefined
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator()
      o.type = v.type ?? 'sine'
      o.frequency.setValueAtTime(v.f, t)
      if (v.f2) o.frequency.exponentialRampToValueAtTime(Math.max(v.f2, 1), t + (v.glide ?? v.dur))
      const pos = n > 1 ? (i / (n - 1)) * 2 - 1 : 0
      o.detune.value = (v.detune ?? 0) + pos * (v.spread ?? 12)
      vib?.connect(o.detune)
      o.connect(sides ? sides[i % 2] : input)
      o.start(t)
      o.stop(end)
    }
    return end
  }

  private noise(dest: AudioNode, t: number, v: NoiseVoice) {
    const ctx = this.ctx!
    const g = ctx.createGain()
    const end = this.env(g.gain, t, v)
    g.connect(dest)
    const input = this.stages(g, t, end, v, { type: v.filter ?? 'lowpass', f: v.f ?? 1000, f2: v.f2, fT: v.fT, q: v.q })
    const sources = v.width ? [-v.width, v.width] : [0]
    for (const pan of sources) {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBufs[v.color ?? 'white']
      src.loop = true
      if (pan) {
        const p = ctx.createStereoPanner()
        p.pan.value = pan
        src.connect(p).connect(input)
      } else src.connect(input)
      src.start(t, Math.random() * 2.5)
      src.stop(end)
    }
    return end
  }

  /** Two-operator FM: bells, glass, electric piano and metal. */
  private fm(dest: AudioNode, t: number, v: FmVoice) {
    const ctx = this.ctx!
    const g = ctx.createGain()
    const end = this.env(g.gain, t, v)
    let input: AudioNode = g
    if (v.lp) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = v.lp
      f.connect(g)
      input = f
    }
    g.connect(dest)
    const car = ctx.createOscillator()
    car.frequency.value = v.f
    const mod = ctx.createOscillator()
    mod.frequency.value = v.f * v.ratio
    const depth = ctx.createGain()
    depth.gain.setValueAtTime(v.index * v.f, t)
    depth.gain.exponentialRampToValueAtTime(Math.max((v.index2 ?? v.index * 0.1) * v.f, 0.01), t + (v.indexT ?? v.dur))
    mod.connect(depth).connect(car.frequency)
    car.connect(input)
    car.start(t)
    mod.start(t)
    car.stop(end)
    mod.stop(end)
    return end
  }

  private bell(dest: AudioNode, t: number, note: number, vol: number, len = 0.6) {
    this.fm(dest, t, { f: midi(note), ratio: 3.5, index: 1.3, index2: 0.04, indexT: len * 0.5, vol: vol * 1.4, dur: len * 2, d: len * 0.5, r: 0.2 })
  }

  private brass(dest: AudioNode, t: number, notes: number[], dur: number, vol: number, bright = 3200) {
    for (const n of notes)
      this.osc(dest, t, { f: midi(n), type: 'sawtooth', voices: 3, spread: 10, width: 0.4, vol, dur, a: 0.04, d: 0.5, s: 0.55, r: 0.25, lp: 500, lp2: bright, lpT: 0.09, q: 1.2 })
  }

  private timpani(dest: AudioNode, t: number, note: number, vol: number) {
    const f = midi(note)
    this.osc(dest, t, { f: f * 1.06, f2: f, glide: 0.08, vol, dur: 1.4, d: 0.45, r: 0.3 })
    this.osc(dest, t, { f: f * 1.5, vol: vol * 0.25, dur: 0.8, d: 0.2 })
    this.noise(dest, t, { color: 'brown', f: 900, vol: vol * 0.8, dur: 0.2, d: 0.05 })
  }

  private cymbal(dest: AudioNode, t: number, vol: number, len = 1.6) {
    this.noise(dest, t, { color: 'white', filter: 'highpass', f: 5200, vol, dur: len, d: len * 0.35, r: 0.3, width: 0.6 })
    this.noise(dest, t, { color: 'white', filter: 'bandpass', f: 3200, q: 0.8, vol: vol * 0.5, dur: 0.25, d: 0.06 })
  }

  /** Scattered small cracks: debris, fire, sparks. */
  private crackle(dest: AudioNode, t: number, count: number, span: number, vol: number, lo = 2000, hi = 6000) {
    for (let i = 0; i < count; i++)
      this.noise(dest, t + Math.pow(Math.random(), 1.6) * span, { color: 'white', filter: 'bandpass', f: rnd(lo, hi), q: 2, vol: vol * rnd(0.4, 1), dur: 0.02, d: 0.006 })
  }

  /** Bubble: a sine that pitches up quickly as it collapses. */
  private bubbles(dest: AudioNode, t: number, count: number, span: number, vol: number, lo = 350, hi = 1100) {
    for (let i = 0; i < count; i++) {
      const f = rnd(lo, hi)
      this.osc(dest, t + Math.random() * span, { f, f2: f * rnd(1.8, 2.6), glide: 0.05, vol: vol * rnd(0.4, 1), dur: 0.06, d: 0.02 })
    }
  }

  /**
   * A modelled explosion (blast.ts) played into `dest` at `t`. It is computed in a worker:
   * an offline render waits for it, live playback starts as soon as it arrives.
   */
  private explode(dest: AudioNode, t: number, o: BlastOpts) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.connect(dest)
    const offline = !!this.blasts
    const ready = this.renderBlast(o).then(([l, r]) => {
      const buf = ctx.createBuffer(2, l.length, BLAST_RATE)
      buf.copyToChannel(l, 0)
      buf.copyToChannel(r, 1)
      src.buffer = buf
      src.start(offline ? t : Math.max(t, ctx.currentTime))
    })
    this.blasts?.push(ready)
    this.group.push(src)
    // Live, allow for the render's latency before the strip is freed.
    this.groupEnd = Math.max(this.groupEnd, t + blastLength(o) + (offline ? 0 : 1))
  }

  private renderBlast(o: BlastOpts) {
    return new Promise<[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]>((done) => {
      if (!this.blaster) {
        try {
          this.blaster = new Worker(new URL('./blast.worker.ts', import.meta.url), { type: 'module' })
          this.blaster.onmessage = (e: MessageEvent<{ id: number; l: Float32Array<ArrayBuffer>; r: Float32Array<ArrayBuffer> }>) => {
            const job = this.blastJobs.get(e.data.id)
            this.blastJobs.delete(e.data.id)
            job?.done([e.data.l, e.data.r])
          }
          // No worker (blocked or failed to load): finish its jobs here, and every later one.
          this.blaster.onerror = () => {
            this.blaster?.terminate()
            this.blaster = undefined
            this.blastSeq = -1
            for (const job of this.blastJobs.values()) job.done(blast(job.o, BLAST_RATE))
            this.blastJobs.clear()
          }
        } catch {
          this.blastSeq = -1
        }
      }
      if (this.blastSeq < 0 || !this.blaster) return done(blast(o, BLAST_RATE))
      const id = ++this.blastSeq
      this.blastJobs.set(id, { o, done })
      this.blaster.postMessage({ id, o, rate: BLAST_RATE })
    })
  }

  // ---------------- mix helpers ----------------

  /**
   * A per-sound strip: level, pan (optionally moving), reverb and sea-echo sends,
   * and an optional low-pass that pushes the sound into the distance.
   */
  private out(bus: AudioNode, o: { pan?: number; panTo?: number; panT?: number; send?: number; echo?: number; lp?: number; vol?: number } = {}) {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const g = ctx.createGain()
    g.gain.value = o.vol ?? 1
    const p = ctx.createStereoPanner()
    p.pan.setValueAtTime(clamp(o.pan ?? 0, -1, 1), t)
    if (o.panTo !== undefined) p.pan.linearRampToValueAtTime(clamp(o.panTo, -1, 1), t + 0.025 + (o.panT ?? 0.5))
    this.group.push(g, p)
    if (o.lp) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = o.lp
      f.Q.value = 0.5
      g.connect(f).connect(p)
      this.group.push(f)
    } else g.connect(p)
    p.connect(bus)
    for (const [amount, dest] of [[o.send, this.reverbIn!], [o.echo, this.echoIn!]] as const) {
      if (!amount) continue
      const s = ctx.createGain()
      s.gain.value = amount
      p.connect(s).connect(dest)
      this.group.push(s)
    }
    return g
  }

  /** Frees the strips of the sound just built once its last voice has rung out. */
  private release() {
    const nodes = this.group
    const ms = (this.groupEnd - this.ctx!.currentTime + 0.5) * 1000
    this.group = []
    this.groupEnd = 0
    if (this.moves) return // an offline render: the whole context is dropped afterwards
    window.setTimeout(() => nodes.forEach((n) => n.disconnect()), Math.max(ms, 500))
  }

  /** Pulls the music down so a big moment lands, then lets it back. */
  private duck(depth: number, hold: number, back: number) {
    if (this.moves) {
      this.moves.push([depth, hold, back])
      return
    }
    const g = this.duckGain!.gain
    const t = this.ctx!.currentTime
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(depth, t + 0.03)
    g.setValueAtTime(depth, t + hold)
    g.linearRampToValueAtTime(1, t + hold + back)
  }

  /** Shell-shock: the whole mix goes muffled and slowly clears. */
  private shock(len: number) {
    const f = this.muffle!.frequency
    const t = this.ctx!.currentTime
    f.cancelScheduledValues(t)
    f.setValueAtTime(f.value, t)
    f.exponentialRampToValueAtTime(420, t + 0.06)
    f.setValueAtTime(420, t + 0.4)
    f.exponentialRampToValueAtTime(20000, t + len)
  }

  /** How many copies of the current sound started within the last quarter second (1 = alone). */
  private copies = 1

  /** How loud a repeat of `name` may be: rapid-fire copies are thinned and softened. */
  private density(name: Sfx, now: number) {
    const hist = (this.recent.get(name) ?? []).filter((at) => now - at < 0.25)
    const limit = name === 'cannon' || name === 'shell' || name === 'boom' || name === 'miss' || name === 'splash' ? 4 : 3
    if (hist.length >= limit) return 0
    if (hist.length && now - hist[hist.length - 1] < 0.025) return 0
    hist.push(now)
    this.recent.set(name, hist)
    this.copies = hist.length
    return 1 / Math.sqrt(hist.length)
  }

  // ---------------- effects ----------------

  play(name: Sfx, opt: PlayOpts = {}) {
    if (this.muted || this.volume.se === 0 || !this.ctx) return
    this.resume()
    const now = this.ctx.currentTime
    const level = this.density(name, now) * (COMBAT.has(name) ? COMBAT_LEVEL : 1)
    if (!level) return
    const key = this.keyOf(name, opt)
    const takes = key && this.takes.get(key)
    if (takes) {
      this.playTake(takes[Math.floor(Math.random() * takes.length)], name, opt, level)
      return
    }
    if (key) this.queueBake(name, opt, key)
    // Enough lookahead that building a large sound finishes before it is due.
    this.synth(name, opt, now + 0.025, level)
  }

  /** Renders the burst sounds a battle will use ahead of time, so the first salvo is already cheap. */
  prewarm(list: [Sfx, PlayOpts?][]) {
    for (const [name, opt = {}] of list) {
      const key = this.keyOf(name, opt)
      if (key) this.queueBake(name, opt, key)
    }
  }

  private keyOf(name: Sfx, opt: PlayOpts) {
    const k = BAKE[name]
    return k ? `${name}:${k(opt)}` : undefined
  }

  private queueBake(name: Sfx, opt: PlayOpts, key: string) {
    if (this.takes.has(key) || this.queued.has(key)) return
    this.queued.add(key)
    this.bakeQueue.push({ name, opt, key })
    void this.pump()
  }

  /** Renders queued sounds one at a time, off the real-time audio thread. */
  private async pump() {
    if (this.baking || !this.ctx) return
    this.baking = true
    try {
      for (let job = this.bakeQueue.shift(); job; job = this.bakeQueue.shift()) {
        const takes: Take[] = []
        for (let i = 0; i < (TAKES[job.name] ?? 1); i++) {
          const take = await this.bake(job.name, job.opt).catch(() => undefined)
          if (take) takes.push(take)
        }
        if (takes.length) this.takes.set(job.key, takes)
        this.queued.delete(job.key)
      }
    } finally {
      this.baking = false
    }
  }

  /**
   * Renders one take of a sound through the same code as live playback, into three
   * channels: the dry stereo mix (sea echo included) and the reverb send.
   */
  private async bake(name: Sfx, opt: PlayOpts): Promise<Take> {
    const off = new OfflineAudioContext(3, Math.ceil(BAKE_RATE * BAKE_SECONDS), BAKE_RATE)
    const merge = off.createChannelMerger(3)
    merge.connect(off.destination)
    const dry = off.createGain()
    const split = off.createChannelSplitter(2)
    dry.connect(split)
    split.connect(merge, 0, 0)
    split.connect(merge, 1, 1)
    const rev = off.createGain()
    rev.channelCount = 1
    rev.channelCountMode = 'explicit'
    rev.connect(merge, 0, 2)

    const live = { ctx: this.ctx, sfxBus: this.sfxBus, uiBus: this.uiBus, reverbIn: this.reverbIn, echoIn: this.echoIn, copies: this.copies }
    const moves: Take['moves'] = []
    this.ctx = off as unknown as AudioContext
    this.sfxBus = this.uiBus = dry
    this.reverbIn = rev
    this.echoIn = seaEcho(off, dry)
    this.moves = moves
    this.copies = 1
    const dur = name === 'shell' ? flight(opt) / 20 : opt.dur
    const blasts: Promise<void>[] = (this.blasts = [])
    try {
      this.synth(name, { ...opt, dur, pan: 0, panTo: undefined }, 0, 1)
    } finally {
      Object.assign(this, live)
      this.moves = undefined
      this.blasts = undefined
    }
    await Promise.all(blasts)

    const full = await off.startRendering()
    // Cut the tail once it is 60dB under the peak, with a short fade, so the bank stays small.
    let peak = 0
    for (let c = 0; c < 3; c++) for (const v of full.getChannelData(c)) peak = Math.max(peak, Math.abs(v))
    let end = 0
    for (let c = 0; c < 3; c++) {
      const d = full.getChannelData(c)
      for (let i = d.length - 1; i > end; i--)
        if (Math.abs(d[i]) > peak * 1e-3) {
          end = i
          break
        }
    }
    const fade = Math.ceil(BAKE_RATE * 0.05)
    const len = Math.min(full.length, end + fade)
    const buf = new AudioBuffer({ numberOfChannels: 3, length: len, sampleRate: BAKE_RATE })
    for (let c = 0; c < 3; c++) {
      const d = full.getChannelData(c).subarray(0, len)
      for (let i = Math.max(0, len - fade); i < len; i++) d[i] *= (len - i) / fade
      buf.copyToChannel(d, c)
    }
    return { buf, moves }
  }

  /** Plays a rendered take: dry pair through a strip for pan and level, third channel to the hall. */
  private playTake(take: Take, name: Sfx, opt: PlayOpts, level: number) {
    const ctx = this.ctx!
    const t = ctx.currentTime + 0.01
    for (const m of take.moves) this.duck(...m)
    const src = ctx.createBufferSource()
    src.buffer = take.buf
    // The shell's flight is timed to the animation; everything else drifts a little in pitch.
    if (name !== 'shell') src.playbackRate.value = vary(0.035)
    const split = ctx.createChannelSplitter(3)
    const pair = ctx.createChannelMerger(2)
    src.connect(split)
    split.connect(pair, 0, 0)
    split.connect(pair, 1, 1)
    pair.connect(this.out(this.sfxBus!, { pan: opt.pan, panTo: opt.panTo, panT: opt.dur, vol: level }))
    const rev = ctx.createGain()
    rev.gain.value = level
    split.connect(rev, 2).connect(this.reverbIn!)
    src.start(t)
    this.group.push(src, split, pair, rev)
    this.groupEnd = t + take.buf.duration * 1.05
    this.release()
  }

  private synth(name: Sfx, opt: PlayOpts, t: number, level: number) {
    const p = opt.pitch ?? 0
    const pan = opt.pan ?? 0
    const far = !!opt.far
    const fx = (send: number, extra: { pan?: number; panTo?: number; panT?: number; echo?: number; lp?: number; vol?: number } = {}) =>
      this.out(this.sfxBus!, { pan, send, ...extra, vol: level * (extra.vol ?? 1) })
    const ui = (send = 0.08) => this.out(this.uiBus!, { pan, send, vol: level })

    switch (name) {
      // ---- interface ----
      case 'tap': {
        const d = ui(0.06)
        this.fm(d, t, { f: 1760 * vary(0.03), ratio: 2.01, index: 1.1, index2: 0.1, indexT: 0.05, vol: 0.3, dur: 0.07, d: 0.022 })
        this.noise(d, t, { filter: 'highpass', f: 6500, vol: 0.14, dur: 0.012, d: 0.004 })
        break
      }
      case 'select': {
        const d = ui(0.14)
        this.fm(d, t, { f: midi(88), ratio: 2, index: 1.4, index2: 0.1, indexT: 0.08, vol: 0.09, dur: 0.1, d: 0.04 })
        this.fm(d, t + 0.055, { f: midi(95), ratio: 2, index: 1.2, index2: 0.05, indexT: 0.2, vol: 0.1, dur: 0.35, d: 0.1, r: 0.1 })
        this.osc(d, t, { f: midi(76), vol: 0.06, dur: 0.12, d: 0.05 })
        break
      }
      case 'back': {
        const d = ui(0.1)
        this.fm(d, t, { f: midi(90), ratio: 2, index: 1, vol: 0.12, dur: 0.08, d: 0.03 })
        this.fm(d, t + 0.05, { f: midi(83), ratio: 2, index: 0.8, vol: 0.12, dur: 0.2, d: 0.06 })
        break
      }
      case 'error': {
        const d = ui(0.1)
        for (const at of [0, 0.12]) {
          this.osc(d, t + at, { f: 155, type: 'square', voices: 2, spread: 60, vol: 0.09, dur: 0.14, d: 0.06, lp: 900 })
          this.osc(d, t + at, { f: 78, vol: 0.12, dur: 0.12, d: 0.05 })
        }
        break
      }
      case 'lock': {
        // Radar lock on a target cell.
        const d = ui(0.12)
        this.osc(d, t, { f: 1975, type: 'square', vol: 0.1, dur: 0.035, d: 0.012, lp: 5000 })
        this.osc(d, t + 0.06, { f: 2637, type: 'square', vol: 0.1, dur: 0.05, d: 0.02, lp: 5000 })
        this.noise(d, t, { filter: 'bandpass', f: 3000, f2: 7000, q: 3, vol: 0.12, dur: 0.1, d: 0.03 })
        break
      }
      case 'whoosh': {
        // Scene shutter: a moving air sweep that lands with a soft thump as it closes.
        const d = this.out(this.uiBus!, { pan: -0.5, panTo: 0.5, panT: 0.4, send: 0.15, vol: level })
        this.noise(d, t, { color: 'pink', filter: 'bandpass', f: 260, f2: 2800, fT: 0.34, q: 1.3, vol: 0.32, dur: 0.34, a: 0.22, r: 0.05 })
        this.noise(d, t + 0.1, { filter: 'highpass', f: 3000, f2: 8000, fT: 0.25, vol: 0.05, dur: 0.24, a: 0.14, r: 0.03 })
        this.osc(d, t + 0.36, { f: 110, f2: 42, glide: 0.1, vol: 0.28, dur: 0.2, d: 0.06 })
        this.noise(d, t + 0.36, { color: 'brown', f: 700, vol: 0.18, dur: 0.1, d: 0.03 })
        break
      }
      case 'tick': {
        const d = ui(0)
        this.osc(d, t, { f: 1500 + p * 40, f2: 1100 + p * 40, glide: 0.02, vol: 0.2, dur: 0.03, d: 0.01 })
        this.noise(d, t, { filter: 'bandpass', f: 3200, q: 3, vol: 0.1, dur: 0.01, d: 0.004 })
        break
      }

      // ---- gunnery ----
      case 'cannon': {
        // A naval gun as a microphone hears it (see blast.ts): the blast wave, the
        // fireball's roar, the sea's reflection and the echoes rolling back off the
        // water. Heavier calibres push a longer, deeper wave and roll on longer; the
        // enemy's guns are kilometres off, a dull thump with the tail carrying it.
        const size = clamp(opt.size ?? 1, 0, 2)
        const d = fx(far ? 0.08 : 0.04, { vol: (far ? 0.88 : 1) * [0.58, 0.85, 1.3][Math.round(size)] })
        this.explode(d, t, { kind: 'gun', size, far })
        break
      }
      case 'shell': {
        const len = clamp(opt.dur ?? 0.5, 0.12, 2)
        const d = fx(0.22, { panTo: opt.panTo ?? pan, panT: len })
        if (far) {
          // Incoming: the whistle drops in pitch and swells until the shell lands.
          const f = rnd(1800, 2400)
          this.osc(d, t, { f, f2: f * 0.42, glide: len, type: 'triangle', vol: 0.1, a: len * 0.8, dur: len, r: 0.012, vib: 12, vibRate: rnd(6, 9), vibDelay: 0 })
          this.noise(d, t, { color: 'pink', filter: 'bandpass', f: f * 0.95, f2: f * 0.42, fT: len, q: 5, vol: 0.26, a: len * 0.85, dur: len, r: 0.012 })
          this.noise(d, t, { color: 'pink', filter: 'bandpass', f: 700, f2: 300, fT: len, q: 0.8, vol: 0.2, a: len * 0.9, dur: len, r: 0.015 })
        } else {
          // Outgoing: a tearing rush that recedes toward the target.
          this.noise(d, t, { color: 'pink', filter: 'bandpass', f: 1500, f2: 450, fT: len, q: 1.6, vol: 0.28, a: 0.03, dur: len * 0.7, d: len * 0.35, r: 0.08, trem: 0.35, tremRate: 32 })
          this.osc(d, t, { f: rnd(900, 1100), f2: 520, glide: len, type: 'triangle', vol: 0.035, a: 0.05, dur: len * 0.7, d: len * 0.4, r: 0.08 })
        }
        break
      }
      case 'boom': {
        // A shell detonating on a ship: the blast and fireball, then shrapnel and
        // fittings raining down on the decks and into the sea. A hit on our own
        // ships also booms through the hull around us.
        const d = fx(0.06)
        this.explode(d, t, { kind: 'hit', far })
        break
      }
      case 'bigboom': {
        // A devastating hit: the magazine goes, secondaries follow and the hull creaks.
        this.duck(0.3, 0.35, 1.6)
        const d = fx(0.08, { vol: 1.55 })
        this.explode(d, t, { kind: 'magazine', far })
        break
      }
      case 'founder': {
        // A ship going down: boilers flash to steam, the hull groans and the sea pours in.
        const d = fx(far ? 0.5 : 0.35, { lp: far ? 3500 : undefined })
        this.noise(d, t, { filter: 'highpass', f: 2600, f2: 5000, fT: 1.5, vol: 0.13, a: 0.25, dur: 1.4, d: 0.8, r: 0.5, width: 0.7 })
        this.osc(d, t + 0.2, { f: 58, f2: 34, glide: 2.2, type: 'sawtooth', voices: 2, spread: 30, vol: 0.1, a: 0.4, dur: 2, d: 1, r: 0.5, lp: 320, q: 5 })
        this.fm(d, t + 0.5, { f: 92, ratio: 1.414, index: 4, index2: 0.2, indexT: 1.2, vol: 0.06, a: 0.2, dur: 1.4, d: 0.6 })
        this.noise(d, t + 0.4, { color: 'brown', f: 420, vol: 0.45, a: 0.5, dur: 1.8, d: 0.9, r: 0.6, trem: 0.5, tremRate: 3 })
        this.bubbles(d, t + 0.6, 22, 2.4, 0.07, 140, 460)
        break
      }
      case 'crit': {
        const d = fx(0.4)
        this.fm(d, t, { f: 2637, ratio: 1.5, index: 2, index2: 0.15, indexT: 0.5, vol: 0.12, dur: 1.2, d: 0.4 })
        this.noise(d, t, { filter: 'highpass', f: 4000, f2: 9000, fT: 0.2, vol: 0.28, dur: 0.3, d: 0.1 })
        this.osc(d, t, { f: midi(64), type: 'sawtooth', voices: 3, spread: 18, width: 0.6, vol: 0.07, dur: 0.5, d: 0.22, lp: 5500, lp2: 1200, lpT: 0.4 })
        this.osc(d, t, { f: midi(71), type: 'sawtooth', voices: 3, spread: 18, width: 0.6, vol: 0.06, dur: 0.5, d: 0.22, lp: 5500, lp2: 1200, lpT: 0.4 })
        const sides = [-0.5, 0.5].map((p) => this.out(this.sfxBus!, { pan: p, send: 0.4, vol: level }))
        ;[96, 100, 103, 108, 103].forEach((n, i) => this.bell(sides[i % 2], t + 0.02 + i * 0.035, n, 0.04, 0.3))
        break
      }
      case 'splash':
      case 'miss': {
        // A shell into the sea: the plunge, a column of water thrown up, then the
        // column collapsing back as a heavy rain. A near miss ('splash') is bigger.
        const big = name === 'splash'
        const w = big ? 1 : 0.6
        const d = fx(big ? 0.3 : 0.22, { echo: big ? 0.25 : 0.12 })
        this.noise(d, t, { filter: 'bandpass', f: 1900 * vary(), q: 0.9, vol: 0.4 * w, dur: 0.025, d: 0.01, drive: 2 })
        this.noise(d, t, { color: 'brown', f: 320, vol: 0.9 * w, dur: 0.12, d: 0.05, drive: 1.5 })
        this.noise(d, t + 0.01, { color: 'pink', filter: 'bandpass', f: 450, f2: 1900, fT: 0.25, q: 0.6, vol: 0.55 * w, a: 0.03, dur: 0.3, d: 0.18, width: 0.5 })
        const fall = t + (big ? 0.38 : 0.26)
        this.noise(d, fall, { filter: 'highpass', f: 2400, vol: 0.22 * w, a: 0.2, dur: big ? 0.8 : 0.45, d: big ? 0.4 : 0.22, width: 0.8 })
        this.noise(d, fall, { color: 'pink', filter: 'bandpass', f: 900, q: 0.5, vol: 0.2 * w, a: 0.15, dur: big ? 0.7 : 0.4, d: big ? 0.3 : 0.18, width: 0.6 })
        this.bubbles(d, t + 0.08, big ? 7 : 4, big ? 0.6 : 0.4, 0.05)
        break
      }
      case 'evade': {
        const d = fx(0.2, { panTo: pan + 0.6, panT: 0.3 })
        this.noise(d, t, { color: 'pink', filter: 'bandpass', f: 500, f2: 4200, fT: 0.2, q: 2.2, vol: 0.6, a: 0.1, dur: 0.22, r: 0.06 })
        this.osc(d, t + 0.04, { f: 520, f2: 1500, glide: 0.2, type: 'triangle', vol: 0.06, dur: 0.22, d: 0.08 })
        break
      }

      // ---- skills ----
      case 'sonar': {
        this.duck(0.55, 1.6, 1)
        for (let i = 0; i < 4; i++) {
          const d = this.out(this.sfxBus!, { pan: i ? (i % 2 ? -0.45 : 0.45) : pan, send: 0.6, vol: level * Math.pow(0.38, i) })
          this.osc(d, t + i * 0.55, { f: 1480, f2: 1430, glide: 0.9, vol: 0.26, dur: 1.2, d: 0.42, lp: i ? 2400 : 8000 })
          this.fm(d, t + i * 0.55, { f: 1480, ratio: 1, index: 0.6, vol: 0.06, dur: 0.6, d: 0.15 })
        }
        break
      }
      case 'flare': {
        const d = fx(0.4)
        this.noise(d, t, { filter: 'bandpass', f: 2000, vol: 0.3, dur: 0.03, d: 0.01 })
        this.osc(d, t, { f: 500, f2: 2600, glide: 0.5, vol: 0.06, a: 0.05, dur: 0.5, r: 0.02 })
        this.noise(d, t, { filter: 'highpass', f: 3000, vol: 0.12, a: 0.2, dur: 0.5, r: 0.02 })
        this.osc(d, t + 0.5, { f: 300, f2: 80, glide: 0.1, vol: 0.5, dur: 0.2, d: 0.08 })
        this.noise(d, t + 0.5, { color: 'brown', f: 2200, vol: 0.5, dur: 0.2, d: 0.1 })
        this.noise(d, t + 0.52, { filter: 'highpass', f: 4000, vol: 0.18, a: 0.05, dur: 1.4, d: 0.7, width: 0.5 })
        this.crackle(d, t + 0.55, 18, 1.3, 0.1, 3000, 8000)
        this.bell(d, t + 0.5, 96, 0.05, 0.8)
        break
      }
      case 'torpedo': {
        // Launch: a blast of compressed air, the fish hitting the water, then its
        // screws running under the surface. The enemy's torpedoes come at us instead:
        // their screws swell as the track closes in.
        const d = fx(0.3, { panTo: far ? pan * 0.3 : pan * -0.5, panT: 1.4, lp: far ? 3000 : undefined })
        this.noise(d, t, { filter: 'highpass', f: 1800, f2: 900, fT: 0.25, vol: 0.4, dur: 0.22, d: 0.07, width: 0.4 })
        this.noise(d, t, { color: 'brown', f: 380, vol: 0.7, dur: 0.1, d: 0.04 })
        this.noise(d, t + 0.13, { filter: 'bandpass', f: 1700, q: 0.9, vol: 0.28, dur: 0.02, d: 0.008 })
        this.noise(d, t + 0.13, { color: 'pink', filter: 'bandpass', f: 500, f2: 1400, fT: 0.2, q: 0.7, vol: 0.3, a: 0.02, dur: 0.25, d: 0.12 })
        const run = t + 0.25
        const a = far ? 1 : 0.2
        this.noise(d, run, { color: 'pink', filter: 'bandpass', f: 900, q: 5, vol: 0.15, a, dur: 1.2, r: 0.2 })
        this.osc(d, run, { f: far ? 150 : 110, type: 'sawtooth', voices: 2, spread: 14, vol: 0.06, a, dur: 1.2, r: 0.2, lp: 560, vib: 35, vibRate: 18, vibDelay: 0 })
        this.bubbles(d, run, 14, 1.3, 0.06, 280, 700)
        break
      }
      case 'airstrike': {
        // Propeller squadron passing overhead, left to right, with a Doppler drop.
        const d = fx(0.3, { pan: -0.8, panTo: 0.8, panT: 1.2 })
        this.osc(d, t, { f: 112, f2: 80, glide: 1.2, type: 'sawtooth', voices: 3, spread: 25, vol: 0.13, a: 0.8, dur: 1.1, r: 0.3, lp: 300, lp2: 2400, lpT: 0.85, drive: 1.5, trem: 0.6, tremRate: 28 })
        this.noise(d, t, { color: 'pink', filter: 'bandpass', f: 400, f2: 2400, fT: 0.9, vol: 0.25, a: 0.8, dur: 1.1, r: 0.3 })
        this.osc(d, t + 0.25, { f: 1800, f2: 700, glide: 0.9, vol: 0.045, a: 0.3, dur: 0.85, r: 0.1 })
        break
      }
      case 'charge': {
        // Cut-in: a riser that snaps into a hit just as the portrait lands.
        this.duck(0.35, 1.2, 0.8)
        const d = fx(0.35)
        this.osc(d, t, { f: midi(38), f2: midi(62), glide: 1.1, type: 'sawtooth', voices: 5, spread: 30, width: 0.8, vol: 0.11, a: 0.9, dur: 1.1, r: 0.03, lp: 400, lp2: 6000, lpT: 1.1 })
        this.noise(d, t, { filter: 'highpass', f: 800, f2: 8000, fT: 1.1, vol: 0.2, a: 1, dur: 1.1, r: 0.02, width: 0.7 })
        this.noise(d, t, { color: 'brown', f: 160, vol: 0.28, a: 0.7, dur: 1.1, r: 0.03 })
        const hit = t + 1.12
        this.osc(d, hit, { f: 110, f2: 35, glide: 0.3, vol: 0.95, dur: 0.6, d: 0.24, drive: 2 })
        this.noise(d, hit, { color: 'brown', f: 5000, f2: 200, vol: 0.75, dur: 0.7, d: 0.2 })
        this.brass(d, hit, [50, 57, 62, 69], 0.5, 0.05, 4000)
        this.cymbal(d, hit, 0.22, 1.4)
        break
      }
      case 'menace': {
        // The enemy's cut-in: a sinking, dissonant swell that lands on a hostile hit.
        this.duck(0.3, 1.2, 0.8)
        const d = fx(0.4)
        for (const [from, to] of [[62, 38], [63, 39]])
          this.osc(d, t, { f: midi(from), f2: midi(to), glide: 1.1, type: 'sawtooth', voices: 3, spread: 30, width: 0.8, vol: 0.075, a: 0.8, dur: 1.1, r: 0.03, lp: 700, lp2: 3800, lpT: 1.1, q: 2 })
        this.noise(d, t, { filter: 'bandpass', f: 400, f2: 3500, fT: 1.1, q: 1.5, vol: 0.28, a: 1, dur: 1.1, r: 0.02, width: 0.7 })
        this.noise(d, t, { color: 'brown', f: 160, vol: 0.3, a: 0.8, dur: 1.1, r: 0.03, trem: 0.6, tremRate: 7 })
        const hit = t + 1.12
        this.noise(d, hit, { filter: 'highpass', f: 1600, vol: 0.7, dur: 0.01, d: 0.005, drive: 5 })
        this.noise(d, hit, { color: 'pink', f: 8000, f2: 300, fT: 0.4, vol: 1, dur: 0.4, d: 0.12, drive: 3 })
        this.noise(d, hit, { color: 'brown', f: 220, vol: 1.1, dur: 0.5, d: 0.2, drive: 1.5 })
        this.brass(d, hit, [38, 44, 45, 50, 56], 0.7, 0.05, 3000)
        this.cymbal(d, hit, 0.2, 1.6)
        break
      }
      case 'ultcharge': {
        // The all-fleet barrage's cut-in: a longer, wider riser under a timpani roll,
        // landing on a full orchestral hit (dissonant and sinking for the enemy's).
        const len = clamp(opt.dur ?? 1.1, 0.3, 2)
        this.duck(0.25, len + 1.4, 1)
        const d = fx(0.45)
        const [lo, hi] = far ? [62, 38] : [33, 69]
        for (const shift of [0, 7, 12])
          this.osc(d, t, { f: midi(lo + shift), f2: midi(hi + shift), glide: len, type: 'sawtooth', voices: 4, spread: 28, width: 0.9, vol: 0.06, a: len * 0.85, dur: len, r: 0.03, lp: 400, lp2: 7000, lpT: len })
        this.noise(d, t, { filter: 'highpass', f: 600, f2: 9000, fT: len, vol: 0.24, a: len * 0.95, dur: len, r: 0.02, width: 0.8 })
        this.noise(d, t, { color: 'brown', f: 180, vol: 0.34, a: len * 0.7, dur: len, r: 0.03, trem: 0.5, tremRate: 9 })
        for (let i = 0; i < 18; i++) this.timpani(d, t + len * (1 - Math.pow(1 - i / 18, 1.4)) * 0.95, far ? 38 : 33, 0.05 + 0.18 * (i / 18))
        const hit = t + len + 0.02
        this.osc(d, hit, { f: 120, f2: 30, glide: 0.4, vol: 1, dur: 0.9, d: 0.35, drive: 2.2 })
        this.noise(d, hit, { filter: 'highpass', f: 1800, vol: 0.8, dur: 0.012, d: 0.005, drive: 5 })
        this.noise(d, hit, { color: 'brown', f: 6000, f2: 160, vol: 0.85, dur: 1, d: 0.3 })
        this.brass(d, hit, far ? [38, 44, 45, 50, 56, 57] : [45, 52, 57, 61, 64, 69], 1.6, 0.05, 4500)
        this.timpani(d, hit, far ? 38 : 33, 0.5)
        this.cymbal(d, hit, 0.28, 2.2)
        if (!far) {
          const sides = [-0.6, 0.6].map((p) => this.out(this.sfxBus!, { pan: p, send: 0.55, vol: level }))
          ;[81, 85, 88, 93, 97, 100].forEach((n, i) => this.bell(sides[i % 2], hit + 0.05 + i * 0.05, n, 0.05, 0.6))
        }
        break
      }
      case 'ultboom': {
        // The barrage's last shells land together: the sea itself goes up, a chain of
        // detonations rolls out to both sides, and the fanfare (or the dirge) rises over it.
        this.duck(0.15, 2.2, 1.6)
        this.explode(fx(0.08, { vol: 1.15 }), t, { kind: 'barrage', far })
        const d = fx(0.55, { echo: 0.5 })
        const fan = t + 0.5
        if (far) {
          this.brass(d, fan, [38, 41, 44, 50], 1.8, 0.05, 2600)
          this.osc(d, fan, { f: 72, f2: 40, glide: 2, type: 'sawtooth', voices: 3, spread: 22, vol: 0.1, a: 0.4, dur: 2, d: 1, r: 0.5, lp: 380, q: 3 })
        } else {
          this.brass(d, fan, [57, 64, 69], 0.22, 0.045, 4200)
          this.brass(d, fan + 0.24, [60, 67, 72], 0.22, 0.045, 4200)
          this.brass(d, fan + 0.48, [62, 69, 74, 78], 1.8, 0.055, 5000)
          this.timpani(d, fan + 0.48, 38, 0.6)
          this.cymbal(d, fan + 0.48, 0.25, 2.4)
          const sides = [-0.7, 0.7].map((p) => this.out(this.sfxBus!, { pan: p, send: 0.6, vol: level }))
          ;[86, 90, 93, 98, 102, 105, 110].forEach((n, i) => this.bell(sides[i % 2], fan + 0.5 + i * 0.06, n, 0.045, 0.7))
        }
        break
      }
      case 'order': {
        // Our attack cut-in: an air swipe with the band, and a short bright brass call
        // on a snare accent. Skills and torpedoes (pitch 1) sit a step higher.
        const d = this.out(this.sfxBus!, { pan: -0.5, panTo: 0.3, panT: 0.25, send: 0.3, vol: level })
        this.noise(d, t, { color: 'pink', filter: 'bandpass', f: 600, f2: 4500, fT: 0.16, q: 1.2, vol: 0.38, a: 0.12, dur: 0.16, r: 0.05 })
        const s = t + 0.13
        const up = p ? 2 : 0
        this.brass(d, s, [55 + up, 62 + up, 67 + up, 71 + up], 0.24, 0.045, 4500)
        this.noise(d, s, { filter: 'bandpass', f: 2300, q: 0.7, vol: 0.24, dur: 0.1, d: 0.045 })
        this.noise(d, s, { filter: 'highpass', f: 7000, vol: 0.08, dur: 0.3, d: 0.1, width: 0.6 })
        break
      }
      case 'move': {
        const d = fx(0.2)
        this.noise(d, t, { color: 'brown', f: 260, vol: 0.4, a: 0.15, dur: 0.6, r: 0.25, trem: 0.5, tremRate: 9 })
        this.noise(d, t + 0.05, { color: 'pink', filter: 'bandpass', f: 500, f2: 1500, q: 0.6, vol: 0.24, a: 0.2, dur: 0.7, d: 0.35, width: 0.5 })
        break
      }
      case 'dive': {
        const d = fx(0.35)
        this.noise(d, t, { filter: 'highpass', f: 2000, f2: 800, vol: 0.15, dur: 0.5, d: 0.3 })
        this.bubbles(d, t, 16, 0.9, 0.08, 250, 700)
        this.osc(d, t, { f: 70, f2: 50, glide: 0.9, type: 'sawtooth', vol: 0.07, a: 0.2, dur: 0.9, r: 0.3, lp: 300 })
        this.osc(this.out(this.sfxBus!, { pan, send: 0.7, vol: level }), t + 0.5, { f: 700, vol: 0.05, dur: 0.6, d: 0.3 })
        break
      }
      case 'reveal': {
        const d = fx(0.3)
        for (const at of [0, 0.07, 0.14]) this.osc(d, t + at, { f: 1760, type: 'square', vol: 0.035, dur: 0.03, d: 0.012, lp: 4000 })
        this.bell(d, t + 0.22, 86, 0.07, 0.4)
        this.bell(d, t + 0.29, 93, 0.07, 0.6)
        break
      }

      // ---- battle flow ----
      case 'alarm': {
        // General quarters klaxon, rasping through the ship's speakers.
        const d = fx(0.4, { echo: 0.2 })
        for (const at of [0, 0.5]) {
          this.osc(d, t + at, { f: 260, f2: 480, glide: 0.12, type: 'sawtooth', voices: 2, spread: 10, vol: 0.1, a: 0.02, dur: 0.38, r: 0.05, lp: 2200, q: 4, hp: 300, drive: 3 })
          this.osc(d, t + at, { f: 520, f2: 960, glide: 0.12, type: 'square', vol: 0.025, a: 0.02, dur: 0.38, r: 0.05, lp: 2600 })
        }
        break
      }
      case 'bosun': {
        // Boatswain's call: all hands. A rising whistle, a held warble, then the fall.
        const d = this.out(this.sfxBus!, { pan: -0.15, send: 0.5, vol: level })
        this.osc(d, t, { f: 1200, f2: 2250, glide: 0.3, vol: 0.1, a: 0.05, dur: 0.95, r: 0.03, vib: 45, vibRate: 14, vibDelay: 0.4 })
        this.osc(d, t, { f: 2400, f2: 4500, glide: 0.3, type: 'triangle', vol: 0.008, a: 0.05, dur: 0.95, r: 0.03 })
        this.osc(d, t + 0.97, { f: 2250, f2: 1300, glide: 0.2, vol: 0.095, a: 0.01, dur: 0.22, r: 0.04 })
        this.noise(d, t, { filter: 'bandpass', f: 2200, q: 3, vol: 0.02, a: 0.05, dur: 1.15, r: 0.04 })
        break
      }
      case 'warn': {
        // Enemy recon has found us: a falling two-note ping over an uneasy low swell.
        const d = fx(0.4)
        this.fm(d, t, { f: midi(81), ratio: 2, index: 1, index2: 0.2, indexT: 0.1, vol: 0.18, dur: 0.12, d: 0.07 })
        this.fm(d, t + 0.15, { f: midi(75), ratio: 2, index: 1, index2: 0.1, indexT: 0.3, vol: 0.18, dur: 0.5, d: 0.2, r: 0.1 })
        for (const n of [45, 51])
          this.osc(d, t, { f: midi(n), type: 'sawtooth', voices: 2, spread: 14, vol: 0.06, a: 0.08, dur: 0.6, d: 0.4, s: 0.4, r: 0.2, lp: 500, lp2: 2200, lpT: 0.2 })
        break
      }
      case 'alert': {
        // The enemy's attack cut-in. The red band slams in, a dissonant low-brass stab,
        // and a piercing tritone warble like their fire control locking on.
        this.duck(0.45, 0.6, 0.6)
        const d = fx(0.3)
        this.noise(d, t, { color: 'pink', filter: 'bandpass', f: 4000, f2: 700, fT: 0.2, q: 1.5, vol: 0.3, dur: 0.2, d: 0.08, width: 0.6 })
        this.noise(d, t, { filter: 'highpass', f: 1500, vol: 0.55, dur: 0.012, d: 0.005, drive: 4 })
        this.noise(d, t, { color: 'brown', f: 380, vol: 0.9, dur: 0.22, d: 0.08, drive: 2 })
        for (const [n, v] of [[40, 0.075], [46, 0.06], [47, 0.055], [52, 0.05]])
          this.osc(d, t, { f: midi(n), type: 'sawtooth', voices: 2, spread: 16, width: 0.5, vol: v, a: 0.008, dur: 0.45, d: 0.3, s: 0.35, r: 0.15, lp: 3400, lp2: 650, lpT: 0.35, q: 1.5, drive: 1.5 })
        const w = this.out(this.sfxBus!, { send: 0.25, vol: level })
        for (let i = 0; i < 6; i++)
          this.osc(w, t + 0.05 + i * 0.085, { f: i % 2 ? 1480 : 1047, type: 'square', vol: 0.045 * (1 - i * 0.08), dur: 0.06, d: 0.05, s: 0.6, r: 0.01, lp: 3600 })
        break
      }
      case 'bell': {
        // Ship's bell marks a new turn.
        const d = fx(0.5)
        for (const at of [0, 0.24]) {
          this.fm(d, t + at, { f: midi(81), ratio: 2.4, index: 2.4, index2: 0.2, indexT: 0.6, vol: 0.1, dur: 1.4, d: 0.5, r: 0.3 })
          this.osc(d, t + at, { f: midi(69), vol: 0.04, dur: 1.2, d: 0.6 })
        }
        break
      }
      case 'sunk': {
        // Enemy sunk: brass hit, timpani and gong.
        this.duck(0.4, 1, 1.2)
        const d = fx(0.45)
        this.brass(d, t, [50, 57, 62, 66, 69], 0.8, 0.045, 3800)
        this.timpani(d, t, 38, 0.6)
        this.timpani(d, t + 0.18, 45, 0.5)
        this.fm(d, t, { f: 98, ratio: 1.414, index: 5, index2: 0.5, indexT: 1.2, vol: 0.1, dur: 2.2, d: 0.9, r: 0.5 })
        this.cymbal(d, t, 0.2, 1.8)
        break
      }
      case 'shellshock': {
        // One of ours sunk: everything goes dull, a ringing ear, a heartbeat.
        this.shock(2.2)
        this.duck(0.2, 1.2, 1.5)
        const d = this.out(this.sfxBus!, { send: 0.1, vol: level })
        this.osc(d, t, { f: 3900, vol: 0.018, a: 0.08, dur: 1.5, d: 0.9, r: 0.4 })
        for (const at of [0.25, 0.55, 1.2, 1.5]) this.osc(d, t + at, { f: 62, f2: 44, glide: 0.1, vol: 0.45, dur: 0.18, d: 0.07 })
        break
      }

      // ---- rewards ----
      case 'combo': {
        const d = fx(0.3)
        const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]
        const base = 72 + scale[Math.min(p, 10)]
        ;[0, 4, 7, 12].forEach((n, i) => this.bell(d, t + i * 0.045, base + n, i === 3 ? 0.09 : 0.06, i === 3 ? 0.6 : 0.2))
        this.osc(d, t, { f: midi(base - 12), type: 'sawtooth', voices: 3, spread: 16, vol: 0.05, dur: 0.3, d: 0.12, lp: 4000, lp2: 1200 })
        break
      }
      case 'coin': {
        const d = this.out(this.uiBus!, { pan: pan + rnd(-0.2, 0.2), send: 0.2, vol: level })
        this.fm(d, t, { f: midi(83 + p), ratio: 2, index: 1.5, vol: 0.13, dur: 0.07, d: 0.03 })
        this.fm(d, t + 0.065, { f: midi(88 + p), ratio: 2, index: 1.5, index2: 0.1, indexT: 0.3, vol: 0.16, dur: 0.5, d: 0.16, r: 0.1 })
        this.fm(d, t + 0.065, { f: midi(88 + p), ratio: 3.7, index: 0.8, vol: 0.025, dur: 0.4, d: 0.1 })
        break
      }
      case 'gem': {
        const sides = [-0.4, 0.4].map((s) => this.out(this.uiBus!, { pan: s + pan, send: 0.45, vol: level }))
        ;[0, 7, 12, 16].forEach((n, i) => this.fm(sides[i % 2], t + i * 0.05, { f: midi(88 + n + p), ratio: 4.2, index: 0.6, index2: 0.04, indexT: 0.3, vol: 0.09, dur: 0.8, d: 0.3, r: 0.2 }))
        if (this.copies > 1) break
        this.noise(sides[0], t, { filter: 'highpass', f: 8000, vol: 0.08, dur: 0.4, d: 0.15, width: 0.7 })
        break
      }
      case 'star': {
        const d = fx(0.4)
        this.fm(d, t, { f: midi(84 + p), ratio: 2, index: 1.2, index2: 0.08, indexT: 0.5, vol: 0.13, dur: 1, d: 0.35, r: 0.2 })
        this.fm(d, t, { f: midi(96 + p), ratio: 3, index: 0.5, vol: 0.05, dur: 0.8, d: 0.25 })
        this.noise(d, t, { filter: 'highpass', f: 7000, vol: 0.1, dur: 0.35, d: 0.12, width: 0.6 })
        this.osc(d, t, { f: 90, f2: 50, glide: 0.1, vol: 0.3, dur: 0.2, d: 0.06 })
        break
      }
      case 'heart': {
        const d = ui(0.3)
        const k = vary(0.02)
        this.fm(d, t, { f: midi(88) * k, ratio: 1, index: 0.6, vol: 0.1, dur: 0.15, d: 0.06 })
        this.fm(d, t + 0.08, { f: midi(93) * k, ratio: 1, index: 0.6, vol: 0.1, dur: 0.35, d: 0.12, r: 0.1 })
        this.osc(d, t, { f: midi(64) * k, vol: 0.05, dur: 0.2, d: 0.08 })
        break
      }
      case 'stamp': {
        const d = fx(0.2)
        this.osc(d, t, { f: 95, f2: 45, glide: 0.12, vol: 0.9, dur: 0.35, d: 0.12, drive: 2 })
        this.noise(d, t, { color: 'brown', f: 1800, f2: 200, vol: 0.7, dur: 0.15, d: 0.06 })
        this.noise(d, t, { color: 'pink', filter: 'bandpass', f: 900, q: 1.5, vol: 0.25, dur: 0.05, d: 0.02 })
        this.osc(d, t, { f: 220, f2: 160, type: 'triangle', vol: 0.15, dur: 0.08, d: 0.03 })
        break
      }
      case 'levelup': {
        this.duck(0.45, 1, 1)
        ;[60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.bell(this.out(this.sfxBus!, { pan: -0.6 + i * 0.2, send: 0.4, vol: level }), t + i * 0.055, n + 12, 0.06, 0.3))
        const d = fx(0.4)
        this.brass(d, t + 0.42, [60, 64, 67, 72], 1, 0.04, 3500)
        this.osc(d, t + 0.42, { f: 65, f2: 45, glide: 0.2, vol: 0.5, dur: 0.4, d: 0.15 })
        this.cymbal(d, t + 0.42, 0.16, 1.2)
        this.noise(d, t + 0.4, { filter: 'highpass', f: 7000, vol: 0.1, a: 0.3, dur: 1, d: 0.5, width: 0.8 })
        break
      }
      case 'roll': {
        // Drum roll into a reveal: accelerating snare over a rising swell.
        const d = fx(0.3)
        for (let i = 0; i < 26; i++) {
          const at = t + 1.55 * (1 - Math.pow(1 - i / 26, 1.5))
          const v = 0.06 + 0.2 * (i / 26)
          this.noise(d, at, { filter: 'bandpass', f: 2300, q: 0.7, vol: v, dur: 0.08, d: 0.04 })
          this.osc(d, at, { f: 190, type: 'triangle', vol: v * 0.4, dur: 0.05, d: 0.02 })
        }
        this.osc(d, t, { f: 110, f2: 440, glide: 1.6, type: 'sawtooth', voices: 3, spread: 20, width: 0.6, vol: 0.06, a: 1.2, dur: 1.6, r: 0.05, lp: 400, lp2: 3000 })
        this.noise(d, t, { filter: 'highpass', f: 1000, f2: 7000, fT: 1.6, vol: 0.14, a: 1.4, dur: 1.6, r: 0.03, width: 0.6 })
        this.noise(d, t, { color: 'brown', f: 200, vol: 0.25, a: 1.2, dur: 1.6, r: 0.05 })
        break
      }
      case 'rare': {
        const d = fx(0.45)
        ;[76, 80, 83, 88].forEach((n, i) => this.bell(d, t + i * 0.025, n, 0.07, 0.8))
        if (this.copies > 1) break
        this.osc(d, t, { f: midi(64), type: 'sawtooth', voices: 4, spread: 18, width: 0.8, vol: 0.05, a: 0.05, dur: 0.6, d: 0.4, s: 0.3, r: 0.3, lp: 1200, lp2: 3000 })
        this.noise(d, t, { filter: 'highpass', f: 6000, vol: 0.14, dur: 0.6, d: 0.25, width: 0.7 })
        break
      }
      case 'ssr': {
        this.duck(0.2, 1.6, 1.6)
        const d = fx(0.5)
        this.osc(d, t, { f: 60, f2: 30, glide: 0.8, vol: 0.95, dur: 1.4, d: 0.5, drive: 1.5 })
        this.noise(d, t, { color: 'brown', f: 3000, f2: 100, vol: 0.75, dur: 1.5, d: 0.45 })
        this.cymbal(d, t, 0.28, 2.4)
        const sides = [-0.6, 0.6].map((p) => this.out(this.sfxBus!, { pan: p, send: 0.55, vol: level }))
        ;[72, 76, 79, 84, 88, 91, 96, 100].forEach((n, i) => this.bell(sides[i % 2], t + i * 0.045, n, 0.06, 0.5))
        for (const n of [60, 67, 72, 76, 79])
          this.osc(d, t + 0.05, { f: midi(n), type: 'sawtooth', voices: 3, spread: 22, width: 0.9, vol: 0.035, a: 0.25, dur: 1.8, d: 1, s: 0.6, r: 0.8, lp: 800, lp2: 2800, lpT: 1 })
        for (let i = 0; i < 8; i++) this.bell(sides[i % 2], t + 0.4 + (i / 8) * 1.6 + Math.random() * 0.1, 96 + [0, 2, 4, 7, 9, 12][Math.floor(Math.random() * 6)], 0.022, 0.25)
        break
      }
      case 'stepup': {
        // Construction's step-up: a hammer blow on the hull, ringing higher the hotter the orb (pitch = its level).
        const lv = clamp(p, 0, 4)
        const d = fx(0.4)
        this.osc(d, t, { f: 85 + lv * 12, f2: 40, glide: 0.15, vol: 0.75, dur: 0.32, d: 0.1, drive: 1.6 })
        this.noise(d, t, { color: 'pink', filter: 'bandpass', f: 1600 + lv * 300, q: 1.2, vol: 0.4, dur: 0.06, d: 0.02 })
        this.fm(d, t, { f: midi(48 + lv * 4), ratio: 1.41, index: 3, index2: 0.2, indexT: 0.3, vol: 0.07, dur: 0.6, d: 0.2 })
        const root = [60, 64, 67, 72, 76][lv]
        ;[0, 7, 12].forEach((n, i) => this.bell(d, t + 0.02 + i * 0.03, root + n + 12, 0.045 + lv * 0.01, 0.4))
        break
      }
      case 'thunder': {
        // A lightning omen: the crack right overhead, then the roll across the sky.
        this.duck(0.4, 0.8, 1)
        const d = fx(0.5, { echo: 0.4 })
        this.noise(d, t, { filter: 'highpass', f: 2000, vol: 0.8, dur: 0.015, d: 0.006, drive: 5 })
        this.crackle(d, t, 30, 0.25, 0.5, 1500, 7000)
        this.noise(d, t, { color: 'pink', f: 6000, f2: 400, fT: 0.4, vol: 0.7, dur: 0.5, d: 0.15, drive: 2 })
        this.noise(d, t + 0.05, { color: 'brown', f: 300, f2: 90, fT: 1.6, vol: 0.9, a: 0.1, dur: 1.8, d: 0.8, r: 0.6, trem: 0.4, tremRate: 6 })
        break
      }
      case 'shatter': {
        // The screen breaking open: a crack, then a shower of glass.
        this.duck(0.3, 0.6, 1)
        const d = fx(0.45)
        this.noise(d, t, { filter: 'highpass', f: 3000, vol: 0.9, dur: 0.02, d: 0.008, drive: 4 })
        this.osc(d, t, { f: 95, f2: 38, glide: 0.2, vol: 0.85, dur: 0.45, d: 0.15, drive: 2 })
        this.noise(d, t, { filter: 'highpass', f: 4500, vol: 0.4, dur: 0.7, d: 0.2, width: 0.8 })
        const sides = [-0.6, 0.6].map((s) => this.out(this.sfxBus!, { pan: s, send: 0.4, vol: level }))
        for (let i = 0; i < 24; i++)
          this.fm(sides[i % 2], t + Math.pow(Math.random(), 1.5) * 0.8, { f: rnd(2500, 7000), ratio: 2.76, index: 1.5, index2: 0.1, indexT: 0.1, vol: rnd(0.02, 0.06), dur: 0.2, d: 0.05 })
        break
      }
      case 'heartbeat': {
        // Suspense before a top-rarity card turns over.
        const d = fx(0.15)
        for (const [at, v] of [[0, 1], [0.17, 0.7]]) {
          this.osc(d, t + at, { f: 64, f2: 38, glide: 0.1, vol: 0.9 * v, dur: 0.22, d: 0.07, drive: 1.3 })
          this.noise(d, t + at, { color: 'brown', f: 300, vol: 0.4 * v, dur: 0.08, d: 0.03 })
        }
        break
      }
      case 'jackpot': {
        // A top-rarity ship arrives: impact, a ta-ta-ta-taaa fanfare and a cascade of coins.
        // size 2 is UR: a tone higher, longer, with a choir swelling under it.
        const ur = (opt.size ?? 1) >= 2
        const k = ur ? 2 : 0
        this.duck(0.12, ur ? 3.6 : 2.8, 2)
        const d = fx(0.5)
        this.osc(d, t, { f: 110, f2: 30, glide: 0.5, vol: 1, dur: 1, d: 0.35, drive: 2.2 })
        this.noise(d, t, { filter: 'highpass', f: 1800, vol: 0.8, dur: 0.012, d: 0.005, drive: 5 })
        this.noise(d, t, { color: 'brown', f: 6000, f2: 160, vol: 0.8, dur: 1, d: 0.3 })
        this.timpani(d, t, 38 + k, 0.6)
        this.cymbal(d, t, 0.3, 2.6)
        for (const [at, ns] of [[0.12, [62, 69]], [0.27, [62, 69]], [0.42, [64, 71]]] as const) {
          this.brass(d, t + at, ns.map((n) => n + k), 0.13, 0.045, 4400)
          this.noise(d, t + at, { filter: 'bandpass', f: 2300, q: 0.7, vol: 0.2, dur: 0.1, d: 0.05 })
        }
        const big = t + 0.58
        this.brass(d, big, [50, 62, 66, 69, 74, 78].map((n) => n + k), ur ? 2.8 : 2.2, 0.05, 5400)
        this.timpani(d, big, 38 + k, 0.7)
        this.cymbal(d, big, 0.28, 3)
        const sides = [-0.7, 0.7].map((s) => this.out(this.sfxBus!, { pan: s, send: 0.6, vol: level }))
        ;[86, 90, 93, 98, 102, 105, 110].forEach((n, i) => this.bell(sides[i % 2], big + 0.04 + i * 0.05, n + k, 0.05, 0.7))
        for (let i = 0; i < (ur ? 40 : 26); i++)
          this.fm(sides[i % 2], big + 0.3 + i * 0.055 + rnd(0, 0.03), { f: midi(pick([88, 91, 93, 95, 98, 100]) + k), ratio: 2, index: 1.2, index2: 0.1, indexT: 0.2, vol: 0.035, dur: 0.3, d: 0.1 })
        if (ur)
          for (const n of [62, 69, 74, 78, 81])
            this.osc(d, big + 0.2, { f: midi(n + k), type: 'sawtooth', voices: 4, spread: 26, width: 0.9, vol: 0.03, a: 0.6, dur: 2.6, d: 1.5, s: 0.7, r: 1, lp: 1400, q: 0.8, vib: 18, vibRate: 5 })
        break
      }
      case 'start': {
        // Title: a short regal sting as the game opens.
        this.duck(0.3, 1.2, 1.2)
        const d = fx(0.5)
        this.brass(d, t, [57], 0.12, 0.05, 2800)
        this.brass(d, t + 0.14, [50, 57, 62, 66, 69], 1.2, 0.042, 3800)
        this.timpani(d, t + 0.14, 38, 0.7)
        this.cymbal(d, t + 0.14, 0.24, 2)
        ;[86, 90, 93, 98, 102].forEach((n, i) => this.bell(d, t + 0.2 + i * 0.05, n, 0.045, 0.5))
        break
      }
      case 'chest': {
        const d = fx(0.35)
        this.osc(d, t, { f: 90, f2: 140, glide: 0.22, type: 'sawtooth', vol: 0.06, a: 0.04, dur: 0.22, r: 0.03, lp: 700, q: 6, trem: 0.7, tremRate: 35 })
        this.osc(d, t + 0.22, { f: 160, f2: 90, glide: 0.06, vol: 0.4, dur: 0.12, d: 0.05 })
        this.noise(d, t + 0.22, { filter: 'bandpass', f: 1500, q: 2, vol: 0.3, dur: 0.04, d: 0.015 })
        ;[84, 88, 91, 96].forEach((n, i) => this.bell(d, t + 0.3 + i * 0.05, n, 0.06, 0.4))
        this.noise(d, t + 0.3, { filter: 'highpass', f: 7000, vol: 0.12, dur: 0.6, d: 0.25, width: 0.6 })
        break
      }
      case 'victory': {
        this.fadeMusic(0.35)
        const d = fx(0.45)
        const seq: [number, number, number][] = [
          [67, 0, 0.14],
          [67, 0.15, 0.14],
          [67, 0.3, 0.14],
          [72, 0.45, 0.6],
          [68, 1.05, 0.4],
          [70, 1.45, 0.4],
          [72, 1.85, 0.25],
          [70, 2.1, 0.12],
          [72, 2.25, 1.6],
        ]
        for (const [n, at, len] of seq) {
          this.brass(d, t + at, [n, n - 12], len, 0.045, 3600)
          if (at < 0.4) this.noise(d, t + at, { filter: 'bandpass', f: 2300, q: 0.7, vol: 0.18, dur: 0.1, d: 0.05 })
        }
        const pads: [number, number[], number, number][] = [
          [0.45, [48, 55, 60, 64], 0.6, 36],
          [1.05, [44, 51, 56, 60], 0.4, 32],
          [1.45, [46, 53, 58, 62], 0.4, 34],
          [2.25, [48, 55, 60, 64, 67], 1.8, 36],
        ]
        for (const [at, notes, len, root] of pads) {
          this.brass(d, t + at, notes, len, 0.022, 2200)
          this.timpani(d, t + at, root + 12, 0.55)
        }
        this.cymbal(d, t + 2.25, 0.3, 2.6)
        ;[84, 88, 91, 96, 100, 103].forEach((n, i) => this.bell(d, t + 2.25 + i * 0.05, n, 0.045, 0.6))
        break
      }
      case 'defeat': {
        this.fadeMusic(0.6)
        const d = fx(0.55)
        ;[67, 66, 65, 64].forEach((n, i) => this.brass(d, t + i * 0.42, [n, n - 12], 0.5, 0.035, 1100))
        this.brass(d, t + 1.7, [40, 46, 52, 55], 2.4, 0.03, 900)
        this.timpani(d, t + 1.7, 40, 0.5)
        this.noise(d, t + 1.7, { color: 'brown', f: 220, vol: 0.3, a: 0.2, dur: 2, d: 1, r: 0.6 })
        for (const at of [1.7, 3]) this.fm(d, t + at, { f: midi(57), ratio: 1.41, index: 2, index2: 0.3, indexT: 1.5, vol: 0.08, dur: 2, d: 0.9, r: 0.4 })
        break
      }
    }
    this.release()
  }

  // ---------------- music ----------------

  /** Switches the background music with a crossfade; null fades it out. */
  music(track: Track | null) {
    if (this.track === track) return
    this.track = track
    this.fadeOut(this.ctx ? 0.9 : 0)
    if (!track || !this.ctx) return // started on unlock()
    if (isFileTrack(track)) return this.playRecording(pick(FILES[track]))
    const song = SONGS[track]
    this.song = song
    this.ch = this.channels(song)
    this.step = 0
    this.nextTime = this.ctx.currentTime + 0.12
    this.ch.out.gain.setValueAtTime(0, this.ctx.currentTime)
    this.ch.out.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.6)
    this.seqTimer = window.setInterval(() => this.schedule(), 25)
    this.schedule()
  }

  /** Fades the current music out; the next music() call starts fresh. */
  private fadeMusic(sec: number) {
    this.track = null
    this.fadeOut(sec)
  }

  private fadeOut(sec: number) {
    if (this.seqTimer) clearInterval(this.seqTimer)
    this.seqTimer = undefined
    const rec = this.recording
    this.recording = undefined
    if (rec && this.ctx) {
      const t = this.ctx.currentTime
      rec.out.gain.cancelScheduledValues(t)
      rec.out.gain.setValueAtTime(rec.out.gain.value, t)
      rec.out.gain.linearRampToValueAtTime(0, t + Math.max(sec, 0.02))
      window.setTimeout(() => {
        rec.src?.stop()
        rec.out.disconnect()
      }, (sec + 0.1) * 1000)
    }
    const ch = this.ch
    this.ch = undefined
    if (!ch || !this.ctx) return
    const t = this.ctx.currentTime
    ch.out.gain.cancelScheduledValues(t)
    ch.out.gain.setValueAtTime(ch.out.gain.value, t)
    ch.out.gain.linearRampToValueAtTime(0, t + Math.max(sec, 0.02))
    window.setTimeout(() => ch.nodes.forEach((n) => n.disconnect()), (sec + 3) * 1000)
  }

  private loadRecording(url: string) {
    let buf = this.recordings.get(url)
    if (!buf) {
      buf = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((data) => this.ctx!.decodeAudioData(data))
        .catch(() => {
          this.recordings.delete(url) // try again next time
          return null
        })
      this.recordings.set(url, buf)
    }
    return buf
  }

  /** Loops a recording, fading it in once it has loaded (unless the music moved on meanwhile). */
  private playRecording(url: string) {
    const ctx = this.ctx!
    const out = ctx.createGain()
    out.gain.value = 0
    out.connect(this.musicBus!)
    const rec: { out: GainNode; src?: AudioBufferSourceNode } = { out }
    this.recording = rec
    void this.loadRecording(url).then((buf) => {
      if (!buf || this.recording !== rec) return
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      src.connect(out)
      const t = ctx.currentTime
      out.gain.setValueAtTime(0, t)
      out.gain.linearRampToValueAtTime(RECORDING_LEVEL, t + 0.6)
      src.start(t)
      rec.src = src
    })
  }

  /** Mixer strips for one song: each instrument has its own level, placement, delay and reverb sends. */
  private channels(song: Song): Channels {
    const ctx = this.ctx!
    const nodes: AudioNode[] = []
    const out = ctx.createGain()
    out.connect(this.musicBus!)
    nodes.push(out)

    // Dotted-eighth echo, darkened in the feedback loop.
    const delay = ctx.createDelay(2)
    delay.delayTime.value = (60 / song.bpm) * 0.75
    const fb = ctx.createGain()
    fb.gain.value = 0.32
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 2600
    const wet = ctx.createGain()
    wet.gain.value = 0.35
    delay.connect(damp).connect(fb).connect(delay)
    damp.connect(wet).connect(out)
    nodes.push(delay, fb, damp, wet)

    const strip = (vol: number, pan: number, rev: number, echo = 0) => {
      const g = ctx.createGain()
      g.gain.value = vol
      const p = ctx.createStereoPanner()
      p.pan.value = pan
      g.connect(p).connect(out)
      const s = ctx.createGain()
      s.gain.value = rev
      p.connect(s).connect(this.reverbIn!)
      nodes.push(g, p, s)
      if (echo) {
        const e = ctx.createGain()
        e.gain.value = echo
        p.connect(e).connect(delay)
        nodes.push(e)
      }
      return g
    }
    return {
      out,
      nodes,
      pad: strip(song.padVol ?? 0.7, 0, 0.5),
      comp: strip(0.8, -0.15, 0.3, 0.15),
      bass: strip(1, 0, 0.05),
      arp: strip(0.6, 0.3, 0.3, 0.45),
      lead: strip(0.9, -0.05, 0.35, 0.3),
      drums: strip(0.9, 0, 0.12),
    }
  }

  private schedule() {
    const ctx = this.ctx
    const song = this.song
    const ch = this.ch
    if (!ctx || !song || !ch) return
    const stepDur = 60 / song.bpm / 4
    const bars = song.chords.length
    const total = bars * 16
    while (this.nextTime < ctx.currentTime + 0.2) {
      const s = this.step % total
      const bar = Math.floor(s / 16)
      const i = s % 16
      const t = this.nextTime + (i % 2 ? (song.swing ?? 0) * stepDur : 0)
      if (!this.muted && this.volume.bgm > 0) this.voiceStep(song, ch, s, bar, i, t, stepDur)
      this.nextTime += stepDur
      this.step++
    }
    this.groupEnd = 0
  }

  private voiceStep(song: Song, ch: Channels, s: number, bar: number, i: number, t: number, sd: number) {
    const chord = song.chords[bar]
    const root = chord[0]
    const barLen = sd * 16

    // Pad: one long chord per bar.
    if (i === 0 && song.pad) {
      const notes = chord.map((n) => n + 12)
      if (song.pad === 'warm') {
        for (const n of notes) this.osc(ch.pad, t, { f: midi(n), type: 'triangle', voices: 2, spread: 8, width: 0.7, vol: 0.05, a: 0.4, dur: barLen, r: 0.5, lp: 1800 })
      } else if (song.pad === 'choir') {
        for (const n of notes) {
          this.osc(ch.pad, t, { f: midi(n), type: 'sawtooth', voices: 3, spread: 16, width: 0.9, vol: 0.04, a: 0.35, dur: barLen, r: 0.4, lp: 1300, vib: 12, vibRate: 5 })
        }
      } else {
        for (const n of notes) this.osc(ch.pad, t, { f: midi(n), type: 'sawtooth', voices: 3, spread: 14, width: 0.9, vol: 0.03, a: 0.3, dur: barLen, r: 0.35, lp: 1400, vib: 8, vibRate: 4.5 })
      }
    }

    // Comping: chord hits.
    if (song.comp) {
      for (const [at, len] of song.comp.hits) {
        if (at !== i) continue
        const notes = chord.map((n) => n + (song.comp!.octave ?? 12))
        const dur = len * sd
        if (song.comp.kind === 'ep') {
          notes.forEach((n, k) => this.fm(ch.comp, t + k * 0.008, { f: midi(n), ratio: 1, index: 1.4, index2: 0.2, indexT: 0.3, vol: 0.035, dur, d: 0.5, s: 0.3, r: 0.15 }))
        } else if (song.comp.kind === 'stab') {
          for (const n of notes) this.osc(ch.comp, t, { f: midi(n - 12), type: 'sawtooth', voices: 2, spread: 18, width: 0.8, vol: 0.04, dur, d: 0.08, s: 0.2, r: 0.05, lp: 3200, lp2: 700, lpT: dur })
        } else {
          notes.forEach((n, k) => this.bell(ch.comp, t + k * 0.02, n, 0.02, dur))
        }
      }
    }

    // Bass.
    if (song.bass) {
      for (const [at, off, len] of song.bass.notes) {
        if (at !== i) continue
        const f = midi(root - 12 + off)
        const dur = len * sd * 0.92
        if (song.bass.kind === 'drive') {
          this.osc(ch.bass, t, { f, type: 'sawtooth', vol: 0.14, dur, d: 0.12, s: 0.5, r: 0.04, lp: 1600, lp2: 280, lpT: 0.12, q: 2 })
          if (i % 4 === 0) this.osc(ch.bass, t, { f: f / 2, vol: 0.18, dur: Math.max(dur, sd * 3), d: 0.2, s: 0.6, r: 0.04 })
        } else {
          this.osc(ch.bass, t, { f, type: 'triangle', vol: 0.2, dur, d: 0.4, s: 0.5, r: 0.08, lp: 900 })
          this.osc(ch.bass, t, { f: f / 2, vol: 0.14, dur, d: 0.4, s: 0.5, r: 0.08 })
        }
      }
    }

    // Arpeggio.
    if (song.arp) {
      const a = song.arp.order[i]
      if (a !== null) {
        const n = chord[a % chord.length] + 12 * Math.floor(a / chord.length) + song.arp.octave
        if (song.arp.kind === 'bell') this.bell(ch.arp, t, n, 0.028, 0.35)
        else this.osc(ch.arp, t, { f: midi(n), type: 'square', vol: 0.045, dur: sd * 0.9, d: 0.08, r: 0.03, lp: 3800, lp2: 900, lpT: 0.12 })
      }
    }

    // Lead.
    if (song.lead) {
      for (const [at, n, len] of song.lead.notes) {
        if (at !== s) continue
        const dur = len * sd * 0.95
        this.leadNote(ch.lead, song.lead.kind, t, n, dur)
      }
    }

    // Drums.
    const d = bar % 4 === 3 && song.fill ? song.fill : song.drums
    if (d) {
      const on = (p?: string) => p?.[i] === 'x'
      if (on(d.kick)) {
        this.osc(ch.drums, t, { f: 150, f2: 45, glide: 0.09, vol: 0.55, dur: 0.35, d: 0.14 })
        this.noise(ch.drums, t, { filter: 'highpass', f: 3000, vol: 0.06, dur: 0.008, d: 0.003 })
      }
      if (on(d.snare)) {
        this.noise(ch.drums, t, { filter: 'bandpass', f: 2400, q: 0.7, vol: 0.18, dur: 0.2, d: 0.07 })
        this.osc(ch.drums, t, { f: 190, f2: 160, glide: 0.05, type: 'triangle', vol: 0.12, dur: 0.1, d: 0.04 })
      }
      if (on(d.hat)) this.noise(ch.drums, t, { filter: 'highpass', f: 8000, vol: i % 4 === 0 ? 0.05 : 0.035, dur: 0.035, d: 0.012 })
      if (on(d.open)) this.noise(ch.drums, t, { filter: 'highpass', f: 7000, vol: 0.04, dur: 0.25, d: 0.1 })
      if (on(d.shaker)) this.noise(ch.drums, t, { filter: 'bandpass', f: 6500, q: 1.2, vol: i % 2 ? 0.012 : 0.02, a: 0.01, dur: 0.05, d: 0.02 })
      if (on(d.tom)) this.osc(ch.drums, t, { f: 120 - (i % 4) * 12, f2: 70, glide: 0.2, vol: 0.3, dur: 0.35, d: 0.14 })
    }
  }

  private leadNote(dest: AudioNode, kind: 'brass' | 'flute' | 'dark' | 'bell', t: number, n: number, dur: number, gain = 1) {
    const f = midi(n)
    if (kind === 'brass') {
      this.osc(dest, t, { f, type: 'sawtooth', voices: 2, spread: 9, vol: 0.06 * gain, a: 0.03, dur, d: 0.4, s: 0.7, r: 0.08, lp: 700, lp2: 2800, lpT: 0.08, q: 1.5, vib: 14, vibRate: 5.5, vibDelay: 0.18 })
    } else if (kind === 'dark') {
      this.osc(dest, t, { f, type: 'square', voices: 2, spread: 12, vol: 0.055 * gain, a: 0.02, dur, d: 0.3, s: 0.7, r: 0.08, lp: 2000, q: 2, vib: 18, vibRate: 6, vibDelay: 0.15 })
    } else if (kind === 'flute') {
      this.osc(dest, t, { f, type: 'sine', vol: 0.07 * gain, a: 0.05, dur, d: 0.5, s: 0.8, r: 0.12, vib: 16, vibRate: 5, vibDelay: 0.2 })
      this.osc(dest, t, { f: f * 2, type: 'triangle', vol: 0.012 * gain, a: 0.05, dur, d: 0.5, s: 0.7, r: 0.12 })
      this.noise(dest, t, { filter: 'bandpass', f: f * 2, q: 4, vol: 0.012 * gain, a: 0.04, dur: Math.min(dur, 0.15), r: 0.05 })
    } else {
      this.bell(dest, t, n, 0.05 * gain, dur)
    }
  }

  // ---------------- ambience ----------------

  /**
   * Weather sounds under the battle; null fades them out. There is no constant sea bed:
   * its endless filtered-noise hiss was reported as grating under the battle music.
   */
  setAmbience(kind: Ambience | null) {
    if (this.ambience === kind && this.ambOut) return
    this.ambience = kind
    this.stopAmbience()
    if (!kind || !this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const out = ctx.createGain()
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(1, t + 2.5)
    out.connect(this.ambBus!)
    this.ambOut = out
    this.ambNodes = [out]

    // Occasional events: thunder in a storm, a foghorn in fog, gulls on a clear day.
    const event = () => {
      if (!this.ctx || this.ambience !== kind || this.muted || this.volume.se === 0) return
      const at = this.ctx.currentTime + 0.05
      const d = this.out(out, { pan: rnd(-0.8, 0.8), send: kind === 'fog' ? 0.8 : 0.5 })
      if (kind === 'storm') {
        this.noise(d, at, { filter: 'highpass', f: 1500, vol: 0.25, dur: 0.08, d: 0.03, drive: 3 })
        this.noise(d, at + 0.05, { color: 'brown', f: 900, f2: 120, fT: 2, vol: 0.7, a: 0.08, dur: 3, d: 1.1, r: 0.8, trem: 0.5, tremRate: 3 })
      } else if (kind === 'fog') {
        this.osc(d, at, { f: 87, type: 'sawtooth', voices: 2, spread: 8, vol: 0.06, a: 0.3, dur: 2.2, r: 0.8, lp: 420, q: 2 })
        this.osc(d, at, { f: 130.5, type: 'sawtooth', vol: 0.025, a: 0.3, dur: 2.2, r: 0.8, lp: 420 })
      } else if (kind === 'clear') {
        for (let k = 0; k < 3; k++) {
          const f = rnd(1700, 2300)
          this.osc(d, at + k * 0.22, { f, f2: f * 0.7, glide: 0.18, type: 'triangle', vol: 0.012, a: 0.02, dur: 0.18, d: 0.08, vib: 60, vibRate: 22, vibDelay: 0 })
        }
      } else {
        this.bell(d, at, 81, 0.012, 1.2)
      }
      this.release()
    }
    const every = { clear: [14, 26], fog: [16, 28], storm: [7, 16], night: [20, 34] }[kind]
    const loop = () => {
      this.ambTimer = window.setTimeout(() => {
        event()
        loop()
      }, rnd(every[0], every[1]) * 1000)
    }
    loop()
  }

  private stopAmbience() {
    clearTimeout(this.ambTimer)
    this.ambTimer = undefined
    const out = this.ambOut
    const nodes = this.ambNodes
    this.ambOut = undefined
    this.ambNodes = []
    if (!out || !this.ctx) return
    const t = this.ctx.currentTime
    out.gain.cancelScheduledValues(t)
    out.gain.setValueAtTime(out.gain.value, t)
    out.gain.linearRampToValueAtTime(0, t + 1.2)
    window.setTimeout(() => {
      for (const n of nodes) {
        if (n instanceof AudioScheduledSourceNode) n.stop()
        n.disconnect()
      }
    }, 1500)
  }
}

/** Linear up to 0.8, then bends smoothly toward full scale (the shaper holds its end value beyond ±1). */
function softClip() {
  const curve = new Float32Array(2049)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    const a = Math.abs(x)
    const y = a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2)
    curve[i] = Math.sign(x) * y
  }
  return curve
}

/**
 * Sea echo: gunfire comes back off the water and the horizon, darker each time,
 * so a salvo rolls away instead of stopping dead like a drum. Returns its (mono) input.
 */
function seaEcho(ctx: BaseAudioContext, dest: AudioNode) {
  const input = ctx.createGain()
  input.channelCount = 1
  input.channelCountMode = 'explicit'
  // Quiet, short-lived repeats: with more feedback a barrage's echoes piled up and droned on.
  const ret = ctx.createGain()
  ret.gain.value = 0.6
  ret.connect(dest)
  for (const [time, pan, fb] of [[0.19, -0.6, 0.22], [0.33, 0.6, 0.16]]) {
    const dl = ctx.createDelay(1)
    dl.delayTime.value = time
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 650
    const g = ctx.createGain()
    g.gain.value = fb
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    input.connect(dl)
    dl.connect(lp).connect(g).connect(dl)
    lp.connect(p).connect(ret)
  }
  return input
}

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function readVolume(): Record<Channel, number> {
  // First run starts at half volume: full scale is too loud before the player has set it.
  const v = { bgm: 0.5, se: 0.5 }
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? '{}') as Partial<Record<Channel, unknown>>
    for (const ch of ['bgm', 'se'] as const) {
      const n = saved[ch]
      if (typeof n === 'number' && n >= 0 && n <= 1) v[ch] = n
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return v
}

export const audio = new AudioEngine()

// Any later gesture also wakes a context the browser suspended mid-session.
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => audio.ctx && audio.unlock(), { capture: true, passive: true })
