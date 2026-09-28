import { useEffect, useRef, useState } from 'react'
import type { Scene } from '../App'
import { api } from '../api'
import { audio } from '../audio'
import { ShipArt } from '../components/ShipArt'
import { CardView, Counter, RarityBadge, Stars } from '../components/ui'
import { fx, RAINBOW } from '../fx'
import { lookOfCard, RANK_TEXT, stageLabel } from '../game'
import { celebrateGrant, useGame } from '../state'
import type { Chest, GameView, Reward, Stage } from '../types'
import { nextStage } from './Home'
import { endlessStage } from './StageMap'

// Reveal beats: 0 intro, 1 rank, 2 stars, 3 lines, 4 exp, 5 ships/drop, 6 chests, 7 actions.
const BEATS = [300, 700, 1300, 1900, 2900, 3700, 4400]

export function ResultOverlay({
  gameId,
  game,
  stage,
  reward,
  onReward,
  onBoard,
  go,
}: {
  gameId: string
  game: GameView
  stage: Stage
  reward: Reward
  onReward: (r: Reward) => void
  onBoard: () => void
  go: (s: Scene) => void
}) {
  const { catalog, profile, card, setProfile, notify } = useGame()
  const [beat, setBeat] = useState(0)
  const [lines, setLines] = useState(0)
  const [levelUp, setLevelUp] = useState(false)
  const [opening, setOpening] = useState<number | null>(null)
  const timers = useRef<number[]>([])
  const rankRef = useRef<HTMLDivElement>(null)
  const chestRefs = useRef<(HTMLButtonElement | null)[]>([])
  const alreadyPicked = reward.picked >= 0

  const runFrom = (start: number) => {
    timers.current.forEach(clearTimeout)
    timers.current = BEATS.slice(start).map((ms, i) => window.setTimeout(() => enter(start + i + 1), ms - (BEATS[start - 1] ?? 0)))
  }

  const enter = (b: number) => {
    setBeat((cur) => Math.max(cur, b))
    if (b === 1) {
      audio.play('stamp')
      fx.shake(14)
      const c = fx.center(rankRef.current)
      if (reward.win) {
        fx.rays(c.x, c.y, reward.rank === 'S' ? '#fff2a8' : '#bfe9ff', 16, 1.6)
        fx.sparkle(c.x, c.y, '#fff6b0', 30, 200)
        if (reward.rank === 'S') fx.confetti(140, RAINBOW)
      }
    }
    if (b === 2) {
      ;[1, 2, 4].forEach((bit, i) => {
        if (reward.stars & bit) window.setTimeout(() => audio.play('star', { pitch: i * 2 }), i * 220)
      })
    }
    if (b === 3) {
      reward.lines.forEach((_, i) =>
        timers.current.push(
          window.setTimeout(() => {
            setLines(i + 1)
            audio.play(reward.lines[i].gems ? 'gem' : 'coin')
          }, i * 170),
        ),
      )
    }
    if (b === 4 && reward.levelUp) {
      timers.current.push(
        window.setTimeout(() => {
          setLevelUp(true)
          audio.play('levelup')
          fx.confetti(90, ['#7fe7ff', '#fff', '#ffd24a'])
          fx.rays(640, 360, '#bfe9ff', 16, 1.4)
        }, 700),
      )
    }
    if (b === 5 && reward.drop) {
      const r = reward.drop.rarity
      audio.play(r >= 3 ? 'ssr' : r >= 2 ? 'rare' : 'reveal')
      if (r >= 3) fx.flash('#fff', 400, 0.7)
    }
  }

  useEffect(() => {
    runFrom(0)
    return () => timers.current.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const skipAhead = () => {
    if (beat >= 6) return
    timers.current.forEach(clearTimeout)
    setLines(reward.lines.length)
    for (let b = beat + 1; b <= 6; b++) setBeat(b)
    if (reward.levelUp) setLevelUp(true)
    runFrom(6)
  }

  const pick = async (i: number) => {
    if (opening !== null || alreadyPicked) return
    setOpening(i)
    audio.play('roll')
    try {
      const [r] = await Promise.all([api.openChest(gameId, i), new Promise((ok) => setTimeout(ok, 1100))])
      onReward(r.reward)
      setProfile(r.profile)
      const c = r.chest
      audio.play(c.tier === 2 ? 'ssr' : 'chest')
      const el = chestRefs.current[i]
      const pt = fx.center(el)
      fx.rays(pt.x, pt.y, c.tier === 2 ? '#fff2a8' : '#bfe9ff', 12, 1)
      celebrateGrant(c.grant, el)
      if (c.tier === 2) fx.confetti(80)
      // The ones you didn't pick: show what you missed.
      const missed = r.reward.chests.some((ch, j) => j !== i && ch.tier === 2) && c.tier < 2
      if (missed) window.setTimeout(() => notify('惜しい！隣の宝箱が大当たりだった…！', 'gold'), 900)
    } catch (e) {
      notify((e as Error).message, 'error')
      setOpening(null)
    }
  }

  const next = () => {
    audio.play('select')
    if (!catalog || !profile) return go({ name: 'home' })
    if (stage.id === 'ex') return go({ name: 'sortie', stage: endlessStage(profile) })
    if (!reward.win) return go({ name: 'sortie', stage })
    const n = nextStage(catalog, profile)
    return go(n ? { name: 'sortie', stage: n } : { name: 'map', area: 5 })
  }

  const accuracy = reward.stats.shots ? Math.round((reward.stats.hits / reward.stats.shots) * 100) : 0
  const mvp = reward.mvp >= 0 ? game.playerShips[reward.mvp] : undefined
  const mvpCard = mvp ? card(mvp.key) : undefined
  const expPct = profile ? (reward.toExp / Math.max(1, profile.nextExp)) * 100 : 0
  const dropCard = reward.drop ? card(reward.drop.card) : undefined
  const campaign = stage.id !== 'ex'
  const nextLabel = !reward.win ? '再挑戦' : stage.id === 'ex' ? `第${(profile?.endless ?? 0) + 1}層へ` : '次の海域へ'

  return (
    <div className={`result ${reward.win ? 'win' : 'lose'} rank-${reward.rank}`} onClick={skipAhead}>
      <div className="result-bg" />
      <header className="result-head">
        <span className="result-en">{reward.win ? 'VICTORY' : 'DEFEAT'}</span>
        <h2>
          {stageLabel(stage)} {stage.name}
        </h2>
        {reward.streak >= 2 && <span className="streak-flag">🔥 {reward.streak} 連勝中！</span>}
        {reward.record && <span className="streak-flag record">最深記録更新！</span>}
      </header>

      <div className="result-grid">
        {/* ---- left: rank, stars, MVP ---- */}
        <div className="result-left">
          <div ref={rankRef} className={`rank rank-${reward.rank} ${beat >= 1 ? 'in' : ''}`}>
            <span className="rank-label">戦闘評価</span>
            <span className="rank-letter">{reward.rank}</span>
            <span className="rank-text">{RANK_TEXT[reward.rank]}</span>
          </div>
          {campaign && (
            <div className={`result-stars ${beat >= 2 ? 'in' : ''}`}>
              {[1, 2, 4].map((bit, i) => (
                <span key={bit} className={`rstar ${reward.stars & bit ? 'on' : ''} ${reward.newStars & bit ? 'new' : ''}`} style={{ animationDelay: `${i * 0.22}s` }}>
                  ★{reward.newStars & bit ? <em>NEW</em> : null}
                </span>
              ))}
            </div>
          )}
          {mvp && mvpCard && (
            <div className={`mvp ${beat >= 2 ? 'in' : ''}`}>
              <div className="mvp-art">
                <ShipArt look={lookOfCard(mvpCard)} showKanji={false} />
              </div>
              <div className="mvp-tag">
                <b>MVP</b>
                {mvpCard.name}
                <small>「{mvpCard.home[0]}」</small>
              </div>
            </div>
          )}
        </div>

        {/* ---- centre: rewards ---- */}
        <div className="result-center">
          <dl className={`result-stats ${beat >= 1 ? 'in' : ''}`}>
            <div>
              <dt>ターン</dt>
              <dd>{reward.turns}</dd>
            </div>
            <div>
              <dt>撃沈</dt>
              <dd>
                {reward.stats.sunk}
                <small>/{game.enemyShips.length}</small>
              </dd>
            </div>
            <div>
              <dt>命中率</dt>
              <dd>
                {accuracy}
                <small>%</small>
              </dd>
            </div>
            <div>
              <dt>最大コンボ</dt>
              <dd>{reward.stats.maxCombo}</dd>
            </div>
            <div>
              <dt>会心</dt>
              <dd>{reward.stats.crits}</dd>
            </div>
          </dl>

          <ul className={`reward-lines ${beat >= 3 ? 'in' : ''}`}>
            {reward.lines.slice(0, lines).map((l, i) => (
              <li key={i}>
                <span>{l.label}</span>
                {l.coins ? <b className="c">💰+{l.coins.toLocaleString()}</b> : null}
                {l.gems ? <b className="g">💎+{l.gems}</b> : null}
              </li>
            ))}
          </ul>
          <div className={`reward-total ${beat >= 3 ? 'in' : ''}`}>
            <span>
              💰 <Counter value={beat >= 3 ? reward.coins : 0} ms={900} tick />
            </span>
            <span>
              💎 <Counter value={beat >= 3 ? reward.gems : 0} ms={900} />
            </span>
            <span>
              EXP <Counter value={beat >= 3 ? reward.exp : 0} ms={900} />
            </span>
          </div>

          <div className={`admiral-exp ${beat >= 4 ? 'in' : ''}`}>
            <span className="lv">
              提督 Lv.<b>{beat >= 4 && levelUp ? reward.toLevel : reward.fromLevel}</b>
            </span>
            <span className="exp-track">
              <i style={{ width: beat >= 4 ? `${levelUp || !reward.levelUp ? expPct : 100}%` : `${(reward.fromExp / Math.max(1, profile?.nextExp ?? 1)) * 100}%` }} />
            </span>
            {levelUp && reward.levelUp && (
              <span className="levelup-pop">
                LEVEL UP!
                <small>
                  💎+{reward.levelUp.gems} 💰+{reward.levelUp.coins.toLocaleString()}
                </small>
              </span>
            )}
          </div>

          <ul className={`growth ${beat >= 5 ? 'in' : ''}`}>
            {reward.ships.map((g, i) => {
              const c = card(g.card)
              return (
                <li key={g.uid} style={{ animationDelay: `${i * 0.08}s` }}>
                  {c && <CardView look={lookOfCard(c)} size="xs" />}
                  <span className="growth-lv">
                    Lv.{g.to}
                    {g.to > g.from && <em>▲{g.to - g.from}</em>}
                  </span>
                  {g.mvp && <span className="growth-mvp">MVP</span>}
                </li>
              )
            })}
          </ul>
        </div>

        {/* ---- right: drop + chests ---- */}
        <div className="result-right">
          {reward.drop && dropCard && (
            <div className={`drop ${beat >= 5 ? 'in' : ''} r${reward.drop.rarity}`}>
              <span className="drop-label">DROP!</span>
              <CardView look={lookOfCard(dropCard)} size="md" fresh={reward.drop.new} stars={reward.drop.stars} />
              {!reward.drop.new && <span className="lb">限界突破 ★{reward.drop.stars}</span>}
            </div>
          )}
          <div className={`chests ${beat >= 6 ? 'in' : ''}`} onClick={(e) => e.stopPropagation()}>
            <p>{reward.picked >= 0 ? '宝箱の中身' : '宝箱をひとつ選べ！'}</p>
            <div className="chest-row">
              {(reward.picked >= 0 ? reward.chests : [0, 1, 2]).map((c, i) => {
                const ch = typeof c === 'number' ? undefined : (c as Chest)
                const picked = reward.picked === i
                return (
                  <button
                    key={i}
                    ref={(el) => void (chestRefs.current[i] = el)}
                    className={`chest ${opening === i && !ch ? 'shaking' : ''} ${ch ? `open t${ch.tier}` : ''} ${picked ? 'picked' : ''} ${ch && !picked ? 'missed' : ''}`}
                    disabled={reward.picked >= 0 || opening !== null}
                    onClick={() => void pick(i)}
                  >
                    <span className="chest-box">{ch ? (ch.tier === 2 ? '👑' : '🎁') : '🎁'}</span>
                    {ch && <ChestPrize chest={ch} />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <footer className={`result-actions ${beat >= 6 ? 'in' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button className="pill-btn ghost" onClick={onBoard}>
          盤面を確認
        </button>
        <button className="pill-btn" onClick={() => go({ name: 'home' })}>
          母港へ
        </button>
        <button className="pill-btn gold big pulse" onClick={next}>
          {nextLabel} ▶
        </button>
      </footer>
    </div>
  )
}

function ChestPrize({ chest }: { chest: Chest }) {
  const { card } = useGame()
  const g = chest.grant
  const c = g.cards?.[0] ? card(g.cards[0].card) : undefined
  return (
    <span className="chest-prize">
      {c ? (
        <>
          <RarityBadge r={c.rarity} /> {c.name}
        </>
      ) : g.gems ? (
        `💎${g.gems}`
      ) : (
        `💰${(g.coins ?? 0).toLocaleString()}`
      )}
      {g.cards?.[0] && !g.cards[0].new && g.cards[0].uid && <Stars n={g.cards[0].stars} />}
    </span>
  )
}
