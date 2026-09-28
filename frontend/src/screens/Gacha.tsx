import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { audio } from '../audio'
import { ShipArt } from '../components/ShipArt'
import { Backdrop, CardView, Modal, RarityBadge, Stars, TopBar } from '../components/ui'
import { fx, RAINBOW } from '../fx'
import { CLASS_INFO, lookOfCard, rarityName, SKILL_INFO } from '../game'
import { useGame } from '../state'
import type { Card, Gain } from '../types'
import { skillOf } from './Formation'

type Phase = 'idle' | 'rolling' | 'reveal' | 'spotlight' | 'summary'

const ORB_COLOR = ['#8fb8ff', '#4fc3ff', '#ffcf4a', 'rainbow', 'prism'] as const

export function Gacha({ onBack }: { onBack: () => void }) {
  const { profile, catalog, card, setProfile, notify } = useGame()
  const [phase, setPhase] = useState<Phase>('idle')
  const [gains, setGains] = useState<Gain[]>([])
  const [flipped, setFlipped] = useState(0)
  const [orb, setOrb] = useState(0)
  const [upgrade, setUpgrade] = useState(false)
  const [spot, setSpot] = useState<Gain | null>(null)
  const [rates, setRates] = useState(false)
  const [showcase, setShowcase] = useState(0)
  const timers = useRef<number[]>([])
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const spotQueue = useRef<number[]>([])
  // Timers outlive renders, so they read the pulled ships from a ref.
  const gainsRef = useRef<Gain[]>([])

  const featured = catalog?.cards.filter((c) => c.rarity >= 3) ?? []

  useEffect(() => {
    const t = window.setInterval(() => setShowcase((s) => s + 1), 3200)
    return () => {
      clearInterval(t)
      timers.current.forEach(clearTimeout)
    }
  }, [])

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

  const start = (gs: Gain[]) => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    gainsRef.current = gs
    setGains(gs)
    setFlipped(0)
    setSpot(null)
    const best = Math.max(...gs.map((g) => g.rarity))
    // Fake-out: an SSR+ sometimes glows gold first, then cracks open to rainbow.
    const fake = best >= 3 && Math.random() < 0.45
    setUpgrade(false)
    setOrb(fake ? 2 : Math.min(best, 2))
    setPhase('rolling')
    audio.play('roll')
    fx.shake(4, 1600)
    later(1300, () => {
      if (best >= 2 && !fake) {
        setOrb(best)
        audio.play(best >= 3 ? 'ssr' : 'rare')
        fx.flash(best >= 3 ? '#fff' : '#ffe39a', 500, 0.7)
        if (best >= 3) fx.rays(640, 360, '#fff2a8', 18, 1.6)
      }
    })
    if (fake) {
      later(1900, () => {
        setUpgrade(true)
        audio.play('bigboom')
        fx.shake(18, 500)
      })
      later(2300, () => {
        setOrb(best)
        audio.play('ssr')
        fx.flash('#fff', 700, 0.95)
        fx.rays(640, 360, '#fff2a8', 20, 2)
        fx.confetti(120, RAINBOW)
      })
    }
    later(fake ? 3300 : 2500, () => reveal(gs))
  }

  const reveal = (gs: Gain[]) => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setPhase('reveal')
    spotQueue.current = gs.map((g, i) => (g.rarity >= 3 ? i : -1)).filter((i) => i >= 0)
    gs.forEach((g, i) => {
      later(220 + i * 170, () => {
        setFlipped(i + 1)
        const pt = fx.center(cardRefs.current[i])
        if (g.rarity >= 2) {
          fx.rays(pt.x, pt.y, g.rarity >= 3 ? '#fff2a8' : '#ffe39a', 8, 0.8)
          fx.sparkle(pt.x, pt.y, g.rarity >= 3 ? '#fff' : '#ffd24a', 20, 120)
          audio.play(g.rarity >= 3 ? 'gem' : 'rare')
        } else audio.play('tap')
      })
    })
    later(400 + gs.length * 170, () => nextSpot())
  }

  const nextSpot = () => {
    const i = spotQueue.current.shift()
    if (i === undefined) {
      setSpot(null)
      setPhase('summary')
      return
    }
    setSpot(gainsRef.current[i] ?? null)
    setPhase('spotlight')
    audio.play('ssr')
    fx.flash('#fff', 600, 0.9)
    fx.rays(640, 330, '#fff2a8', 20, 2.2)
    fx.confetti(100, RAINBOW)
  }

  // Tapping during the show jumps ahead.
  const tapStage = () => {
    if (phase === 'rolling') reveal(gainsRef.current)
    else if (phase === 'reveal') {
      timers.current.forEach(clearTimeout)
      timers.current = []
      setFlipped(gainsRef.current.length)
      nextSpot()
    } else if (phase === 'spotlight') nextSpot()
  }

  const feat = featured[showcase % Math.max(1, featured.length)]
  const spotCard = spot ? card(spot.card) : undefined

  return (
    <div className={`screen gacha-screen phase-${phase}`}>
      <Backdrop scene="standby" dim={0.6} />
      <TopBar title="建造" en="CONSTRUCTION" onBack={phase === 'idle' || phase === 'summary' ? onBack : undefined} />

      {phase === 'idle' && (
        <div className="gacha-lobby">
          <section className="banner-art">
            {feat && (
              <div className="banner-feature" key={feat.id}>
                <ShipArt look={lookOfCard(feat)} showKanji={false} frame="full" />
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
            <div className="banner-dots">
              {featured.map((f, i) => (
                <i key={f.id} className={i === showcase % featured.length ? 'on' : ''} />
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
            <p className="gacha-note">同じ艦が出ると「限界突破」。レベル上限とステータスが上昇！</p>
          </section>
        </div>
      )}

      {phase === 'rolling' && (
        <div className="gacha-roll" onClick={tapStage}>
          <div className={`dock-light o${orb} ${upgrade ? 'crack' : ''}`} style={{ ['--orb' as string]: typeof ORB_COLOR[orb] === 'string' && ORB_COLOR[orb].startsWith('#') ? ORB_COLOR[orb] : undefined }}>
            <span className="orb" />
            <span className="orb-ring" />
            <span className="orb-ring two" />
          </div>
          <p className="roll-text">{upgrade ? '！？' : orb >= 3 ? '確定！！' : '建造中…'}</p>
          <p className="tap-hint">TAP TO SKIP</p>
        </div>
      )}

      {(phase === 'reveal' || phase === 'summary' || phase === 'spotlight') && (
        <div className="gacha-results" onClick={tapStage}>
          <div className={`result-cards n${gains.length}`}>
            {gains.map((g, i) => {
              const c = card(g.card)
              if (!c) return null
              const open = i < flipped
              return (
                <div key={i} ref={(el) => void (cardRefs.current[i] = el)} className={`flip ${open ? 'open' : ''} r${g.rarity}`}>
                  <div className="flip-inner">
                    <div className="flip-back">
                      <span>⚓</span>
                    </div>
                    <div className="flip-front">
                      <CardView look={lookOfCard(c)} size={gains.length === 1 ? 'lg' : 'md'} fresh={g.new} stars={g.stars} />
                      {!g.new && <span className="lb-tag">{g.gems ? `💎+${g.gems}` : `限界突破 ★${g.stars}`}</span>}
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

      {phase === 'spotlight' && spot && spotCard && <Spotlight gain={spot} card={spotCard} onNext={nextSpot} />}

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
        </Modal>
      )}
    </div>
  )
}

function Spotlight({ gain, card, onNext }: { gain: Gain; card: Card; onNext: () => void }) {
  const sk = SKILL_INFO[skillOf(card.class)]
  return (
    <div className={`spotlight r${card.rarity}`} onClick={onNext}>
      <div className="spot-rays" />
      <div className="spot-art">
        <ShipArt look={lookOfCard(card)} showKanji={false} frame="full" />
      </div>
      <div className="spot-info">
        <span className={`spot-rarity r${card.rarity}`}>{rarityName(card.rarity)}</span>
        <small>
          {CLASS_INFO[card.class].name}・{card.title}
        </small>
        <h2>{card.name}</h2>
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
