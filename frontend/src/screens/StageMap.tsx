import { useState } from 'react'
import type { Scene } from '../App'
import { audio } from '../audio'
import { Backdrop, RarityBadge, ShipToken, TopBar } from '../components/ui'
import { fx } from '../fx'
import { CLASS_INFO } from '../game'
import { useGame } from '../state'
import type { Catalog, Profile, Stage } from '../types'
import { nextStage } from './Home'

// Node positions on the chart (percent of the map box), zig-zagging to the boss.
const NODES = [
  { x: 14, y: 70 },
  { x: 38, y: 34 },
  { x: 62, y: 66 },
  { x: 84, y: 30 },
]

export function endlessStage(p: Profile): Stage {
  const floor = p.endless + 1
  return {
    id: 'ex',
    area: 5,
    no: floor,
    floor,
    name: `無限海域 第${floor}層`,
    brief: '果てなき深淵の海。どこまで潜れるか。5層ごとに旗艦が待ち受ける。',
    size: Math.min(5 + Math.floor(floor / 4), 7),
    maxTurns: 0,
    starTurns: 0,
    ai: 0,
    enemies: [],
    boss: floor % 5 === 0,
    coins: 800 + floor * 150,
    exp: 120 + floor * 20,
    firstGems: 0,
    dropRate: 0,
    dropWeights: [],
  }
}

export function StageMap({ area: initialArea, go }: { area?: number; go: (s: Scene) => void }) {
  const { profile, catalog } = useGame()
  const next = profile && catalog ? nextStage(catalog, profile) : null
  const [area, setArea] = useState(initialArea ?? next?.area ?? 1)
  const [selected, setSelected] = useState<Stage | null>(next && next.area === (initialArea ?? next.area) ? next : null)

  if (!profile || !catalog) return null

  const unlocked = (i: number) => i === 0 || (profile.stages[catalog.stages[i - 1].id] & 1) !== 0
  const endlessOpen = (profile.stages[catalog.stages[catalog.stages.length - 1].id] & 1) !== 0
  const stages = catalog.stages.filter((s) => s.area === area)
  const areaInfo = catalog.areas.find((a) => a.no === area)

  const pickArea = (n: number) => {
    audio.play('tap')
    setArea(n)
    setSelected(n === 5 ? endlessStage(profile) : null)
  }

  const pick = (s: Stage, el: HTMLElement) => {
    audio.play('select')
    const c = fx.center(el)
    fx.ring(c.x, c.y, '#9fe8ff', 60, 0.4)
    setSelected(s)
  }

  return (
    <div className={`screen map-screen theme-${area === 5 ? 'endless' : areaInfo?.theme}`}>
      <Backdrop scene="standby" />
      <TopBar title="出撃" en="SORTIE" onBack={() => go({ name: 'home' })} />

      <nav className="area-tabs">
        {catalog.areas.map((a) => {
          const first = catalog.stages.findIndex((s) => s.area === a.no)
          const open = unlocked(first)
          const stars = catalog.stages.filter((s) => s.area === a.no).reduce((n, s) => n + popcount(profile.stages[s.id] ?? 0), 0)
          return (
            <button key={a.no} className={`area-tab ${a.no === area ? 'on' : ''}`} disabled={!open} onClick={() => pickArea(a.no)}>
              <small>第{a.no}海域</small>
              <b>{open ? a.name : '？？？'}</b>
              <span className="area-stars">★{stars}/12</span>
            </button>
          )
        })}
        <button className={`area-tab endless ${area === 5 ? 'on' : ''}`} disabled={!endlessOpen} onClick={() => pickArea(5)}>
          <small>EX</small>
          <b>{endlessOpen ? '無限海域' : '4-4 突破で解放'}</b>
          {endlessOpen && <span className="area-stars">最深 {profile.endless}層</span>}
        </button>
      </nav>

      <section className="chart">
        {area === 5 ? (
          <div className="abyss">
            <div className="abyss-depth">
              <small>現在の最深記録</small>
              <b>{profile.endless}</b>
              <span>層</span>
            </div>
            <div className="abyss-ladder">
              {Array.from({ length: 6 }, (_, i) => profile.endless + 1 + i).map((f, i) => (
                <div key={f} className={`abyss-floor ${i === 0 ? 'next' : ''} ${f % 5 === 0 ? 'boss' : ''}`} style={{ opacity: 1 - i * 0.14 }}>
                  第{f}層{f % 5 === 0 && <em>旗艦</em>}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <svg className="route" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path
                d={NODES.map((n, i) => `${i ? 'L' : 'M'}${n.x},${n.y}`).join(' ')}
                fill="none"
                stroke="rgba(160,220,255,.6)"
                strokeWidth="0.6"
                strokeDasharray="1.6 1.4"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {stages.map((s, i) => {
              const idx = catalog.stages.indexOf(s)
              const open = unlocked(idx)
              const stars = profile.stages[s.id] ?? 0
              const isNext = next?.id === s.id
              return (
                <button
                  key={s.id}
                  className={`node ${open ? '' : 'locked'} ${s.boss ? 'boss' : ''} ${selected?.id === s.id ? 'on' : ''} ${isNext ? 'next' : ''} ${stars & 1 ? 'cleared' : ''}`}
                  style={{ left: `${NODES[i].x}%`, top: `${NODES[i].y}%`, animationDelay: `${i * 0.08}s` }}
                  disabled={!open}
                  onClick={(e) => pick(s, e.currentTarget)}
                >
                  <span className="node-core">{open ? (s.boss ? <BossMark /> : s.id) : '🔒'}</span>
                  <span className="node-name">{open ? s.name : '未解放'}</span>
                  <span className="node-stars">
                    {[1, 2, 4].map((bit) => (
                      <i key={bit} className={stars & bit ? 'on' : ''}>
                        ★
                      </i>
                    ))}
                  </span>
                  {isNext && <span className="node-next">NEXT</span>}
                </button>
              )
            })}
          </>
        )}
      </section>

      <aside className={`stage-panel ${selected ? 'open' : ''}`}>
        {selected ? (
          <StageDetail stage={selected} catalog={catalog} profile={profile} onGo={() => go({ name: 'sortie', stage: selected })} />
        ) : (
          <p className="panel-hint">海域を選択してください</p>
        )}
      </aside>
    </div>
  )
}

// BossMark is the horned skull that marks a flagship's lair on the chart.
function BossMark() {
  return (
    <svg className="boss-mark" viewBox="0 0 64 64" aria-label="BOSS">
      <path className="horn" d="M18 27C8 21 5 11 9 2c3 9 8 14 16 17z" />
      <path className="horn" d="M46 27c10-6 13-16 9-25-3 9-8 14-16 17z" />
      <path className="skull" d="M32 12c-13 0-20 9-20 19 0 7 3 11 7 13v7c0 2 2 4 4 4h18c2 0 4-2 4-4v-7c4-2 7-6 7-13 0-10-7-19-20-19z" />
      <path className="socket" d="M18 30l11 3-2 7c-5 0-9-4-9-10zM46 30l-11 3 2 7c5 0 9-4 9-10zM32 40l-2.5 5h5z" />
      <circle className="eye" cx="24" cy="35" r="2.3" />
      <circle className="eye" cx="40" cy="35" r="2.3" />
      <path className="teeth" d="M27 49v6M32 49v6M37 49v6" />
    </svg>
  )
}

function popcount(n: number) {
  let c = 0
  for (; n > 0; n >>= 1) c += n & 1
  return c
}

function StageDetail({ stage, catalog, profile, onGo }: { stage: Stage; catalog: Catalog; profile: Profile; onGo: () => void }) {
  const stars = profile.stages[stage.id] ?? 0
  const enemies = stage.enemies.map((k) => catalog.enemies.find((e) => e.key === k)!).filter(Boolean)
  const endless = stage.id === 'ex'
  const conditions = [
    { bit: 1, text: '勝利する' },
    { bit: 2, text: `${stage.starTurns}ターン以内に勝利` },
    { bit: 4, text: '1隻も失わずに勝利' },
  ]
  return (
    <div className="stage-detail" key={stage.id + stage.floor}>
      <header>
        <span className={`stage-id ${stage.boss ? 'boss' : ''}`}>{endless ? `EX-${stage.floor}` : stage.id}</span>
        <h2>{stage.name}</h2>
        {stage.boss && <span className="boss-tag">BOSS</span>}
      </header>
      <p className="stage-brief">{stage.brief}</p>
      <dl className="stage-facts">
        <div>
          <dt>海域</dt>
          <dd>
            {stage.size}×{stage.size}
          </dd>
        </div>
        {!endless && (
          <div>
            <dt>制限</dt>
            <dd>{stage.maxTurns}ターン</dd>
          </div>
        )}
        <div>
          <dt>報酬</dt>
          <dd>
            💰{stage.coins.toLocaleString()} / EXP {stage.exp}
          </dd>
        </div>
      </dl>
      {enemies.length > 0 && (
        <div className="enemy-lineup">
          <h3>敵艦隊</h3>
          <div className="lineup">
            {enemies.map((e, i) => (
              <span key={i} className={`lineup-ship ${e.boss ? 'boss' : ''}`} title={e.name}>
                <ShipToken look={{ cls: e.class, name: e.name, rarity: 0, color: CLASS_INFO[e.class].color, enemy: true, boss: e.boss }} no={i + 1} />
                <small>{e.name.replace('黒鉄', '')}</small>
              </span>
            ))}
          </div>
        </div>
      )}
      {!endless && (
        <ul className="star-goals">
          {conditions.map((c) => (
            <li key={c.bit} className={stars & c.bit ? 'done' : ''}>
              <i>★</i>
              {c.text}
              {!(stars & c.bit) && <em>💎{c.bit === 1 ? stage.firstGems : 50}</em>}
            </li>
          ))}
        </ul>
      )}
      {stage.dropWeights.some((w) => w > 0) && (
        <div className="drops">
          <span>ドロップ {stage.dropRate}%</span>
          {stage.dropWeights.map((w, r) => (w > 0 ? <RarityBadge key={r} r={r} /> : null))}
        </div>
      )}
      <button
        className="go-btn ready"
        onClick={() => {
          audio.play('select')
          onGo()
        }}
      >
        <span className="go-en">FORMATION</span>
        <span className="go-jp">出撃準備</span>
      </button>
    </div>
  )
}
