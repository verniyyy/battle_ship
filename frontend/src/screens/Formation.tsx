import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { audio } from '../audio'
import { Backdrop, CardView, Counter, TopBar } from '../components/ui'
import { useDragScroll } from '../dragScroll'
import { fx } from '../fx'
import { CLASS_INFO, lookOfCard, usesLine } from '../game'
import { useGame } from '../state'
import type { Card, OwnedShip, ShipClass } from '../types'

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

// One card in a list of owned ships. It takes only plain values and a
// stable onPick, so a change to one ship (training, reassigning) re-renders
// that card rather than the whole list.
export const RosterCard = memo(function RosterCard({
  uid,
  card,
  level,
  stars,
  className,
  tag,
  secretary,
  showClass,
  onPick,
}: {
  uid: string
  card: Card
  level: number
  stars: number
  className?: string
  tag?: string
  secretary?: boolean
  showClass?: boolean
  onPick: (uid: string, el: Element) => void
}) {
  return (
    <CardView look={lookOfCard(card)} level={level} stars={stars} size="sm" lite className={className} onClick={(e) => onPick(uid, e.currentTarget)}>
      {tag && <span className="in-fleet-tag">{tag}</span>}
      {secretary && <span className="sec-tag">秘書</span>}
      {showClass && <span className="card-class-name">{CLASS_INFO[card.class].name}</span>}
    </CardView>
  )
})

export function ShipStatLine({ s }: { s: OwnedShip }) {
  const st = s.stats
  const weapon = st.air ? `航空 ${st.air}` : st.firepower ? `火力 ${st.firepower}` : `雷装 ${st.torpedo}`
  return (
    <span className="stat-line">
      <span>耐久 {st.hp}</span>
      <span>{weapon}</span>
      <span>速力 {st.speed}</span>
      <span>{usesLine(st, st.class)}</span>
    </span>
  )
}

export function Formation({ onBack }: { onBack: () => void }) {
  const { profile, card, setProfile, notify } = useGame()
  const [slot, setSlot] = useState(0)
  const [sort, setSort] = useState<Sort>('rarity')
  const [busy, setBusy] = useState(false)
  const strip = useDragScroll<HTMLDivElement>()
  const ships = useMemo(() => (profile ? sortShips(profile.ships, sort, (s) => card(s.card)?.rarity ?? 0) : []), [profile?.ships, sort, card])
  // The cards keep one handler; it reads the latest fleet and slot through this ref.
  const pickRef = useRef<(uid: string, el: Element) => void>(() => {})
  const pick = useCallback((uid: string, el: Element) => pickRef.current(uid, el), [])
  if (!profile) return null

  const fleet = profile.fleet
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
  pickRef.current = assign

  const remove = (i: number) => {
    if (fleet.length <= 1) return
    audio.play('back')
    void save(fleet.filter((_, j) => j !== i))
  }

  return (
    <div className="screen formation-screen">
      <Backdrop scene="standby" />
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
        <div className="roster-grid" ref={strip}>
          {ships.map((s) => {
            const c = card(s.card)
            if (!c) return null
            const at = fleet.indexOf(s.uid)
            return (
              <RosterCard
                key={s.uid}
                uid={s.uid}
                card={c}
                level={s.level}
                stars={s.stars}
                className={at >= 0 ? 'in-fleet' : ''}
                tag={at < 0 ? undefined : at === 0 ? '旗艦' : `${at + 1}番`}
                showClass
                onPick={pick}
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}
