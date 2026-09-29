// Procedural sound: every effect and the fallback music are synthesised with
// Web Audio, so the game is fully voiced without any asset pack. When the
// legacy pack is present its recorded BGM and gunfire replace the synth
// sounds they cover.

export type Sfx =
  | 'tap'
  | 'select'
  | 'back'
  | 'cannon'
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
  | 'move'
  | 'dive'
  | 'reveal'
  | 'star'
  | 'error'
  | 'heart'

export type Track = 'home' | 'battle' | 'boss' | 'gacha'

const MUTE_KEY = 'muted'
const VOLUME_KEY = 'volume'

// Bus levels at a volume setting of 1; the player's BGM/SE settings scale these.
const MUSIC_LEVEL = 0.28
const SFX_LEVEL = 0.9
const RECORDED_BGM_LEVEL = 0.3

export type Channel = 'bgm' | 'se'

// Recorded effects from the legacy pack: file name and volume. They play
// through media elements, so they still sound if the Web Audio context stalls.
const RECORDED_SFX: Partial<Record<Sfx, [string, number]>> = {
  cannon: ['launch', 0.5],
  boom: ['explosion1', 0.6],
  bigboom: ['explosion3', 0.7],
  splash: ['explosion2', 0.35],
  miss: ['explosion2', 0.3],
  move: ['move', 0.5],
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

interface ToneOpts {
  type?: OscillatorType
  vol?: number
  slideTo?: number
  attack?: number
  filter?: number
  detune?: number
  bus?: GainNode
}

interface NoiseOpts {
  vol?: number
  type?: BiquadFilterType
  freq?: number
  freqTo?: number
  q?: number
  attack?: number
  bus?: GainNode
}

// A step sequencer pattern: one bar = 16 steps; notes are MIDI numbers.
interface Pattern {
  bpm: number
  bars: number
  chords: number[][] // per bar, root first
  bass: (number | null)[] // 16 steps of semitone offsets from the bar root, null = rest
  arp?: (number | null)[] // indexes into the chord (+12 per octave), 16 steps
  lead?: (number | null)[] // absolute MIDI over the whole loop (bars*16 steps)
  kick?: string // 'x...' per 16 steps
  snare?: string
  hat?: string
  arpType?: OscillatorType
  bassType?: OscillatorType
  arpOctave?: number
}

const PATTERNS: Record<Track, Pattern> = {
  home: {
    bpm: 92,
    bars: 4,
    chords: [
      [50, 54, 57, 61],
      [47, 50, 54, 57],
      [43, 47, 50, 54],
      [45, 49, 52, 55],
    ],
    bass: [0, null, null, null, null, null, 7, null, 0, null, null, null, 12, null, 7, null],
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 2, 3],
    hat: '..x...x...x...x.',
    arpType: 'triangle',
    bassType: 'sine',
    arpOctave: 12,
  },
  battle: {
    bpm: 136,
    bars: 4,
    chords: [
      [50, 53, 57],
      [46, 50, 53],
      [48, 52, 55],
      [45, 49, 52],
    ],
    bass: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 7, 7, 12, 10],
    arp: [0, 1, 2, 4, 2, 1, 0, 2, 0, 1, 2, 4, 5, 4, 2, 1],
    lead: [
      74, null, null, 72, 74, null, 77, null, 76, null, 74, null, 72, null, 69, null,
      70, null, null, 69, 70, null, 74, null, 72, null, 70, null, 69, null, 65, null,
      72, null, null, 70, 72, null, 76, null, 79, null, 77, null, 76, null, 72, null,
      73, null, 76, null, 79, null, 81, null, 79, null, 76, null, 73, null, null, null,
    ],
    kick: 'x...x...x...x...',
    snare: '....x.......x..x',
    hat: 'x.x.x.x.x.x.x.x.',
    arpType: 'square',
    bassType: 'sawtooth',
    arpOctave: 12,
  },
  boss: {
    bpm: 150,
    bars: 4,
    chords: [
      [40, 43, 47],
      [41, 45, 48],
      [40, 43, 47],
      [38, 42, 45],
    ],
    bass: [0, 0, 0, 12, 0, 0, 1, 0, 0, 0, 0, 12, 0, 1, 0, 3],
    arp: [0, 2, 4, 2, 5, 4, 2, 0, 0, 2, 4, 2, 6, 5, 4, 2],
    lead: [
      76, null, 77, null, 76, null, 74, null, 72, null, 71, null, 72, null, 74, null,
      77, null, 76, null, 77, null, 79, null, 81, null, 79, null, 77, null, 76, null,
      76, null, 77, null, 79, null, 83, null, 84, null, 83, null, 79, null, 77, null,
      74, null, 76, null, 78, null, 81, null, 78, null, 74, null, 71, null, null, null,
    ],
    kick: 'x..xx...x..xx..x',
    snare: '....x.......x.xx',
    hat: 'xxxxxxxxxxxxxxxx',
    arpType: 'sawtooth',
    bassType: 'sawtooth',
    arpOctave: 12,
  },
  gacha: {
    bpm: 112,
    bars: 2,
    chords: [
      [53, 57, 60, 64],
      [55, 59, 62, 65],
    ],
    bass: [0, null, null, null, 7, null, null, null, 0, null, null, null, 7, null, 12, null],
    arp: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0, 1],
    hat: '..x...x...x...xx',
    arpType: 'triangle',
    bassType: 'sine',
    arpOctave: 24,
  },
}

class AudioEngine {
  ctx?: AudioContext
  private master?: GainNode
  private sfxBus?: GainNode
  private musicBus?: GainNode
  private noiseBuf?: AudioBuffer
  muted = readMuted()
  volume: Record<Channel, number> = readVolume()
  private legacy = false
  private recordedSfx = new Map<string, HTMLAudioElement>()
  private track: Track | null = null
  private seqTimer?: number
  private nextTime = 0
  private step = 0
  private recorded?: HTMLAudioElement
  private listeners = new Set<() => void>()

  /** Must be called from a user gesture to allow playback. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      this.ctx = new Ctx()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.8
      // A gentle limiter keeps stacked explosions from clipping.
      const comp = this.ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 6
      this.master.connect(comp).connect(this.ctx.destination)
      this.sfxBus = this.ctx.createGain()
      this.sfxBus.gain.value = SFX_LEVEL * this.volume.se
      this.sfxBus.connect(this.master)
      this.musicBus = this.ctx.createGain()
      this.musicBus.gain.value = MUSIC_LEVEL * this.volume.bgm
      this.musicBus.connect(this.master)
      const len = this.ctx.sampleRate * 2
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    }
    this.resume()
    const t = this.track
    if (t && !this.seqTimer && !this.recorded) {
      this.track = null
      this.music(t)
    }
  }

  /** The context can be suspended after the first gesture (tab switch, device change); wake it on the next one. */
  private resume() {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
  }

  /** Called once the legacy asset pack is known to be present. */
  useLegacy(present: boolean) {
    this.legacy = present
    if (!present) return
    for (const [file] of Object.values(RECORDED_SFX)) {
      if (this.recordedSfx.has(file)) continue
      const a = new Audio(`/legacy/se/${file}.mp3`)
      a.preload = 'auto'
      this.recordedSfx.set(file, a)
    }
  }

  private playRecorded(name: Sfx) {
    const rec = RECORDED_SFX[name]
    const src = rec && this.recordedSfx.get(rec[0])
    if (!rec || !src) return false
    const a = src.cloneNode() as HTMLAudioElement
    a.volume = rec[1] * this.volume.se
    a.play().catch(() => {})
    return true
  }

  /** Subscribes to mute and volume changes. */
  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
    if (this.recorded) this.recorded.muted = m
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
    this.listeners.forEach((f) => f())
  }

  /** Sets the BGM or SE volume (0..1) and remembers it. */
  setVolume(ch: Channel, v: number) {
    this.volume = { ...this.volume, [ch]: Math.min(1, Math.max(0, v)) }
    if (this.ctx) {
      const now = this.ctx.currentTime
      this.musicBus?.gain.setTargetAtTime(MUSIC_LEVEL * this.volume.bgm, now, 0.05)
      this.sfxBus?.gain.setTargetAtTime(SFX_LEVEL * this.volume.se, now, 0.05)
    }
    if (this.recorded) this.recorded.volume = RECORDED_BGM_LEVEL * this.volume.bgm
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

  // ---------------- primitives ----------------

  private tone(freq: number, start: number, dur: number, o: ToneOpts = {}) {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(freq, start)
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(o.slideTo, 1), start + dur)
    if (o.detune) osc.detune.value = o.detune
    const vol = o.vol ?? 0.3
    const a = o.attack ?? 0.005
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(vol, start + a)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    let node: AudioNode = osc
    if (o.filter) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = o.filter
      node.connect(f)
      node = f
    }
    node.connect(g).connect(o.bus ?? this.sfxBus!)
    osc.start(start)
    osc.stop(start + dur + 0.05)
  }

  private noise(start: number, dur: number, o: NoiseOpts = {}) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf!
    const f = ctx.createBiquadFilter()
    f.type = o.type ?? 'lowpass'
    f.frequency.setValueAtTime(o.freq ?? 1000, start)
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, start + dur)
    f.Q.value = o.q ?? 1
    const g = ctx.createGain()
    const vol = o.vol ?? 0.4
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(vol, start + (o.attack ?? 0.005))
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    src.connect(f).connect(g).connect(o.bus ?? this.sfxBus!)
    src.start(start, Math.random() * 1.5)
    src.stop(start + dur + 0.05)
  }

  private chord(notes: number[], start: number, dur: number, o: ToneOpts = {}) {
    notes.forEach((n) => this.tone(midi(n), start, dur, o))
  }

  // ---------------- effects ----------------

  play(name: Sfx, opt: { pitch?: number } = {}) {
    if (this.muted || this.volume.se === 0) return
    if (this.legacy && this.playRecorded(name)) return
    if (!this.ctx) return
    this.resume()
    const t = this.ctx.currentTime + 0.005
    const p = opt.pitch ?? 0
    switch (name) {
      case 'tap':
        this.tone(1100, t, 0.06, { type: 'triangle', vol: 0.18, slideTo: 1500 })
        break
      case 'select':
        this.tone(760, t, 0.07, { type: 'triangle', vol: 0.18 })
        this.tone(1140, t + 0.06, 0.1, { type: 'triangle', vol: 0.18 })
        break
      case 'back':
        this.tone(900, t, 0.1, { type: 'triangle', vol: 0.16, slideTo: 500 })
        break
      case 'error':
        this.tone(220, t, 0.12, { type: 'square', vol: 0.12, filter: 1200 })
        this.tone(180, t + 0.12, 0.18, { type: 'square', vol: 0.12, filter: 1200 })
        break
      case 'cannon':
        this.noise(t, 0.35, { vol: 0.7, freq: 2400, freqTo: 200 })
        this.tone(110, t, 0.3, { type: 'sine', vol: 0.6, slideTo: 40 })
        break
      case 'boom':
        this.noise(t, 0.9, { vol: 0.8, freq: 1800, freqTo: 90, attack: 0.01 })
        this.tone(90, t, 0.6, { type: 'sine', vol: 0.8, slideTo: 30 })
        this.noise(t + 0.05, 0.4, { vol: 0.25, type: 'highpass', freq: 3000 })
        break
      case 'bigboom':
        this.noise(t, 1.8, { vol: 1, freq: 2600, freqTo: 60, attack: 0.01 })
        this.tone(70, t, 1.2, { type: 'sine', vol: 1, slideTo: 22 })
        this.tone(140, t, 0.4, { type: 'square', vol: 0.2, slideTo: 40, filter: 600 })
        this.noise(t + 0.15, 1.2, { vol: 0.35, freq: 600, freqTo: 80 })
        break
      case 'crit':
        this.tone(1760, t, 0.5, { type: 'square', vol: 0.12, filter: 5000 })
        this.tone(2637, t, 0.6, { type: 'sine', vol: 0.2 })
        this.tone(3520, t + 0.04, 0.5, { type: 'sine', vol: 0.12 })
        this.noise(t, 0.2, { vol: 0.4, type: 'highpass', freq: 4000 })
        break
      case 'splash':
        this.noise(t, 0.6, { vol: 0.45, type: 'bandpass', freq: 1800, freqTo: 600, q: 0.7 })
        this.noise(t + 0.08, 0.5, { vol: 0.25, type: 'highpass', freq: 5000 })
        break
      case 'miss':
        this.noise(t, 0.35, { vol: 0.3, type: 'bandpass', freq: 1200, freqTo: 400 })
        this.tone(300, t, 0.15, { type: 'sine', vol: 0.2, slideTo: 120 })
        break
      case 'evade':
        this.noise(t, 0.25, { vol: 0.35, type: 'bandpass', freq: 800, freqTo: 5000, q: 2 })
        this.tone(600, t + 0.05, 0.2, { type: 'triangle', vol: 0.15, slideTo: 1600 })
        break
      case 'sonar':
        for (let i = 0; i < 3; i++) this.tone(1320, t + i * 0.35, 0.6 - i * 0.1, { type: 'sine', vol: 0.3 / (i + 1) })
        break
      case 'flare':
        this.tone(400, t, 0.5, { type: 'sine', vol: 0.2, slideTo: 2400 })
        this.noise(t + 0.45, 0.8, { vol: 0.5, type: 'highpass', freq: 2000, freqTo: 800 })
        this.tone(2000, t + 0.45, 0.8, { type: 'triangle', vol: 0.12, slideTo: 1800 })
        break
      case 'torpedo':
        this.noise(t, 0.2, { vol: 0.5, freq: 900 })
        this.noise(t + 0.1, 1.1, { vol: 0.3, type: 'bandpass', freq: 400, freqTo: 1200, q: 4 })
        for (let i = 0; i < 6; i++) this.tone(300 + Math.random() * 400, t + 0.15 + i * 0.12, 0.08, { type: 'sine', vol: 0.12 })
        break
      case 'airstrike':
        this.noise(t, 1.1, { vol: 0.5, type: 'bandpass', freq: 300, freqTo: 3000, q: 1.5, attack: 0.4 })
        this.tone(160, t, 1.1, { type: 'sawtooth', vol: 0.08, slideTo: 260, filter: 900 })
        break
      case 'charge':
        this.tone(110, t, 1.4, { type: 'sawtooth', vol: 0.25, slideTo: 1760, filter: 3000, attack: 0.8 })
        this.tone(220, t, 1.4, { type: 'square', vol: 0.1, slideTo: 3520, filter: 3000, attack: 0.8 })
        this.noise(t, 1.4, { vol: 0.3, type: 'highpass', freq: 500, freqTo: 8000, attack: 1.2 })
        break
      case 'combo': {
        const base = 72 + Math.min(p, 10) * 2
        this.tone(midi(base), t, 0.12, { type: 'square', vol: 0.12, filter: 4000 })
        this.tone(midi(base + 7), t + 0.07, 0.18, { type: 'square', vol: 0.12, filter: 4000 })
        this.tone(midi(base + 12), t + 0.14, 0.3, { type: 'triangle', vol: 0.18 })
        break
      }
      case 'coin':
        this.tone(midi(83 + p), t, 0.08, { type: 'square', vol: 0.1, filter: 6000 })
        this.tone(midi(88 + p), t + 0.07, 0.25, { type: 'square', vol: 0.1, filter: 6000 })
        break
      case 'gem':
        ;[0, 4, 7, 12].forEach((n, i) => this.tone(midi(88 + n + p), t + i * 0.05, 0.3, { type: 'sine', vol: 0.14 }))
        break
      case 'tick':
        this.tone(2200 + p * 40, t, 0.03, { type: 'square', vol: 0.05, filter: 5000 })
        break
      case 'star':
        this.tone(midi(84 + p), t, 0.5, { type: 'triangle', vol: 0.25 })
        this.tone(midi(91 + p), t + 0.05, 0.5, { type: 'sine', vol: 0.15 })
        this.noise(t, 0.3, { vol: 0.15, type: 'highpass', freq: 6000 })
        break
      case 'levelup':
        ;[60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.tone(midi(n + 12), t + i * 0.06, 0.35, { type: 'triangle', vol: 0.18 }))
        this.chord([72, 76, 79, 84], t + 0.45, 1.2, { type: 'triangle', vol: 0.1 })
        this.noise(t + 0.4, 1, { vol: 0.12, type: 'highpass', freq: 7000 })
        break
      case 'roll':
        for (let i = 0; i < 18; i++) {
          const at = t + 1.6 * (1 - Math.pow(1 - i / 18, 1.6))
          this.noise(at, 0.08, { vol: 0.25 + i * 0.02, type: 'bandpass', freq: 1800, q: 1.5 })
        }
        this.tone(220, t, 1.7, { type: 'sawtooth', vol: 0.06, slideTo: 880, filter: 2000, attack: 1.2 })
        break
      case 'rare':
        this.chord([76, 80, 83], t, 0.9, { type: 'triangle', vol: 0.12 })
        this.noise(t, 0.6, { vol: 0.2, type: 'highpass', freq: 6000 })
        break
      case 'ssr':
        ;[72, 76, 79, 84, 88, 91, 96].forEach((n, i) => this.tone(midi(n), t + i * 0.045, 1.6 - i * 0.1, { type: 'triangle', vol: 0.16 }))
        this.chord([60, 67, 72, 76], t + 0.3, 2.2, { type: 'sawtooth', vol: 0.05, filter: 3000, attack: 0.2 })
        this.noise(t, 2, { vol: 0.25, type: 'highpass', freq: 5000, freqTo: 9000 })
        this.tone(55, t, 1.5, { type: 'sine', vol: 0.6, slideTo: 40 })
        break
      case 'chest':
        this.tone(140, t, 0.25, { type: 'sawtooth', vol: 0.12, slideTo: 90, filter: 800 })
        ;[84, 88, 91, 96].forEach((n, i) => this.tone(midi(n), t + 0.2 + i * 0.06, 0.4, { type: 'sine', vol: 0.15 }))
        this.noise(t + 0.2, 0.6, { vol: 0.2, type: 'highpass', freq: 6000 })
        break
      case 'victory': {
        const seq: [number, number, number][] = [
          [67, 0, 0.14],
          [67, 0.15, 0.14],
          [67, 0.3, 0.14],
          [72, 0.45, 0.6],
          [68, 1.05, 0.4],
          [70, 1.45, 0.4],
          [72, 1.85, 0.25],
          [70, 2.1, 0.12],
          [72, 2.25, 1.2],
        ]
        seq.forEach(([n, at, d]) => {
          this.tone(midi(n + 12), t + at, d + 0.1, { type: 'square', vol: 0.1, filter: 3500 })
          this.tone(midi(n), t + at, d + 0.1, { type: 'triangle', vol: 0.15 })
        })
        this.chord([60, 64, 67, 72], t + 2.25, 1.6, { type: 'sawtooth', vol: 0.05, filter: 2500 })
        break
      }
      case 'defeat':
        ;[
          [67, 0],
          [66, 0.4],
          [65, 0.8],
          [64, 1.2],
        ].forEach(([n, at]) => this.tone(midi(n), t + at, 0.5, { type: 'triangle', vol: 0.18 }))
        this.chord([52, 55, 58], t + 1.6, 2, { type: 'sawtooth', vol: 0.05, filter: 900 })
        break
      case 'stamp':
        this.tone(80, t, 0.35, { type: 'sine', vol: 0.9, slideTo: 35 })
        this.noise(t, 0.25, { vol: 0.5, freq: 900, freqTo: 100 })
        break
      case 'whoosh':
        this.noise(t, 0.35, { vol: 0.35, type: 'bandpass', freq: 400, freqTo: 4000, q: 1.2, attack: 0.12 })
        break
      case 'alarm':
        for (let i = 0; i < 2; i++) {
          this.tone(880, t + i * 0.3, 0.14, { type: 'square', vol: 0.09, filter: 3000 })
          this.tone(660, t + i * 0.3 + 0.15, 0.14, { type: 'square', vol: 0.09, filter: 3000 })
        }
        break
      case 'move':
        this.noise(t, 0.6, { vol: 0.25, type: 'bandpass', freq: 500, freqTo: 1500, q: 0.8, attack: 0.15 })
        break
      case 'dive':
        for (let i = 0; i < 8; i++) this.tone(200 + Math.random() * 500, t + i * 0.06, 0.08, { type: 'sine', vol: 0.12 })
        this.noise(t, 0.6, { vol: 0.2, freq: 600, freqTo: 150 })
        break
      case 'reveal':
        this.tone(midi(79), t, 0.15, { type: 'square', vol: 0.1, filter: 4000 })
        this.tone(midi(86), t + 0.1, 0.3, { type: 'square', vol: 0.1, filter: 4000 })
        break
      case 'heart':
        this.tone(midi(84), t, 0.12, { type: 'sine', vol: 0.15 })
        this.tone(midi(91), t + 0.08, 0.25, { type: 'sine', vol: 0.15 })
        break
    }
  }

  // ---------------- music ----------------

  /** Switches the background music; null stops it. */
  music(track: Track | null) {
    if (this.track === track) return
    this.stopMusic()
    this.track = track
    if (!track) return
    const recorded = this.legacy ? ({ home: 'title', battle: 'battle' } as Partial<Record<Track, string>>)[track] : undefined
    if (recorded) {
      const a = new Audio(`/legacy/bgm/${recorded}.mp3`)
      a.loop = true
      a.volume = RECORDED_BGM_LEVEL * this.volume.bgm
      a.muted = this.muted
      a.play().catch(() => {})
      this.recorded = a
      return
    }
    if (!this.ctx) return // started on unlock()
    this.step = 0
    this.nextTime = this.ctx.currentTime + 0.1
    this.seqTimer = window.setInterval(() => this.schedule(), 25)
  }

  private stopMusic() {
    if (this.seqTimer) clearInterval(this.seqTimer)
    this.seqTimer = undefined
    this.recorded?.pause()
    this.recorded = undefined
  }

  private schedule() {
    const ctx = this.ctx
    if (!ctx || !this.track) return
    const pat = PATTERNS[this.track]
    const stepDur = 60 / pat.bpm / 4
    const bus = this.musicBus!
    while (this.nextTime < ctx.currentTime + 0.15) {
      const t = this.nextTime
      const total = pat.bars * 16
      const s = this.step % total
      const bar = Math.floor(s / 16)
      const i = s % 16
      const chord = pat.chords[bar]
      const root = chord[0]
      if (!this.muted) {
        if (i === 0) this.chord(chord.map((n) => n + 12), t, stepDur * 16, { type: 'sine', vol: 0.05, attack: 0.3, bus })
        const b = pat.bass[i]
        if (b !== null) this.tone(midi(root - 12 + b), t, stepDur * 1.8, { type: pat.bassType, vol: 0.22, filter: 700, bus })
        if (pat.arp) {
          const a = pat.arp[i]
          if (a !== null) {
            const n = chord[a % chord.length] + 12 * Math.floor(a / chord.length) + (pat.arpOctave ?? 12)
            this.tone(midi(n), t, stepDur * 0.9, { type: pat.arpType, vol: 0.06, filter: 3500, bus })
          }
        }
        const l = pat.lead?.[s]
        if (l) this.tone(midi(l), t, stepDur * 1.9, { type: 'square', vol: 0.06, filter: 2600, bus })
        if (pat.kick?.[i] === 'x') this.tone(120, t, 0.18, { type: 'sine', vol: 0.5, slideTo: 40, bus })
        if (pat.snare?.[i] === 'x') this.noise(t, 0.14, { vol: 0.25, type: 'bandpass', freq: 1800, q: 0.8, bus })
        if (pat.hat?.[i] === 'x') this.noise(t, 0.04, { vol: 0.08, type: 'highpass', freq: 8000, bus })
      }
      this.nextTime += stepDur
      this.step++
    }
  }
}

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function readVolume(): Record<Channel, number> {
  const v = { bgm: 1, se: 1 }
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
