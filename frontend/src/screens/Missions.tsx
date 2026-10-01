import { useState } from 'react'
import { api } from '../api'
import { audio } from '../audio'
import { Backdrop, Badge, TopBar } from '../components/ui'
import { celebrateGrant, useGame } from '../state'
import type { Mission, Profile } from '../types'

type Tab = 'daily' | 'achievements'

function achievementValue(p: Profile, stat: string): number {
  switch (stat) {
    case 'wins':
      return p.stats.wins
    case 'sunk':
      return p.stats.sunk
    case 'crits':
      return p.stats.crits
    case 'combo':
      return p.stats.maxCombo
    case 'ultimates':
      return p.stats.ultimates
    case 'pulls':
      return p.gacha.pulls
    case 'collection':
      return p.ships.length
    case 'stars':
      return p.totalStars
    case 'level':
      return p.level
    case 'endless':
      return p.endless
    case 'friends':
      return p.stats.peakFriends ?? 0
    case 'cheers':
      return p.stats.cheers ?? 0
  }
  return 0
}

export function Missions({ onBack }: { onBack: () => void }) {
  const { profile, catalog, setProfile, notify } = useGame()
  const [tab, setTab] = useState<Tab>('daily')
  const [busy, setBusy] = useState(false)
  if (!profile || !catalog) return null

  const daily = [...catalog.missions, catalog.dailyAll]
  const dailyDone = catalog.missions.filter((m) => !m.extra && profile.daily.claimed[m.id]).length
  const progress = (m: Mission) =>
    tab === 'daily' ? (m.id === catalog.dailyAll.id ? dailyDone : (profile.daily.progress[m.stat] ?? 0)) : achievementValue(profile, m.stat)
  const claimed = (m: Mission) => (tab === 'daily' ? !!profile.daily.claimed[m.id] : !!profile.achievements[m.id])

  // Achievements: show the next unclaimed tier of each chain, plus claimable ones.
  const chains = new Map<string, Mission[]>()
  for (const a of catalog.achievements) chains.set(a.stat, [...(chains.get(a.stat) ?? []), a])
  const achList = [...chains.values()].flatMap((tiers) => {
    const ready = tiers.filter((t) => !profile.achievements[t.id] && achievementValue(profile, t.stat) >= t.goal)
    const next = tiers.find((t) => !profile.achievements[t.id] && achievementValue(profile, t.stat) < t.goal)
    return [...ready, ...(next ? [next] : [])]
  })

  const list = (tab === 'daily' ? daily : achList).slice().sort((a, b) => {
    const rank = (m: Mission) => (claimed(m) ? 2 : progress(m) >= m.goal ? 0 : 1)
    return rank(a) - rank(b)
  })
  const ready = list.filter((m) => !claimed(m) && progress(m) >= m.goal)

  const claim = async (m: Mission, el: Element | null) => {
    const r = tab === 'daily' ? await api.claimMission(m.id) : await api.claimAchievement(m.id)
    setProfile(r.profile)
    celebrateGrant(r.grant, el)
  }

  const claimOne = async (m: Mission, el: Element | null) => {
    if (busy) return
    setBusy(true)
    try {
      await claim(m, el)
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const claimAll = async () => {
    if (busy) return
    setBusy(true)
    try {
      for (const m of ready) {
        await claim(m, document.querySelector(`[data-mission="${m.id}"]`))
        await new Promise((r) => setTimeout(r, 140))
      }
      // The all-clear daily bonus may have just unlocked.
      audio.play('levelup')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen missions-screen">
      <Backdrop scene="standby" />
      <TopBar title="任務" en="MISSIONS" onBack={onBack} />
      <nav className="dock-tabs">
        <button className={tab === 'daily' ? 'on' : ''} onClick={() => setTab('daily')}>
          デイリー任務
          <Badge n={profile.badges.missions} />
        </button>
        <button className={tab === 'achievements' ? 'on' : ''} onClick={() => setTab('achievements')}>
          勲功（実績）
          <Badge n={profile.badges.achievements} />
        </button>
        {tab === 'daily' && <span className="reset-note">毎日 0:00 にリセット</span>}
        <button className="pill-btn gold claim-all" disabled={!ready.length || busy} onClick={() => void claimAll()}>
          一括受取 {ready.length > 0 && `(${ready.length})`}
        </button>
      </nav>
      <ul className="mission-list">
        {list.map((m, i) => {
          const p = Math.min(progress(m), m.goal)
          const done = claimed(m)
          const can = !done && p >= m.goal
          return (
            <li key={m.id} data-mission={m.id} className={`mission ${done ? 'done' : ''} ${can ? 'ready' : ''} ${m.id === catalog.dailyAll.id ? 'all' : ''}`} style={{ animationDelay: `${i * 0.04}s` }}>
              <div className="mission-main">
                <b>{m.title}</b>
                <span className="mission-track">
                  <i style={{ width: `${(p / m.goal) * 100}%` }} />
                </span>
                <small>
                  {p}/{m.goal}
                </small>
              </div>
              <span className="mission-reward">
                {m.gems ? `💎${m.gems}` : ''}
                {m.coins ? `💰${m.coins.toLocaleString()}` : ''}
              </span>
              <button className="claim-btn" disabled={!can || busy} onClick={(e) => void claimOne(m, e.currentTarget)}>
                {done ? '受取済' : can ? '受け取る' : '未達成'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
