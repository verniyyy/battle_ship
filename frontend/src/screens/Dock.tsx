import { useRef, useState } from 'react'
import { api } from '../api'
import { audio } from '../audio'
import { ShipArt } from '../components/ShipArt'
import { Backdrop, CardView, Counter, RarityBadge, Stars, TopBar } from '../components/ui'
import { fx } from '../fx'
import { CLASS_INFO, lookOfCard, SKILL_INFO } from '../game'
import { useGame } from '../state'
import type { Card, OwnedShip } from '../types'
import { skillOf, sortShips } from './Formation'

type Tab = 'roster' | 'book'

export function Dock({ onBack }: { onBack: () => void }) {
  const { profile, catalog, card } = useGame()
  const [tab, setTab] = useState<Tab>('roster')
  const [sel, setSel] = useState<string | null>(profile?.fleet[0] ?? null)
  if (!profile || !catalog) return null

  const owned = new Map(profile.ships.map((s) => [s.card, s]))
  const ships = sortShips(profile.ships, 'rarity', (s) => card(s.card)?.rarity ?? 0)
  const selShip = profile.ships.find((s) => s.uid === sel)
  const selCard = selShip ? card(selShip.card) : undefined
  const pct = Math.round((owned.size / catalog.cards.length) * 100)

  return (
    <div className="screen dock-screen">
      <Backdrop scene="standby" dim={0.6} />
      <TopBar title="艦隊" en="FLEET ROSTER" onBack={onBack} />

      <nav className="dock-tabs">
        <button className={tab === 'roster' ? 'on' : ''} onClick={() => setTab('roster')}>
          所持艦 <b>{profile.ships.length}</b>
        </button>
        <button className={tab === 'book' ? 'on' : ''} onClick={() => setTab('book')}>
          艦船図鑑 <b>{pct}%</b>
        </button>
      </nav>

      <section className="dock-list">
        {tab === 'roster' ? (
          <div className="roster-grid">
            {ships.map((s) => {
              const c = card(s.card)
              if (!c) return null
              return (
                <CardView
                  key={s.uid}
                  look={lookOfCard(c)}
                  level={s.level}
                  stars={s.stars}
                  size="sm"
                  className={s.uid === sel ? 'picked' : ''}
                  onClick={() => {
                    audio.play('tap')
                    setSel(s.uid)
                  }}
                >
                  {profile.fleet.includes(s.uid) && <span className="in-fleet-tag">編成中</span>}
                  {s.uid === profile.secretary && <span className="sec-tag">秘書</span>}
                </CardView>
              )
            })}
          </div>
        ) : (
          <>
            <div className="book-progress">
              <span>
                収集率 <b>{owned.size}</b>/{catalog.cards.length}
              </span>
              <span className="pity-track">
                <i style={{ width: `${pct}%` }} />
              </span>
            </div>
            <div className="roster-grid">
              {[...catalog.cards]
                .sort((a, b) => b.rarity - a.rarity)
                .map((c) => {
                  const s = owned.get(c.id)
                  return s ? (
                    <CardView
                      key={c.id}
                      look={lookOfCard(c)}
                      size="sm"
                      stars={s.stars}
                      onClick={() => {
                        audio.play('tap')
                        setSel(s.uid)
                      }}
                    />
                  ) : (
                    <div key={c.id} className={`card card-sm r${c.rarity} unknown`}>
                      <span className="unknown-mark">？</span>
                      <span className="card-top">
                        <RarityBadge r={c.rarity} />
                      </span>
                      <span className="card-name">{CLASS_INFO[c.class].name}</span>
                    </div>
                  )
                })}
            </div>
          </>
        )}
      </section>

      <aside className="dock-detail">{selShip && selCard ? <ShipDetail ship={selShip} card={selCard} /> : <p className="panel-hint">艦を選択</p>}</aside>
    </div>
  )
}

const STAT_MAX = { hp: 8, ammo: 12, skill: 6, crit: 60, evasion: 50 }

function ShipDetail({ ship, card }: { ship: OwnedShip; card: Card }) {
  const { profile, setProfile, notify } = useGame()
  const [line, setLine] = useState(card.intro)
  const [busy, setBusy] = useState(false)
  const artRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  if (!profile) return null
  const sk = SKILL_INFO[skillOf(card.class)]
  const capped = ship.level >= ship.maxLevel
  const afford = profile.coins >= ship.trainCost

  const train = async () => {
    if (busy || capped) return
    if (!afford) {
      notify('資金（💰）が足りません', 'error')
      return
    }
    setBusy(true)
    try {
      const r = await api.train(ship.uid)
      setProfile(r.profile)
      audio.play('coin', { pitch: 2 })
      window.setTimeout(() => audio.play('star', { pitch: Math.min(ship.level, 20) / 2 }), 60)
      const c = fx.center(artRef.current)
      fx.sparkle(c.x, c.y, card.color, 26, 160)
      fx.ring(c.x, c.y, card.color, 180, 0.5)
      const b = fx.center(btnRef.current)
      fx.sparkle(b.x, b.y, '#ffd24a', 10, 60)
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const makeSecretary = async () => {
    try {
      const r = await api.setSecretary(ship.uid)
      setProfile(r.profile)
      audio.play('heart')
      notify(`${card.name}を秘書艦に任命しました`, 'good')
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const stats: [string, number, number][] = [
    ['耐久', ship.stats.hp, STAT_MAX.hp],
    ['主砲', ship.stats.ammo, STAT_MAX.ammo],
    [`${sk.name}`, ship.stats.skill, STAT_MAX.skill],
    ['会心率', ship.stats.crit, STAT_MAX.crit],
    ['回避率', ship.stats.evasion, STAT_MAX.evasion],
  ]

  return (
    <div className={`ship-detail r${card.rarity}`} key={ship.uid}>
      <div
        className="detail-art"
        ref={artRef}
        onClick={() => {
          const all = [card.intro, card.attack, ...card.home]
          setLine(all[Math.floor(Math.random() * all.length)])
          audio.play('heart')
        }}
      >
        <ShipArt look={lookOfCard(card)} frame="full" />
        <p className="detail-line">「{line}」</p>
      </div>
      <div className="detail-head">
        <RarityBadge r={card.rarity} />
        <span className="detail-class" style={{ color: CLASS_INFO[card.class].color }}>
          {CLASS_INFO[card.class].name}
        </span>
        <h2>{card.name}</h2>
        <small>{card.title}</small>
        <Stars n={ship.stars} />
      </div>
      <div className="detail-level">
        <span>
          Lv.<b>{ship.level}</b>
          <small>/{ship.maxLevel}</small>
        </span>
        <span className="power">
          戦力 <Counter value={ship.power} />
        </span>
      </div>
      <ul className="detail-stats">
        {stats.map(([k, v, m]) => (
          <li key={k}>
            <span>{k}</span>
            <span className="stat-track">
              <i style={{ width: `${Math.min(100, (v / m) * 100)}%` }} />
            </span>
            <b>
              {v}
              {k.endsWith('率') ? '%' : ''}
            </b>
          </li>
        ))}
      </ul>
      <p className="detail-skill">
        {sk.icon} <b>{sk.name}</b> {sk.desc}
        {card.class === 'submarine' && <em>潜航：移動が敵に知られず、水しぶきにも映らない</em>}
      </p>
      <div className="detail-actions">
        <button ref={btnRef} className={`train-btn ${capped ? 'capped' : ''} ${afford ? '' : 'poor'}`} disabled={busy || capped} onClick={() => void train()}>
          {capped ? (
            <>
              <b>レベル上限</b>
              <small>限界突破で上限UP</small>
            </>
          ) : (
            <>
              <b>強化 Lv.{ship.level + 1}</b>
              <small>💰 {ship.trainCost.toLocaleString()}</small>
            </>
          )}
        </button>
        <button className="pill-btn ghost" disabled={profile.secretary === ship.uid} onClick={() => void makeSecretary()}>
          {profile.secretary === ship.uid ? '秘書艦' : '秘書艦に任命'}
        </button>
      </div>
      <p className="detail-hint">Lv10/30 で主砲+1、Lv15/40 で耐久+1、Lv25 でスキル+1。★2 耐久+1、★4 主砲+1、★5 スキル+1。</p>
    </div>
  )
}
