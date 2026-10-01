import { useEffect, useRef, useState } from 'react'
import type { Scene } from '../App'
import { api } from '../api'
import { audio } from '../audio'
import { PortraitImg, ShipArt } from '../components/ShipArt'
import { Backdrop, Badge, Modal, ResumeBanner, TopBar } from '../components/ui'
import { fx } from '../fx'
import { markNewsSeen, NEWS, unreadNews } from '../news'
import { lookOfCard, SKILL_INFO, SPECIAL_INFO, CLASS_INFO, TIPS, TORPEDO_INFO } from '../game'
import { celebrateGrant, useGame } from '../state'
import { portraitOf, useAssets } from '../theme'
import type { Catalog, GameSummary, Gift, Grant, MatchResponse, Profile } from '../types'

type Dialog = 'record' | 'rules' | 'login' | 'profile' | 'news' | 'gifts' | null

export function nextStage(cat: Catalog, p: Profile) {
  const open = cat.stages.find((s, i) => !(p.stages[s.id] & 1) && (i === 0 || p.stages[cat.stages[i - 1].id] & 1))
  return open ?? null
}

export function Home({ go, resumable, onResume }: { go: (s: Scene) => void; resumable: MatchResponse | null; onResume?: () => void }) {
  const { profile, catalog, card, setProfile, error, notify, session } = useGame()
  const [line, setLine] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [loginSeen, setLoginSeen] = useState(false)
  const [unread, setUnread] = useState(() => unreadNews().length)
  const [newsShown, setNewsShown] = useState(false)
  const [gifts, setGifts] = useState<Gift[]>([])
  const [giftsShown, setGiftsShown] = useState(false)
  const lineTimer = useRef<number>(undefined)
  const artRef = useRef<HTMLButtonElement>(null)

  const sec = profile ? profile.ships.find((s) => s.uid === profile.secretary) ?? profile.ships[0] : undefined
  const secCard = sec ? card(sec.card) : undefined

  // A one-off gesture on the figure, layered over its CSS breathing on the
  // translate property, which the idle animation leaves free.
  const gesture = (kind: 'hop' | 'nod') => {
    const img = artRef.current?.querySelector<HTMLElement>('.art-portrait')
    if (!img?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const frames: Keyframe[] =
      kind === 'hop'
        ? [{ translate: '0 0' }, { translate: '0 -4%', offset: 0.35 }, { translate: '0 0.6%', offset: 0.7 }, { translate: '0 0' }]
        : [{ translate: '0 0' }, { translate: '0 1.2%', offset: 0.4 }, { translate: '0 0' }]
    img.animate(frames, { duration: kind === 'hop' ? 520 : 600, easing: 'ease-out' })
  }

  const say = (text: string) => {
    gesture('nod')
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

  // Pop unread news once per visit, after the login bonus has had its turn.
  const loginPending = !!profile?.badges.login && !loginSeen
  useEffect(() => {
    if (!profile || !unread || newsShown || loginPending || dialog) return
    const t = window.setTimeout(() => {
      setNewsShown(true)
      setDialog('news')
    }, 900)
    return () => clearTimeout(t)
  }, [profile, unread, newsShown, loginPending, dialog])

  useEffect(() => {
    api
      .gifts()
      .then((r) => setGifts(r.gifts))
      .catch(() => setGifts([]))
  }, [])

  // Gifts from the operators pop up once per visit, after the bonus and the news.
  const newsPending = !!unread && !newsShown
  useEffect(() => {
    if (!profile || !gifts.length || giftsShown || loginPending || newsPending || dialog) return
    const t = window.setTimeout(() => {
      setGiftsShown(true)
      setDialog('gifts')
    }, 900)
    return () => clearTimeout(t)
  }, [profile, gifts.length, giftsShown, loginPending, newsPending, dialog])

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
    gesture('hop')
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
      <Backdrop scene="home" />
      <div className="home-vignette" />
      <TopBar onAdmiral={() => open('profile')} />

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
        {session?.admin && (
          <button className="chip admin" onClick={() => nav({ name: 'admin' })}>
            🛠<b>管理</b>
          </button>
        )}
      </div>

      {/* ---- main menu ---- */}
      <nav className="home-menu">
        <ResumeBanner match={resumable} onResume={onResume} />
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
          <button className={`menu-tile news ${unread ? 'hot' : ''}`} onClick={() => open('news')}>
            <b>📰</b>お知らせ
            <Badge n={unread} />
          </button>
        </div>
        {gifts.length > 0 && (
          <button className="gift-banner" onClick={() => open('gifts')}>
            <span className="gift-ico">🎀</span>
            <span>
              運営から<b>贈り物</b>が届いています
            </span>
            <Badge n={gifts.length} />
          </button>
        )}
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
          <p>{[...(NEWS[0] ? [`【${NEWS[0].date.replaceAll('-', '/')} 更新】${NEWS[0].title}`] : []), ...TIPS].join(' ／ ')}</p>
        </div>
      </div>

      {dialog === 'profile' && <ProfileDialog profile={profile} onClose={() => setDialog(null)} />}
      {dialog === 'record' && <RecordDialog profile={profile} onClose={() => setDialog(null)} />}
      {dialog === 'rules' && <RulesDialog onClose={() => setDialog(null)} />}
      {dialog === 'news' && (
        <NewsDialog
          unread={unread}
          onClose={() => {
            markNewsSeen()
            setUnread(0)
            setNewsShown(true)
            setDialog(null)
          }}
        />
      )}
      {dialog === 'gifts' && (
        <GiftDialog
          gifts={gifts}
          onClaim={async (id, from) => {
            try {
              const r = await api.claimGifts(id)
              setProfile(r.profile)
              const got = new Set(r.claimed.map((c) => c.gift.id))
              setGifts((gs) => gs.filter((g) => !got.has(g.id)))
              const sum = (k: 'gems' | 'coins') => r.claimed.reduce((n, c) => n + (c.grant[k] ?? 0), 0)
              for (const c of r.claimed) {
                for (const g of c.grant.cards ?? []) {
                  const name = card(g.card)?.name ?? g.card
                  notify(g.new ? `新しい艦「${name}」が着任しました！` : `「${name}」が限界突破しました（★${g.stars}）`, 'gold')
                }
              }
              celebrateGrant({ gems: sum('gems'), coins: sum('coins') }, from)
              audio.play('stamp')
            } catch (e) {
              notify((e as Error).message, 'error')
              // Something may have changed meanwhile (stopped, or claimed elsewhere).
              api
                .gifts()
                .then((g) => setGifts(g.gifts))
                .catch(() => {})
            }
          }}
          onClose={() => setDialog(null)}
        />
      )}
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

/** The gift box: the operators' presents waiting to be collected. */
function GiftDialog({ gifts, onClaim, onClose }: { gifts: Gift[]; onClaim: (id: string | undefined, from: Element | null) => Promise<void>; onClose: () => void }) {
  const { card } = useGame()
  const [busy, setBusy] = useState(false)
  const claim = async (id: string | undefined, from: Element | null) => {
    if (busy) return
    setBusy(true)
    await onClaim(id, from)
    setBusy(false)
  }
  return (
    <Modal title="贈り物" onClose={onClose} wide className="gift-modal">
      {gifts.length ? (
        <ul className="gift-list">
          {gifts.map((g) => (
            <li key={g.id} data-gift={g.id}>
              <div className="gift-main">
                <h3>{g.title}</h3>
                {g.message && <p>{g.message}</p>}
                <div className="gift-contents">
                  {!!g.gems && <span className="gift-item gems">💎{g.gems.toLocaleString()}</span>}
                  {!!g.coins && <span className="gift-item coins">💰{g.coins.toLocaleString()}</span>}
                  {g.cards?.map((c, i) => (
                    <span key={i} className="gift-item card">
                      ⚓{card(c)?.name ?? c}
                    </span>
                  ))}
                </div>
                <small className="gift-deadline">{new Date(g.endsAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })} まで</small>
              </div>
              <button className="claim-btn" disabled={busy} onClick={(e) => void claim(g.id, e.currentTarget)}>
                受け取る
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted center">受け取れる贈り物はありません</p>
      )}
      <div className="modal-actions">
        {gifts.length > 1 ? (
          <button className="pill-btn gold big" disabled={busy} onClick={(e) => void claim(undefined, e.currentTarget)}>
            すべて受け取る
          </button>
        ) : (
          <button className="pill-btn" onClick={onClose}>
            閉じる
          </button>
        )}
      </div>
    </Modal>
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

export const NAME_MAX = 12
const COMMENT_MAX = 40
export const chars = (s: string) => [...s].length

/** The admiral's card: name and one-line comment to edit, and a few facts. */
function ProfileDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { card, catalog, setProfile, notify } = useGame()
  const [name, setName] = useState(profile.name)
  const [comment, setComment] = useState(profile.comment)
  const [busy, setBusy] = useState(false)
  const sec = profile.ships.find((s) => s.uid === profile.secretary)
  const secCard = sec ? card(sec.card) : undefined
  const packs = useAssets()
  const portrait = secCard ? portraitOf(lookOfCard(secCard), packs) : undefined
  const s = profile.stats
  const nameOk = name.trim() !== '' && chars(name.trim()) <= NAME_MAX
  const changed = name.trim() !== profile.name || comment.trim() !== profile.comment

  const save = async () => {
    setBusy(true)
    try {
      const r = await api.rename(name, comment)
      setProfile(r.profile)
      setName(r.profile.name)
      setComment(r.profile.comment)
      audio.play('stamp')
      notify('プロフィールを更新しました', 'good')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const facts: [string, string][] = [
    ['着任日', new Date(profile.created).getFullYear() > 2000 ? new Date(profile.created).toLocaleDateString('ja-JP') : '—'],
    ['通算ログイン', `${profile.login.total} 日`],
    ['戦績', `${s.wins} 勝 ${s.losses} 敗`],
    ['最高連勝', `${s.bestStreak}`],
    ['保有艦', `${profile.ships.length}${catalog ? ` / ${catalog.cards.length}` : ''} 隻`],
    ['海域の星', `★${profile.totalStars}`],
  ]
  // Shown so an admiral can tell the operators who they are when asking for help.
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(profile.id)
      notify('提督 ID をコピーしました', 'good')
    } catch {
      notify('コピーできませんでした', 'error')
    }
  }

  return (
    <Modal title="提督プロフィール" onClose={onClose} wide className="profile-modal">
      <div className="profile-head">
        <div className="profile-face">{portrait ? <PortraitImg portrait={portrait} frame="bust" /> : '⚓'}</div>
        <div className="profile-fields">
          <label>
            <span>
              提督名 <small>{chars(name.trim())}/{NAME_MAX}</small>
            </span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX * 2} placeholder="提督" className={nameOk ? '' : 'bad'} />
          </label>
          <label>
            <span>
              ひとこと <small>{chars(comment.trim())}/{COMMENT_MAX}</small>
            </span>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={COMMENT_MAX * 2}
              placeholder="例：無限海域の最深部を目指して出撃中！"
              className={chars(comment.trim()) <= COMMENT_MAX ? '' : 'bad'}
              onKeyDown={(e) => e.key === 'Enter' && nameOk && changed && !busy && void save()}
            />
          </label>
          <p className="profile-level">
            Lv.<b>{profile.level}</b> ／ 艦隊戦力 <b>{profile.fleetPower.toLocaleString()}</b>
            {secCard && <> ／ 秘書艦 <b>{secCard.name}</b></>}
          </p>
        </div>
      </div>
      <dl className="profile-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="profile-id">
        提督 ID <code>{profile.id}</code>
        <button className="chip-btn" onClick={() => void copyId()}>
          コピー
        </button>
      </p>
      <div className="modal-actions">
        <button className="pill-btn gold" disabled={!nameOk || chars(comment.trim()) > COMMENT_MAX || !changed || busy} onClick={() => void save()}>
          保存する
        </button>
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

function NewsDialog({ unread, onClose }: { unread: number; onClose: () => void }) {
  return (
    <Modal title="お知らせ" onClose={onClose} wide className="news-modal">
      <ul className="news-list">
        {NEWS.map((n, i) => (
          <li key={n.id} className={i < unread ? 'unread' : ''}>
            <header>
              <time dateTime={n.date}>{n.date.replaceAll('-', '/')}</time>
              {i < unread && <span className="news-new">NEW</span>}
              <h3>{n.title}</h3>
            </header>
            <ul>
              {n.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button className="pill-btn" onClick={onClose}>
          確認しました
        </button>
      </div>
    </Modal>
  )
}

function RulesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="作戦要綱" onClose={onClose} wide>
      <ol className="rules">
        <li>
          <b>配置</b>編成した艦隊を海域に配置します。敵艦隊も同じ海域のどこかに潜んでいます。海況（快晴・濃霧・時化・夜戦）は出撃ごとに変わります。
        </li>
        <li>
          <b>行動</b>毎ターン、両軍が同時に 1 隻ずつ行動を決め、<em>速力</em>の高い艦から実行されます（<em>雷撃</em>と、前のターンに続けての<em>移動</em>は後攻）。先に沈められた艦の行動は失われます。
        </li>
        <li>
          <b>指示</b>
          <span className="rule-skill">
            <em>砲撃</em>艦種ごとの射程内の 1 マス。戦艦の主砲は十字に着弾し、外れても<em>水柱</em>で周りの水上艦を次のターンまで足止めします。
          </span>
          <span className="rule-skill">
            <em>{TORPEDO_INFO.name}</em>
            {TORPEDO_INFO.desc}。潜水艦には当たりません。
          </span>
          <span className="rule-skill">
            <em>移動</em>縦横に艦種ごとの距離まで（戦艦・空母 1、巡洋艦・潜水艦 2、駆逐艦 3）。方角と距離は敵に通知されます（潜水艦は秘匿）。2 ターン続けて動くと後攻になり、狙われた位置から逃げ切れません。
          </span>
        </li>
        <li>
          <b>報告</b>「<em>命中</em>」「<em>水しぶき</em>（周囲に水上艦あり）」「外れ」で報告。一度見つけた水上艦は移動しても追跡され続けます。3 ターン続けてどの艦も被弾しないと、両軍の<em>索敵機</em>が相手の最も近い未発見の水上艦を見つけます。
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
          <b>損害</b>ダメージは火力・雷装・航空の ±15% で振れ、装甲で軽減。<em>会心</em>は 2 倍。空母の爆撃は相手艦隊の<em>対空</em>合計で弱まります。
        </li>
        <li>
          <b>特殊攻撃</b>
          {Object.values(SPECIAL_INFO).map((s) => (
            <span key={s.name} className="rule-skill">
              <em>{s.name}</em> {s.desc}
            </span>
          ))}
        </li>
        <li>
          <b>決戦</b>命中・撃沈・被弾で決戦ゲージが溜まり、満タンで<em>全艦斉射</em>（3×3 を砲撃）が使えます。連続命中のコンボでゲージ加速！
        </li>
        <li>
          <b>勝敗</b>全艦撃沈で決着。攻撃手段が尽きた側は<em>戦略的撤退</em>（敗北）。ターン制限では残り耐久の割合で判定します。
        </li>
      </ol>
    </Modal>
  )
}
