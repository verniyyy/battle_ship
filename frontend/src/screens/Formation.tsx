import { useState } from 'react'
import { api } from '../api'
import { audio } from '../audio'
import { Backdrop, CardView, Counter, TopBar } from '../components/ui'
import { fx } from '../fx'
import { CLASS_INFO, lookOfCard, SKILL_INFO } from '../game'
import { useGame } from '../state'
import type { OwnedShip, ShipClass } from '../types'

type Sort = 'rarity' | 'level' | 'power' | 'class'
const CLASS_ORDER: ShipClass[] = ['battleship', 'cruiser', 'destroyer', 'submarine', 'carrier']

export function sortShips(ships: OwnedShip[], sort: Sort, rarityOf: (s: OwnedShip) => number) {
  const by: Record<Sort, (a: OwnedShip, b: OwnedShip) => number> = {
    rarity: (a, b) => rarityOf(b) - rarityOf(a) || b.power - a.power,
    level: (a, b) => b.level - a.level || b.power - a.power,
    power: (a, b) => b.power - a.power,
    class: (a, b) => CLASS_ORDER.indexOf(a.stats.class) - CLASS_ORDER.indexOf(b.stats.class) || b.power - a.power,
  }
  return [...ships].sort(by[sort])
}

export function ShipStatLine({ s }: { s: OwnedShip }) {
  const sk = SKILL_INFO[skillOf(s.stats.class)]
  return (
    <span className="stat-line">
      <span>耐久 {s.stats.hp}</span>
      <span>主砲 {s.stats.ammo}</span>
      <span>
        {sk.icon}
        {sk.name}×{s.stats.skill}
      </span>
      <span>会心 {s.stats.crit}%</span>
      <span>回避 {s.stats.evasion}%</span>
    </span>
  )
}

export const skillOf = (c: ShipClass) =>
  (({ battleship: 'barrage', cruiser: 'flare', destroyer: 'sonar', submarine: 'torpedo', carrier: 'airstrike' }) as const)[c]

export function Formation({ onBack }: { onBack: () => void }) {
  const { profile, card, setProfile, notify } = useGame()
  const [slot, setSlot] = useState(0)
  const [sort, setSort] = useState<Sort>('rarity')
  const [busy, setBusy] = useState(false)
  if (!profile) return null

  const fleet = profile.fleet
  const ships = sortShips(profile.ships, sort, (s) => card(s.card)?.rarity ?? 0)
  const byUid = (uid: string) => profile.ships.find((s) => s.uid === uid)

  const save = async (next: string[], el?: Element | null) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await api.setFleet(next)
      setProfile(r.profile)
      audio.play('select')
      if (el) {
        const c = fx.center(el)
        fx.sparkle(c.x, c.y, '#9fe8ff', 14, 100)
      }
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const assign = (uid: string, el: Element) => {
    const next = [...fleet]
    const at = next.indexOf(uid)
    if (slot < next.length) {
      if (at >= 0) [next[at], next[slot]] = [next[slot], next[at]]
      else next[slot] = uid
    } else if (at < 0) {
      next.push(uid)
    } else return
    void save(next, el)
    setSlot(Math.min(slot + 1, profile.fleetSlots - 1))
  }

  const remove = (i: number) => {
    if (fleet.length <= 1) return
    audio.play('back')
    void save(fleet.filter((_, j) => j !== i))
  }

  return (
    <div className="screen formation-screen">
      <Backdrop scene="standby" dim={0.55} />
      <TopBar title="編成" en="FORMATION" onBack={onBack} />

      <section className="slots">
        {Array.from({ length: 4 }, (_, i) => {
          const s = fleet[i] ? byUid(fleet[i]) : undefined
          const c = s ? card(s.card) : undefined
          const locked = i >= profile.fleetSlots
          return (
            <div
              key={i}
              className={`slot ${slot === i ? 'on' : ''} ${locked ? 'locked' : ''}`}
              onClick={() => {
                if (locked) return
                audio.play('tap')
                setSlot(i)
              }}
            >
              <span className="slot-no">{i === 0 ? '旗艦' : `${i + 1}番艦`}</span>
              {locked ? (
                <span className="slot-lock">🔒 提督Lv4で解放</span>
              ) : s && c ? (
                <>
                  <CardView look={lookOfCard(c)} level={s.level} stars={s.stars} size="md" />
                  <span className="slot-power">戦力 {s.power.toLocaleString()}</span>
                  <ShipStatLine s={s} />
                  {fleet.length > 1 && (
                    <button
                      className="slot-remove"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(i)
                      }}
                      aria-label="外す"
                    >
                      ✕
                    </button>
                  )}
                </>
              ) : (
                <span className="slot-empty">＋ 艦を選択</span>
              )}
            </div>
          )
        })}
        <div className="fleet-power">
          <small>艦隊戦力</small>
          <Counter value={profile.fleetPower} className="power-num" />
        </div>
      </section>

      <section className="roster">
        <header className="roster-head">
          <span>
            所持艦 <b>{profile.ships.length}</b> 隻 — {slot + 1}番目の枠に配属する艦をタップ
          </span>
          <div className="sort-tabs">
            {(['rarity', 'level', 'power', 'class'] as Sort[]).map((k) => (
              <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
                {{ rarity: 'レア度', level: 'レベル', power: '戦力', class: '艦種' }[k]}
              </button>
            ))}
          </div>
        </header>
        <div className="roster-grid">
          {ships.map((s) => {
            const c = card(s.card)
            if (!c) return null
            const at = fleet.indexOf(s.uid)
            return (
              <CardView key={s.uid} look={lookOfCard(c)} level={s.level} stars={s.stars} size="sm" onClick={(e) => assign(s.uid, e.currentTarget)} className={at >= 0 ? 'in-fleet' : ''}>
                {at >= 0 && <span className="in-fleet-tag">{at === 0 ? '旗艦' : `${at + 1}番`}</span>}
                <span className="card-class-name">{CLASS_INFO[c.class].name}</span>
              </CardView>
            )
          })}
        </div>
      </section>
    </div>
  )
}
