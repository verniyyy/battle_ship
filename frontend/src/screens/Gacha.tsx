import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { audio } from '../audio'
import { ShipArt } from '../components/ShipArt'
import { Backdrop, CardView, Modal, RarityBadge, Stars, TopBar } from '../components/ui'
import { fx, RAINBOW } from '../fx'
import { CLASS_INFO, lookOfCard, rarityName, skillOf, SKILL_INFO } from '../game'
import { useGame } from '../state'
import type { Card, Gain } from '../types'

type Phase = 'idle' | 'rolling' | 'reveal' | 'cutin' | 'spotlight' | 'summary'

/**
 * Omens (予兆) that can open the build-up: the hotter the pull, the likelier and louder.
 * They speak only in light and sound: a red alert, a sonar contact, the dock's searchlights, a torn screen.
 */
type Omen = 'alert' | 'sonar' | 'flood' | 'glitch'

const ORB_COLOR = ['#8fb8ff', '#4fc3ff', '#ffcf4a', '#ffffff', '#ffffff'] as const
const OMEN_MS: Record<Omen, number> = { alert: 1400, sonar: 1750, flood: 1750, glitch: 2100 }
const STEP_MS = 520
const PRISM = ['#b388ff', '#4fd5ff', '#ffffff', '#ff7ae0', '#9effe6']
const MULTI: Record<number, string> = { 2: 'DOUBLE!!', 3: 'TRIPLE!!!', 4: 'QUADRUPLE!!!!' }

interface RollPlan {
  /** Best rarity of the pull, which the dock builds up to. */
  top: number
  /** Orb level after each of the three hammer blows. */
  levels: number[]
  /** Sits at gold through every blow, then cracks open to rainbow. */
  fake: boolean
  omen: Omen | null
}

const pickOf = <T,>(xs: T[], rnd: () => number) => xs[Math.floor(rnd() * xs.length)]

/** How the construction dock builds up to the best ship of a pull. */
export function rollPlan(best: number, rnd = Math.random): RollPlan {
  const top = Math.min(best, 4)
  // UR always gets its own omen; SSR usually gets one; SR only now and then, and never the alarm.
  const omen: Omen | null =
    top >= 4 ? 'glitch' : top === 3 ? (rnd() < 0.7 ? pickOf<Omen>(['alert', 'sonar', 'flood'], rnd) : null) : top === 2 && rnd() < 0.15 ? pickOf<Omen>(['sonar', 'flood'], rnd) : null
  const fake = top >= 3 && rnd() < 0.45
  const first = Math.min(top, rnd() < 0.6 ? 0 : 1)
  if (fake) return { top, omen, fake, levels: [first, Math.max(first, 1 + Math.floor(rnd() * 2)), 2] }
  // A UR holds at rainbow at most until the last blow, so that blow always lands on prism.
  const cap = Math.min(top, 3)
  const second = first + Math.floor(rnd() * (cap - first + 1))
  return { top, omen, fake, levels: [first, second, top] }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export function Gacha({ onBack }: { onBack: () => void }) {
  const { profile, catalog, card, setProfile, notify } = useGame()
  const [phase, setPhase] = useState<Phase>('idle')
  const [gains, setGains] = useState<Gain[]>([])
  const [flipped, setFlipped] = useState(0)
  const [orb, setOrb] = useState(0)
  const [plan, setPlan] = useState<RollPlan | null>(null)
  const [step, setStep] = useState(0)
  const [omen, setOmen] = useState<Omen | null>(null)
  const [upgrade, setUpgrade] = useState(false)
  // The top-rarity card the reveal is holding its breath over.
  const [tease, setTease] = useState<number | null>(null)
  // The top-rarity card held at centre stage while it turns over and goes off.
  const [hero, setHero] = useState<number | null>(null)
  const [spot, setSpot] = useState<number | null>(null)
  const [rates, setRates] = useState(false)
  // The featured ship on the banner; it turns on its own, and the admiral can turn it too.
  const [showcase, setShowcase] = useState({ i: 0, back: false, manual: false })
  const timers = useRef<number[]>([])
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const deckRef = useRef<HTMLDivElement | null>(null)
  const orbRef = useRef<HTMLDivElement | null>(null)
  // Timers outlive renders, so they read the pulled ships from a ref.
  const gainsRef = useRef<Gain[]>([])
  const swipeFrom = useRef<number | null>(null)

  const featured = catalog?.cards.filter((c) => c.rarity >= 3) ?? []

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  // The fake-out upgrade's explosion is modelled in a worker: render it before a pull needs it.
  useEffect(() => audio.prewarm([['bigboom', {}]]), [])

  // The haul keeps glittering while the admiral looks it over.
  useEffect(() => {
    if (phase !== 'summary') return
    const hot = gains.map((g, i) => (g.rarity >= 3 ? i : -1)).filter((i) => i >= 0)
    if (!hot.length) return
    const id = window.setInterval(() => {
      for (const i of hot) {
        const pt = fx.center(cardRefs.current[i])
        fx.sparkle(pt.x + rand(-50, 50), pt.y + rand(-80, 80), '#fff', 5, 70)
      }
    }, 700)
    return () => clearInterval(id)
  }, [phase, gains])

  // Auto-advance, held off for a while after the admiral picks a ship themselves.
  useEffect(() => {
    if (phase !== 'idle') return
    const t = window.setTimeout(() => setShowcase((s) => ({ i: s.i + 1, back: false, manual: false })), showcase.manual ? 9000 : 3200)
    return () => clearTimeout(t)
  }, [showcase, phase])

  const turnShowcase = (to: number, back = false) => {
    audio.play('tap')
    setShowcase({ i: to, back, manual: true })
  }

  if (!profile || !catalog) return null

  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  const pull = async (count: 1 | 10) => {
    const free = count === 10 && profile.badges.freeTen
    const cost = count === 1 ? catalog.pullCost : catalog.tenPullCost
    if (!free && profile.gems < cost) {
      notify('勲章（💎）が足りません。任務やログボで集めよう！', 'error')
      return
    }
    audio.play('select')
    try {
      const r = await api.pull(count)
      setProfile(r.profile)
      start(r.gains)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  const orbAt = () => (orbRef.current ? fx.center(orbRef.current) : { x: 640, y: 330 })

  const start = (gs: Gain[]) => {
    clearTimers()
    gainsRef.current = gs
    setGains(gs)
    setFlipped(0)
    setSpot(null)
    setTease(null)
    setHero(null)
    cardRefs.current.forEach((el) => el && delete el.dataset.aimed)
    const p = rollPlan(Math.max(...gs.map((g) => g.rarity)))
    setPlan(p)
    setOrb(0)
    setStep(0)
    setUpgrade(false)
    setOmen(p.omen)
    setPhase('rolling')
    fx.punch(1.06, 320)
    let at = 0
    if (p.omen) {
      playOmen(p.omen, p.top)
      at = OMEN_MS[p.omen]
      later(at, () => setOmen(null))
    }
    later(at, () => {
      audio.play('roll')
      fx.shake(4, 1600)
    })
    p.levels.forEach((to, i) => later(at + 450 + i * STEP_MS, () => hammer(i + 1, i ? p.levels[i - 1] : 0, to)))
    at += 450 + 2 * STEP_MS
    if (p.fake) {
      later(at + 520, () => {
        setUpgrade(true)
        audio.play('bigboom')
        audio.buzz([60, 40, 60])
        fx.shake(18, 500)
      })
      later(at + 980, () => {
        setUpgrade(false)
        setOrb(p.top)
        burst(2, p.top, true)
      })
      at += 980
    }
    later(at + [550, 550, 800, 1300, 1700][p.top], () => reveal(gs))
  }

  const playOmen = (o: Omen, top: number) => {
    switch (o) {
      case 'alert':
        later(0, () => {
          audio.play('alarm')
          audio.buzz([120, 80, 120, 80, 120])
          fx.shake(10, 900)
        })
        later(160, () => audio.play('alert'))
        later(700, () => audio.play('alarm'))
        break
      case 'sonar':
        // Three pings go out into the dark; the third comes back off something big.
        later(0, () => audio.play('sonar'))
        later(1100, () => {
          heartbeat()
          fx.ring(640, 330, top >= 3 ? '#ffd27a' : '#7dffcf', 420, 0.7)
          fx.shake(8, 400)
        })
        later(1650, () => {
          fx.flash(top >= 3 ? '#ffe2a8' : '#c8fff0', 300, 0.6)
          fx.punch(1.05, 260)
        })
        break
      case 'flood':
        // The dock's searchlights slam on bank by bank, then swing together onto the slipway.
        ;[100, 280, 460, 640].forEach((ms, k) =>
          later(ms, () => {
            audio.play('stamp')
            audio.buzz(30)
            fx.shake(4 + k, 180)
          }),
        )
        later(700, () => audio.play('charge'))
        later(1100, () => {
          fx.flash(top >= 3 ? '#ff4a1a' : '#4affc0', 450, 0.85)
          fx.rays(640, 360, top >= 3 ? '#ff8a3c' : '#7dffcf', 18, 1.2)
          fx.shake(22, 650)
          fx.punch(1.08, 300)
          audio.buzz([200, 50, 100])
        })
        break
      case 'glitch':
        later(0, () => {
          audio.play('ultcharge', { dur: 1.6 })
          fx.shake(5, 1700)
        })
        ;[
          [260, '#ff00c8'],
          [560, '#00f0ff'],
          [820, '#ff00c8'],
          [1020, '#ffffff'],
          [1240, '#00f0ff'],
        ].forEach(([ms, c]) => later(ms as number, () => fx.flash(c as string, 140, 0.55)))
        later(1750, () => {
          audio.play('shatter')
          audio.buzz([300, 60, 300])
          fx.shatter(640, 360, 110, '#f3e6ff')
          fx.flash('#fff', 600, 1)
          fx.shake(24, 700)
        })
        break
    }
  }

  /** One hammer blow on the hull: the orb may heat up a level (or more). */
  const hammer = (n: number, from: number, to: number) => {
    setStep(n)
    setOrb(to)
    audio.play('stepup', { pitch: to })
    audio.buzz(30 + to * 15)
    fx.punch(1.03 + to * 0.012, 220)
    fx.shake(3 + to * 2, 260)
    const pt = orbAt()
    fx.ring(pt.x, pt.y, ORB_COLOR[to], 180 + to * 40, 0.5)
    if (to > from) burst(from, to, false)
  }

  /** The orb jumping to a hotter colour. A crack is the fake-out's gold breaking open. */
  const burst = (from: number, to: number, crack: boolean) => {
    const pt = orbAt()
    if (to === 2) {
      audio.play('rare')
      fx.flash('#ffe39a', 450, 0.7)
      fx.rays(pt.x, pt.y, '#ffe39a', 12, 1.2)
      fx.sparkle(pt.x, pt.y, '#ffd24a', 30, 220)
      return
    }
    if (to < 3) return
    void fx.hitstop(120)
    audio.play('ssr')
    audio.buzz([150, 50, 200])
    fx.flash('#fff', 700, 0.95)
    fx.rays(pt.x, pt.y, '#fff2a8', 22, 2.2)
    fx.ring(pt.x, pt.y, '#fff', 500, 0.8)
    fx.firework(pt.x, pt.y, to >= 4 ? PRISM : RAINBOW, 72)
    fx.confetti(140, to >= 4 ? PRISM : RAINBOW)
    fx.shake(16, 600)
    if (crack || from < 3) {
      audio.play('shatter')
      fx.shatter(pt.x, pt.y, 70)
    }
    if (to >= 4) {
      later(140, () => fx.flash('#ff7ae0', 300, 0.7))
      later(300, () => fx.flash('#4fd5ff', 300, 0.7))
      ;[0, 1, 2, 3].forEach((k) => later(200 + k * 220, () => fx.firework(rand(160, 1120), rand(100, 420), PRISM)))
    }
  }

  /**
   * Turns the cards over in order. A top-rarity card stops the run: it flies to centre stage,
   * trembles, gets its cut-in, and only then turns, going off the moment its face shows.
   * The run picks up again after its spotlight.
   */
  const reveal = (gs: Gain[], from = 0) => {
    clearTimers()
    setOmen(null)
    setUpgrade(false)
    setTease(null)
    setHero(null)
    setSpot(null)
    setPhase('reveal')
    let at = from ? 300 : 260
    for (let i = from; i < gs.length; i++) {
      const g = gs[i]!
      if (g.rarity >= 3) {
        // Everything else goes dark and the card trembles for two heartbeats first.
        later(at, () => {
          aim(i)
          setTease(i)
          heartbeat()
        })
        later(at + 520, heartbeat)
        later(at + 1050, () => cutIn(i))
        return
      }
      later(at, () => {
        setFlipped(i + 1)
        flipFx(i, g)
      })
      at += g.rarity === 2 ? 220 : 160
    }
    later(at + 350, finish)
  }

  const heartbeat = () => {
    audio.play('heartbeat')
    audio.buzz(40)
  }

  /** Points a card at the middle of the deck, so it can fly there (measured once, before it moves). */
  const aim = (i: number) => {
    const el = cardRefs.current[i]
    if (!el || el.dataset.aimed) return
    const to = fx.center(deckRef.current)
    const pt = fx.center(el)
    el.style.setProperty('--dx', `${to.x - pt.x}px`)
    el.style.setProperty('--dy', `${to.y - pt.y}px`)
    el.dataset.aimed = '1'
  }

  const cutIn = (i: number) => {
    clearTimers()
    aim(i)
    setTease(null)
    setHero(i)
    setSpot(i)
    setPhase('cutin')
  }

  /** Back from the cut-in: a beat on the face-down card, then it turns and everything goes off. */
  const turnOver = (i: number) => {
    clearTimers()
    setSpot(null)
    setPhase('reveal')
    later(260, () => {
      setFlipped(i + 1)
      audio.play('whoosh')
    })
    // About when the card stands edge-on and its face starts to show.
    later(260 + 150, () => climax(i))
    later(260 + 2300, () => toSpotlight(i))
  }

  const toSpotlight = (i: number) => {
    clearTimers()
    setSpot(i)
    setPhase('spotlight')
  }

  /** The top-rarity card's face showing: the biggest bang of the whole pull. */
  const climax = (i: number) => {
    const g = gainsRef.current[i]
    if (!g) return
    const ur = g.rarity >= 4
    const colors = ur ? PRISM : RAINBOW
    const pt = fx.center(cardRefs.current[i])
    void fx.hitstop(160)
    audio.play('jackpot', { size: ur ? 2 : 1 })
    audio.play('ssr')
    audio.buzz([150, 60, 250, 60, 150])
    fx.flash(ur ? '#f0d8ff' : '#fff', 650, 0.9)
    fx.shake(22, 800)
    fx.punch(1.08, 360)
    fx.rays(pt.x, pt.y, ur ? '#e0ccff' : '#fff2a8', 26, 2.6)
    ;[0, 140, 280].forEach((ms, k) => later(ms, () => fx.ring(pt.x, pt.y, k % 2 ? (ur ? '#b388ff' : '#ff7ae0') : '#fff', 560, 0.9)))
    fx.firework(pt.x, pt.y, colors, 90)
    fx.sparkle(pt.x, pt.y, '#fff', 60, 320)
    fx.confetti(ur ? 260 : 180, colors)
    fx.coinRain(ur ? 90 : 50, ur ? '#e8dcff' : '#ffd24a')
    if (ur) {
      audio.play('shatter')
      fx.shatter(pt.x, pt.y, 90, '#f3e6ff')
      later(140, () => fx.flash('#ff7ae0', 300, 0.7))
      later(300, () => fx.flash('#4fd5ff', 300, 0.7))
    }
    for (let k = 0; k < (ur ? 8 : 5); k++)
      later(250 + k * 260, () => {
        fx.firework(rand(100, 1180), rand(70, 380), colors)
        audio.play('star', { pitch: Math.floor(rand(-3, 6)) })
      })
  }

  const flipFx = (i: number, g: Gain) => {
    const pt = fx.center(cardRefs.current[i])
    if (g.rarity === 2) {
      audio.play('rare')
      fx.rays(pt.x, pt.y, '#ffe39a', 10, 0.9)
      fx.ring(pt.x, pt.y, '#ffd24a', 160, 0.5)
      fx.sparkle(pt.x, pt.y, '#ffd24a', 26, 150)
      fx.shake(4, 200)
    } else audio.play('tap')
  }

  const finish = () => {
    clearTimers()
    setTease(null)
    setHero(null)
    setSpot(null)
    setFlipped(gainsRef.current.length)
    setPhase('summary')
    celebrate()
  }

  /** Several top-rarity ships in one pull get a last cheer over the haul. */
  const celebrate = () => {
    const n = gainsRef.current.filter((g) => g.rarity >= 3).length
    if (n < 2) return
    later(150, () => {
      audio.play('levelup')
      audio.buzz([100, 50, 100, 50, 200])
      fx.confetti(220, RAINBOW)
      fx.coinRain(60)
      fx.shake(12, 500)
    })
    for (let k = 0; k < n + 2; k++) later(300 + k * 260, () => fx.firework(rand(160, 1120), rand(90, 300)))
  }

  // Tapping during the show jumps ahead, but never past a top-rarity card's cut-in and turn.
  const tapStage = () => {
    if (phase === 'rolling') reveal(gainsRef.current)
    else if (phase !== 'reveal') return
    else if (hero !== null) {
      // Once the hero card is face up, a tap moves on to its spotlight.
      if (flipped > hero) toSpotlight(hero)
    } else {
      const gs = gainsRef.current
      const next = gs.findIndex((g, i) => i >= flipped && g.rarity >= 3)
      if (next < 0) return finish()
      setFlipped(next)
      cutIn(next)
    }
  }

  const shown = featured.length ? ((showcase.i % featured.length) + featured.length) % featured.length : 0
  const feat = featured[shown]
  const spotGain = spot === null ? undefined : gains[spot]
  const spotCard = spotGain ? card(spotGain.card) : undefined
  const ssr = gains.filter((g) => g.rarity === 3).length
  const ur = gains.filter((g) => g.rarity >= 4).length

  return (
    <div className={`screen gacha-screen phase-${phase}`}>
      <Backdrop scene="gacha" />
      <TopBar title="建造" en="CONSTRUCTION" onBack={phase === 'idle' || phase === 'summary' ? onBack : undefined} />

      {phase === 'idle' && (
        <div className="gacha-lobby">
          <section
            className="banner-art"
            aria-roledescription="carousel"
            aria-label="建造で手に入る艦"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') turnShowcase(showcase.i - 1, true)
              else if (e.key === 'ArrowRight') turnShowcase(showcase.i + 1)
            }}
            onPointerDown={(e) => (swipeFrom.current = e.clientX)}
            onPointerUp={(e) => {
              const from = swipeFrom.current
              swipeFrom.current = null
              if (from === null || Math.abs(e.clientX - from) < 40) return
              if (e.clientX > from) turnShowcase(showcase.i - 1, true)
              else turnShowcase(showcase.i + 1)
            }}
            onPointerCancel={() => (swipeFrom.current = null)}
            // A mouse drag over the art would otherwise pick the image up instead of swiping.
            onDragStart={(e) => e.preventDefault()}
          >
            {feat && (
              <div className={`banner-feature ${showcase.back ? 'from-left' : ''}`} key={`${feat.id}-${showcase.i}`}>
                <ShipArt look={lookOfCard(feat)} showKanji={false} frame="full" motion staged />
                <div className="banner-copy">
                  <RarityBadge r={feat.rarity} />
                  <b>{feat.name}</b>
                  <small>{feat.title}</small>
                  <p>「{feat.intro}」</p>
                </div>
              </div>
            )}
            <div className="banner-head">
              <span className="banner-en">FLEET CONSTRUCTION</span>
              <h2>大型艦建造</h2>
              <p>SSR 出現率 {(catalog.pullRates[3] / 10).toFixed(1)}% UR 出現率 {(catalog.pullRates[4] / 10).toFixed(1)}%</p>
            </div>
            {featured.length > 1 && (
              <>
                <button className="banner-nav prev" aria-label="前の艦" onClick={() => turnShowcase(showcase.i - 1, true)} onPointerDown={(e) => e.stopPropagation()}>
                  ‹
                </button>
                <button className="banner-nav next" aria-label="次の艦" onClick={() => turnShowcase(showcase.i + 1)} onPointerDown={(e) => e.stopPropagation()}>
                  ›
                </button>
              </>
            )}
            <div className="banner-dots" onPointerDown={(e) => e.stopPropagation()}>
              {featured.map((f, i) => (
                <button
                  key={f.id}
                  className={i === shown ? 'on' : ''}
                  aria-label={f.name}
                  aria-current={i === shown}
                  onClick={() => i !== shown && turnShowcase(showcase.i + i - shown, i < shown)}
                />
              ))}
            </div>
          </section>

          <section className="gacha-side">
            <div className="pity">
              <span>
                SSR以上確定まで あと <b>{profile.pityLeft}</b> 回
              </span>
              <span className="pity-track">
                <i style={{ width: `${((catalog.pityPulls - profile.pityLeft) / catalog.pityPulls) * 100}%` }} />
              </span>
            </div>
            <button className="pull-btn one" onClick={() => void pull(1)}>
              <b>1回建造</b>
              <span>💎 {catalog.pullCost}</span>
            </button>
            <button className={`pull-btn ten ${profile.badges.freeTen ? 'free' : ''}`} onClick={() => void pull(10)}>
              {profile.badges.freeTen && <em className="free-tag">初回無料！</em>}
              <b>10連建造</b>
              <span>{profile.badges.freeTen ? '無料' : `💎 ${catalog.tenPullCost}`}</span>
              <small>SR以上1枠確定</small>
            </button>
            <button className="mini-btn" onClick={() => setRates(true)}>
              提供割合
            </button>
            <p className="gacha-note">同じ艦が出ると「限界突破」。レベル上限とステータスが上昇！★5 の艦が被ったときはコインに。</p>
          </section>
        </div>
      )}

      {phase === 'rolling' && (
        <div className={`gacha-roll l${orb}`} onClick={tapStage} style={{ ['--orb' as string]: ORB_COLOR[orb] }}>
          <div className="roll-bg" />
          {!omen && (
            <>
              <div ref={orbRef} className={`dock-light o${orb} ${upgrade ? 'crack' : ''}`}>
                <span className="orb" />
                <span className="orb-ring" />
                <span className="orb-ring two" />
              </div>
              <div className="step-pips">
                {plan?.levels.map((l, i) => <i key={i} className={i < step ? `on l${l}` : ''} />)}
              </div>
            </>
          )}
          {omen === 'alert' && (
            <div className="omen omen-alert">
              <i className="beacon" />
            </div>
          )}
          {omen === 'sonar' && (
            <div className={`omen omen-sonar ${(plan?.top ?? 0) >= 3 ? 'hot' : ''}`}>
              <i className="scope" />
              <i className="sweep" />
              <i className="ping" />
              <i className="ping two" />
              <i className="ping three" />
              <i className="contact" />
            </div>
          )}
          {omen === 'flood' && (
            <div className={`omen omen-flood ${(plan?.top ?? 0) >= 3 ? 'hot' : ''}`}>
              {[0, 1, 2, 3].map((k) => (
                <i key={k} className={`beam b${k}`} />
              ))}
            </div>
          )}
          {omen === 'glitch' && (
            <div className="omen omen-glitch">
              <i className="gate" />
            </div>
          )}
          <p className="tap-hint">TAP TO SKIP</p>
        </div>
      )}

      {(phase === 'reveal' || phase === 'cutin' || phase === 'summary' || phase === 'spotlight') && (
        <div className={`gacha-results ${tease !== null || hero !== null ? 'teasing' : ''}`} onClick={tapStage}>
          {phase === 'summary' && ssr + ur > 0 && (
            <div className={`haul ${ur ? 'ur' : ''} ${ssr + ur >= 2 ? 'multi' : ''}`}>
              {ssr + ur >= 2 && <em>{MULTI[ssr + ur] ?? 'MIRACLE!!!!!'}</em>}
              <b>
                {ur > 0 && <span>UR ×{ur}</span>}
                {ssr > 0 && <span>SSR ×{ssr}</span>}
                獲得！
              </b>
            </div>
          )}
          <div ref={deckRef} className={`result-cards n${gains.length}`}>
            {gains.map((g, i) => {
              const c = card(g.card)
              if (!c) return null
              const open = i < flipped
              return (
                <div key={i} ref={(el) => void (cardRefs.current[i] = el)} className={`flip ${open ? 'open' : ''} ${tease === i ? 'tease' : ''} ${hero === i ? 'hero' : ''} r${g.rarity}`}>
                  <div className="flip-inner">
                    <div className="flip-back">
                      <span>⚓</span>
                    </div>
                    <div className="flip-front">
                      <CardView look={lookOfCard(c)} size={gains.length === 1 ? 'lg' : 'md'} fresh={g.new} stars={g.stars} />
                      {!g.new && <span className="lb-tag">{g.coins ? `💰+${g.coins.toLocaleString()}` : `限界突破 ★${g.stars}`}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {phase === 'summary' && (
            <div className="gacha-again" onClick={(e) => e.stopPropagation()}>
              <button className="pill-btn ghost" onClick={() => setPhase('idle')}>
                建造トップへ
              </button>
              <button className="pill-btn" onClick={() => void pull(1)}>
                1回建造 💎{catalog.pullCost}
              </button>
              <button className="pill-btn gold pulse" onClick={() => void pull(10)}>
                もう一度10連 💎{catalog.tenPullCost}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'cutin' && spot !== null && spotGain && <CutIn key={spot} rarity={spotGain.rarity} onDone={() => turnOver(spot)} />}
      {phase === 'spotlight' && spot !== null && spotGain && spotCard && (
        <Spotlight key={spot} gain={spotGain} card={spotCard} onNext={() => reveal(gainsRef.current, spot + 1)} />
      )}

      {rates && (
        <Modal title="提供割合" onClose={() => setRates(false)}>
          <ul className="rates">
            {catalog.pullRates.map((w, r) => (
              <li key={r}>
                <RarityBadge r={r} />
                <b>{(w / 10).toFixed(1)}%</b>
                <span>{catalog.cards.filter((c) => c.rarity === r).map((c) => c.name).join('・')}</span>
              </li>
            ))}
          </ul>
          <p className="muted">10連建造は SR 以上が 1 枠確定。{catalog.pityPulls} 回以内に SSR 以上が必ず出現します。</p>
          <p className="muted">
            ★5 まで限界突破した艦が被ったときは、コインに交換されます（
            {catalog.overflowCoins.map((c, r) => `${rarityName(r)} 💰${c.toLocaleString()}`).join('・')}）。
          </p>
        </Modal>
      )}
    </div>
  )
}

/** The cut-in before a top-rarity card turns: the rarity slams onto a black screen letter by letter (UR's breaks the glass). */
function CutIn({ rarity, onDone }: { rarity: number; onDone: () => void }) {
  const ur = rarity >= 4
  const word = ur ? 'UR' : 'SSR'
  const timers = useRef<number[]>([])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
  const clear = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  const done = () => {
    clear()
    onDone()
  }

  useEffect(() => {
    later(0, () => audio.play('whoosh'))
    ;[...word].forEach((_, k) =>
      later(260 + k * 200, () => {
        audio.play('stamp')
        audio.buzz(30)
        fx.shake(10, 220)
        fx.punch(1.04, 200)
      }),
    )
    const end = 260 + word.length * 200 + 420
    if (ur)
      later(end - 140, () => {
        audio.play('shatter')
        fx.shatter(640, 360, 120, '#f3e6ff')
      })
    later(end, done)
    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`spotlight r${rarity} intro`} onClick={done}>
      <div className="spot-intro">
        <div className="intro-lines" />
        <div className="intro-slash" />
        <div className="intro-word">
          {[...word].map((ch, k) => (
            <b key={k} style={{ animationDelay: `${0.26 + k * 0.2}s` }}>
              {ch}
            </b>
          ))}
        </div>
        <small className="intro-sub">{ur ? 'ULTRA RARE' : 'SUPER RARE'}</small>
      </div>
      <p className="tap-hint">TAP</p>
    </div>
  )
}

/** The ship's own stage, once its card has turned and gone off: fireworks keep going over it. */
function Spotlight({ gain, card, onNext }: { gain: Gain; card: Card; onNext: () => void }) {
  const sk = SKILL_INFO[skillOf(card.class)]
  const ur = card.rarity >= 4
  const word = ur ? 'UR' : 'SSR'

  useEffect(() => {
    const timers: number[] = []
    const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms))
    audio.play('whoosh')
    fx.flash('#fff', 400, 0.6)
    fx.rays(410, 360, ur ? '#e0ccff' : '#fff2a8', 18, 1.6)
    fx.confetti(ur ? 120 : 80, ur ? PRISM : RAINBOW)
    for (let k = 0; k < (ur ? 8 : 5); k++)
      later(300 + k * 420, () => {
        fx.firework(rand(100, 1180), rand(70, 380), ur ? PRISM : RAINBOW)
        audio.play('star', { pitch: Math.floor(rand(-3, 6)) })
      })
    for (let k = 0; k < gain.stars; k++) later(900 + k * 160, () => audio.play('coin', { pitch: k * 2 }))
    if (gain.new)
      later(1500, () => {
        audio.play('stamp')
        fx.shake(8, 200)
      })
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const marquee = `${ur ? 'ULTRA RARE' : 'SUPER RARE'} ✦ ${card.name} ✦ `.repeat(6)

  return (
    <div className={`spotlight r${card.rarity} main`} onClick={onNext}>
      <div className="spot-glow" />
      <div className="spot-rays" />
      <div className="spot-rays two" />
      <div className="spot-bigword">{word}</div>
      <div className="spot-marquee top">
        <span>{marquee}</span>
        <span>{marquee}</span>
      </div>
      <div className="spot-marquee bottom">
        <span>{marquee}</span>
        <span>{marquee}</span>
      </div>
      <div className="spot-motes">
        {Array.from({ length: 16 }, (_, k) => (
          <i key={k} style={{ left: `${(k * 61) % 100}%`, animationDelay: `${(k * 0.37) % 3}s`, animationDuration: `${2.6 + (k % 5) * 0.5}s` }} />
        ))}
      </div>
      <div className="spot-art">
        <ShipArt look={lookOfCard(card)} showKanji={false} frame="full" motion staged />
        <i className="holo" />
      </div>
      <div className="spot-info">
        <span className={`spot-rarity r${card.rarity}`}>{rarityName(card.rarity)}</span>
        <small>
          {CLASS_INFO[card.class].name}・{card.title}
        </small>
        <h2 aria-label={card.name}>
          {[...card.name].map((ch, k) => (
            <span key={k} style={{ animationDelay: `${0.35 + k * 0.08}s` }}>
              {ch}
            </span>
          ))}
        </h2>
        <p className="spot-line">「{card.intro}」</p>
        <p className="spot-skill">
          {sk.icon} {sk.name}：{sk.desc}
        </p>
        {gain.new ? <span className="spot-new">NEW!</span> : <Stars n={gain.stars} />}
      </div>
      <p className="tap-hint">TAP</p>
    </div>
  )
}
