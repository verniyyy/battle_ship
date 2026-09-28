import { useEffect, useRef, useState } from 'react'
import type { Scene } from '../App'
import { api } from '../api'
import { audio } from '../audio'
import { ShipArt } from '../components/ShipArt'
import { Backdrop, Badge, Modal, TopBar } from '../components/ui'
import { fx } from '../fx'
import { lookOfCard, SKILL_INFO, CLASS_INFO, TIPS } from '../game'
import { celebrateGrant, useGame } from '../state'
import type { Catalog, GameSummary, Grant, Profile } from '../types'

type Dialog = 'record' | 'rules' | 'login' | null

export function nextStage(cat: Catalog, p: Profile) {
  const open = cat.stages.find((s, i) => !(p.stages[s.id] & 1) && (i === 0 || p.stages[cat.stages[i - 1].id] & 1))
  return open ?? null
}

export function Home({ go, onResume }: { go: (s: Scene) => void; onResume?: () => void }) {
  const { profile, catalog, card, setProfile, error, notify } = useGame()
  const [line, setLine] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [loginSeen, setLoginSeen] = useState(false)
  const lineTimer = useRef<number>(undefined)
  const artRef = useRef<HTMLButtonElement>(null)

  const sec = profile ? profile.ships.find((s) => s.uid === profile.secretary) ?? profile.ships[0] : undefined
  const secCard = sec ? card(sec.card) : undefined

  const say = (text: string) => {
    setLine(text)
    clearTimeout(lineTimer.current)
    lineTimer.current = window.setTimeout(() => setLine(null), 4200)
  }

  useEffect(() => {
    const t = window.setTimeout(() => secCard && say(secCard.home[0]), 800)
    return () => {
      clearTimeout(t)
      clearTimeout(lineTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secCard?.id])

  // Pop the login bonus once per visit.
  useEffect(() => {
    if (!profile?.badges.login || loginSeen) return
    const t = window.setTimeout(() => {
      setLoginSeen(true)
      setDialog('login')
    }, 900)
    return () => clearTimeout(t)
  }, [profile?.badges.login, loginSeen])

  if (!profile || !catalog) {
    return (
      <div className="screen home-screen">
        <Backdrop scene="home" />
        <p className={`center-msg ${error ? 'error' : ''}`}>{error ?? '司令部に接続中…'}</p>
      </div>
    )
  }

  const poke = () => {
    if (!secCard) return
    const lines = [...secCard.home, secCard.intro]
    say(lines[Math.floor(Math.random() * lines.length)])
    audio.play('heart')
    const c = fx.center(artRef.current)
    fx.sparkle(c.x, c.y - 80, '#ff9ad5', 10, 90)
  }

  const open = (d: Dialog) => {
    audio.play('select')
    setDialog(d)
  }

  const nav = (s: Scene) => {
    audio.play('select')
    go(s)
  }

  const next = nextStage(catalog, profile)
  const endless = !next
  const b = profile.badges

  return (
    <div className="screen home-screen">
      <Backdrop scene="home" dim={0.15} />
      <div className="home-vignette" />
      <TopBar />

      {/* ---- secretary ---- */}
      {sec && secCard && (
        <>
          <button className="secretary" onClick={poke} aria-label="秘書艦に話しかける" ref={artRef}>
            <ShipArt look={lookOfCard(secCard)} className="secretary-art" key={secCard.id} showKanji={false} frame="full" />
            <span className="secretary-plate">
              <small>{CLASS_INFO[secCard.class].name}</small>
              <b>{secCard.name}</b>
              <em>{secCard.title}</em>
            </span>
          </button>
          {line && (
            <div className="speech" key={line}>
              <span className="speech-name">{secCard.name}</span>
              {line}
            </div>
          )}
        </>
      )}

      {/* ---- status chips ---- */}
      <div className="home-chips">
        <span className="chip power">
          <small>艦隊戦力</small>
          <b>{profile.fleetPower.toLocaleString()}</b>
        </span>
        {profile.stats.streak >= 2 && (
          <span className="chip streak">
            🔥<b>{profile.stats.streak}</b>連勝中
          </span>
        )}
        <span className="chip stars">
          ★<b>{profile.totalStars}</b>/{catalog.stages.length * 3}
        </span>
      </div>

      {/* ---- main menu ---- */}
      <nav className="home-menu">
        {onResume && (
          <button
            className="resume-banner"
            onClick={() => {
              audio.play('select')
              onResume()
            }}
          >
            <b>⚔ 交戦中の海域があります</b>
            <span>タップで戦闘に戻る</span>
          </button>
        )}
        <button className="sortie-btn" onClick={() => nav({ name: 'map', area: next?.area })}>
          <span className="sortie-glow" />
          <span className="sortie-en">SORTIE</span>
          <span className="sortie-jp">出撃</span>
          <span className="sortie-next">{endless ? `無限海域 第${profile.endless + 1}層へ` : `次の海域 ${next.id}「${next.name}」`}</span>
          {next?.boss && <span className="sortie-boss">BOSS</span>}
        </button>
        <div className="menu-grid">
          <button className="menu-tile formation" onClick={() => nav({ name: 'formation' })}>
            <b>⚓</b>編成
          </button>
          <button className={`menu-tile gacha ${b.freeTen ? 'hot' : ''}`} onClick={() => nav({ name: 'gacha' })}>
            <b>🏗</b>建造
            <Badge text={b.freeTen ? '無料10連' : undefined} />
          </button>
          <button className="menu-tile dock" onClick={() => nav({ name: 'dock' })}>
            <b>📖</b>艦隊
          </button>
          <button className="menu-tile missions" onClick={() => nav({ name: 'missions' })}>
            <b>🎖</b>任務
            <Badge n={b.missions + b.achievements} />
          </button>
          <button className="menu-tile record" onClick={() => open('record')}>
            <b>📜</b>戦績
          </button>
          <button className={`menu-tile login ${b.login ? 'hot' : ''}`} onClick={() => open('login')}>
            <b>🎁</b>ログボ
            <Badge n={b.login} />
          </button>
          <button className="menu-tile rules" onClick={() => open('rules')}>
            <b>📘</b>要綱
          </button>
        </div>
      </nav>

      {b.freeTen && (
        <div className="home-callout" onClick={() => nav({ name: 'gacha' })}>
          <b>初回限定</b>無料10連建造を受け取ろう！
        </div>
      )}

      {/* ---- ticker ---- */}
      <div className="ticker">
        <span className="ticker-tag">司令部通達</span>
        <div className="ticker-track">
          <p>{TIPS.join(' ／ ')}</p>
        </div>
      </div>

      {dialog === 'record' && <RecordDialog profile={profile} onClose={() => setDialog(null)} />}
      {dialog === 'rules' && <RulesDialog onClose={() => setDialog(null)} />}
      {dialog === 'login' && (
        <LoginDialog
          profile={profile}
          rewards={catalog.loginRewards}
          onClaim={async (from) => {
            try {
              const r = await api.claimLogin()
              setProfile(r.profile)
              celebrateGrant(r.grant, from)
              return r.day
            } catch (e) {
              notify((e as Error).message, 'error')
              return null
            }
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function grantText(g: Grant) {
  const parts: string[] = []
  if (g.gems) parts.push(`💎${g.gems}`)
  if (g.coins) parts.push(`💰${g.coins.toLocaleString()}`)
  return parts.join(' ')
}

function LoginDialog({
  profile,
  rewards,
  onClaim,
  onClose,
}: {
  profile: Profile
  rewards: Grant[]
  onClaim: (from: Element | null) => Promise<number | null>
  onClose: () => void
}) {
  const ready = profile.badges.login
  const today = ready ? (profile.login.day % rewards.length) + 1 : profile.login.day
  const [stamped, setStamped] = useState(!ready)
  const cells = useRef<(HTMLDivElement | null)[]>([])

  const claim = async () => {
    const day = await onClaim(cells.current[today - 1])
    if (day) {
      setStamped(true)
      audio.play('stamp')
      fx.shake(6)
    }
  }

  return (
    <Modal title="ログインボーナス" onClose={onClose} wide className="login-modal">
      <p className="login-lead">
        通算ログイン <b>{profile.login.total + (ready && stamped ? 1 : 0)}</b> 日目 毎日受け取って豪華報酬をゲット！
      </p>
      <div className="login-grid">
        {rewards.map((g, i) => {
          const day = i + 1
          const done = day < today || (day === today && stamped)
          return (
            <div
              key={day}
              ref={(el) => void (cells.current[i] = el)}
              className={`login-cell ${day === today ? 'today' : ''} ${done ? 'done' : ''} ${day === 7 ? 'big' : ''}`}
            >
              <small>DAY {day}</small>
              <span className="login-ico">{g.gems && g.gems >= 300 ? '💎💎' : g.gems ? '💎' : '💰'}</span>
              <b>{grantText(g)}</b>
              {done && <span className="login-stamp">済</span>}
            </div>
          )
        })}
      </div>
      <div className="modal-actions">
        {ready && !stamped ? (
          <button className="pill-btn gold big" onClick={claim}>
            受け取る
          </button>
        ) : (
          <button className="pill-btn" onClick={onClose}>
            また明日！
          </button>
        )}
      </div>
    </Modal>
  )
}

function RecordDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [games, setGames] = useState<GameSummary[] | null>(null)
  useEffect(() => {
    api
      .history(20)
      .then((h) => setGames(h.games))
      .catch(() => setGames([]))
  }, [])
  const s = profile.stats
  const rate = s.battles ? Math.round((s.wins / s.battles) * 100) : 0
  return (
    <Modal title="戦績" onClose={onClose} wide>
      <div className="record-sum">
        <div>
          <span className="big">{s.battles}</span>出撃
        </div>
        <div className="win">
          <span className="big">{s.wins}</span>勝利
        </div>
        <div className="rate">
          <span className="big">{rate}</span>%
        </div>
        <div>
          <span className="big">{s.bestStreak}</span>最高連勝
        </div>
      </div>
      <div className="record-sum small">
        <div>
          <span className="big">{s.sunk}</span>撃沈
        </div>
        <div>
          <span className="big">{s.crits}</span>クリティカル
        </div>
        <div>
          <span className="big">{s.maxCombo}</span>最大コンボ
        </div>
        <div>
          <span className="big">{profile.endless}</span>無限最深
        </div>
      </div>
      {games === null ? (
        <p className="muted center">読み込み中…</p>
      ) : games.length ? (
        <ul className="record-list">
          {games.map((g) => (
            <li key={g.id} className={g.winner === 'player' ? 'win' : 'lose'}>
              <span className="rec-badge">{g.winner === 'player' ? '勝利' : '敗北'}</span>
              <span className="rec-stage">{g.stageId === 'ex' ? '無限海域' : g.stageId}</span>
              <span className={`rec-rank rank-${g.rank}`}>{g.rank}</span>
              <span>{new Date(g.finishedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span className="rec-turn">{g.turn} ターン</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted center">まだ戦績がありません。出撃しましょう！</p>
      )}
    </Modal>
  )
}

function RulesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="作戦要綱" onClose={onClose} wide>
      <ol className="rules">
        <li>
          <b>配置</b>編成した艦隊を海域に配置します。敵艦隊も同じ海域のどこかに潜んでいます。
        </li>
        <li>
          <b>行動</b>毎ターン 1 隻を選び、<em>砲撃</em>（周囲 8 マス）・<em>移動</em>（縦横に何マスでも）・<em>スキル</em>のいずれかを指示します。
        </li>
        <li>
          <b>報告</b>砲撃は「<em>命中</em>」「<em>水しぶき</em>（周囲に水上艦あり）」「外れ」で報告。命中した敵の位置はその後も追跡されます。
        </li>
        <li>
          <b>スキル</b>
          {Object.values(SKILL_INFO).map((s) => (
            <span key={s.name} className="rule-skill">
              {s.icon} <em>{s.name}</em> {s.desc}
            </span>
          ))}
        </li>
        <li>
          <b>決戦</b>命中・撃沈・被弾で決戦ゲージが溜まり、満タンで<em>全艦斉射</em>（3×3 を砲撃）が使えます。連続命中のコンボでゲージ加速！
        </li>
        <li>
          <b>勝敗</b>全艦撃沈、または攻撃手段が尽きた側の負け。ターン制限では残り耐久の割合で判定します。
        </li>
      </ol>
    </Modal>
  )
}
