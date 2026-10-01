import { useEffect, useState, type ReactNode } from 'react'
import { friends as friendsApi, showCode } from '../api'
import { audio } from '../audio'
import { PortraitImg } from '../components/ShipArt'
import { Backdrop, Badge, CardView, Modal, TopBar } from '../components/ui'
import { lookOfCard } from '../game'
import { celebrateGrant, useGame } from '../state'
import { portraitOf, useAssets } from '../theme'
import type { Friend, FriendCard, FriendList, FriendProfile } from '../types'

type Tab = 'friends' | 'incoming' | 'outgoing'

// Mirrors the server's limits (meta.MaxFriends, meta.CheerCoins).
export const MAX_FRIENDS = 30
export const CHEER_COINS = 200

/** How long ago, roughly: たった今, 5 分前, 3 時間前, 2 日前. */
export function ago(iso: string, now = Date.now()) {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
  if (min < 1) return 'たった今'
  if (min < 60) return `${min} 分前`
  if (min < 60 * 24) return `${Math.floor(min / 60)} 時間前`
  return `${Math.floor(min / (60 * 24))} 日前`
}

/** The admiral's face: their secretary ship's portrait in a disc. */
function FriendFace({ secretary, big }: { secretary: string; big?: boolean }) {
  const { card } = useGame()
  const packs = useAssets()
  const c = card(secretary)
  const portrait = c ? portraitOf(lookOfCard(c), packs) : undefined
  return <span className={`friend-face ${big ? 'big' : ''}`}>{portrait ? <PortraitImg portrait={portrait} frame="bust" /> : '⚓'}</span>
}

export function Friends({ onBack }: { onBack: () => void }) {
  const { profile, setProfile, notify } = useGame()
  const [list, setList] = useState<FriendList | null>(null)
  const [tab, setTab] = useState<Tab>('friends')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<FriendCard | null>(null)

  useEffect(() => {
    friendsApi
      .list()
      .then((r) => setList(r.friends))
      .catch((e) => notify((e as Error).message, 'error'))
  }, [notify])

  /** Runs a change and shows the list it answers with; null when it failed. */
  const run = async <T extends { friends: FriendList }>(fn: () => Promise<T>): Promise<T | null> => {
    if (busy) return null
    setBusy(true)
    try {
      const r = await fn()
      setList(r.friends)
      return r
    } catch (e) {
      notify((e as Error).message, 'error')
      // Something may have changed on the other side meanwhile.
      friendsApi
        .list()
        .then((r) => setList(r.friends))
        .catch(() => {})
      return null
    } finally {
      setBusy(false)
    }
  }

  if (!profile) return null
  if (!list) {
    return (
      <div className="screen friends-screen">
        <Backdrop scene="standby" />
        <TopBar title="フレンド" en="FRIENDS" onBack={onBack} />
        <p className="center-msg">読み込み中…</p>
      </div>
    )
  }

  const typed = code.replace(/[\s-]/g, '').toUpperCase()
  const sendRequest = async () => {
    const r = await run(() => friendsApi.request(typed))
    if (!r) return
    setCode('')
    audio.play('stamp')
    if (r.befriended) {
      const f = r.friends.friends.find((x) => x.code === typed)
      notify(`${f?.name ?? '提督'}とフレンドになりました！`, 'gold')
      setTab('friends')
    } else {
      notify('フレンド申請を送りました', 'good')
      setTab('outgoing')
    }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(showCode(list.code))
      notify('フレンドコードをコピーしました', 'good')
    } catch {
      notify('コピーできませんでした', 'error')
    }
  }

  const claimCheers = async (from: Element) => {
    const r = await run(() => friendsApi.claimCheers())
    if (!r) return
    setProfile(r.profile)
    celebrateGrant(r.grant, from)
    notify(`エール ${r.count} 件を受け取りました`, 'good')
  }

  const cheer = async (f?: Friend) => {
    const r = await run(() => friendsApi.cheer(f?.code))
    if (!r) return
    audio.play('heart')
    notify(f ? `${f.name}にエールを送りました` : `${r.sent} 人にエールを送りました`, 'good')
  }

  const answer = async (q: FriendCard, yes: boolean) => {
    const r = await run(() => (yes ? friendsApi.accept(q.code) : friendsApi.decline(q.code)))
    if (!r) return
    if (yes) {
      audio.play('stamp')
      notify(`${q.name}とフレンドになりました！`, 'gold')
    } else {
      notify('申請をお断りしました')
    }
    return true
  }

  const cancel = async (q: FriendCard) => {
    if (await run(() => friendsApi.cancel(q.code))) notify('申請を取り消しました')
  }

  const remove = async (f: FriendCard) => {
    if (!(await run(() => friendsApi.remove(f.code)))) return
    notify(`${f.name}とのフレンドを解除しました`)
    setShown(null)
  }

  const uncheered = list.friends.filter((f) => !f.cheered).length
  const relation = (c: FriendCard): Relation =>
    list.friends.some((f) => f.code === c.code) ? 'friend' : list.incoming.some((q) => q.code === c.code) ? 'incoming' : list.outgoing.some((q) => q.code === c.code) ? 'outgoing' : 'none'

  return (
    <div className="screen friends-screen">
      <Backdrop scene="standby" />
      <TopBar title="フレンド" en="FRIENDS" onBack={onBack} />

      {/* ---- my code, finding friends, cheers received ---- */}
      <aside className="friends-side">
        <section className="friend-code-card">
          <h2>あなたのフレンドコード</h2>
          <p className="friend-code" data-code={list.code}>
            {showCode(list.code)}
          </p>
          <button className="chip-btn" onClick={() => void copyCode()}>
            コピー
          </button>
          <small>コードを教え合ってフレンドになろう</small>
        </section>

        <section className="friend-find">
          <h2>フレンドを探す</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (typed.length === 8) void sendRequest()
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="例：K7QM-4XPA"
              maxLength={12}
              aria-label="フレンドコード"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="pill-btn" disabled={typed.length !== 8 || busy}>
              申請する
            </button>
          </form>
        </section>

        <section className={`cheer-box ${list.cheers ? 'ready' : ''}`}>
          <h2>届いたエール</h2>
          <p>
            <b>{list.cheers}</b> 件
            <span className="muted">（1 件につき 💰{CHEER_COINS}）</span>
          </p>
          <button className="pill-btn gold" disabled={!list.cheers || busy} onClick={(e) => void claimCheers(e.currentTarget)}>
            受け取る
          </button>
          <small>フレンドには毎日 1 回エールを送れます（0:00 にリセット）</small>
        </section>
      </aside>

      {/* ---- lists ---- */}
      <nav className="dock-tabs friends-tabs">
        <button className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')}>
          フレンド <b>{list.friends.length}</b>/{MAX_FRIENDS}
        </button>
        <button className={tab === 'incoming' ? 'on' : ''} onClick={() => setTab('incoming')}>
          届いた申請
          <Badge n={list.incoming.length} />
        </button>
        <button className={tab === 'outgoing' ? 'on' : ''} onClick={() => setTab('outgoing')}>
          送った申請 {list.outgoing.length > 0 && <b>{list.outgoing.length}</b>}
        </button>
        {tab === 'friends' && (
          <button className="pill-btn gold cheer-all" disabled={!uncheered || busy} onClick={() => void cheer()}>
            全員にエール {uncheered > 0 && `(${uncheered})`}
          </button>
        )}
      </nav>

      <ul className="friend-list">
        {tab === 'friends' &&
          (list.friends.length ? (
            list.friends.map((f, i) => (
              <FriendRow key={f.code} c={f} i={i} onOpen={() => setShown(f)} note={f.cheeredMe ? '💌 エールが届きました' : undefined}>
                <button className={`claim-btn cheer-btn ${f.cheered ? '' : 'ready'}`} disabled={f.cheered || busy} onClick={() => void cheer(f)}>
                  {f.cheered ? '送信済' : 'エール'}
                </button>
              </FriendRow>
            ))
          ) : (
            <li className="friend-empty">まだフレンドがいません。フレンドコードを交換して申請してみましょう。</li>
          ))}
        {tab === 'incoming' &&
          (list.incoming.length ? (
            list.incoming.map((q, i) => (
              <FriendRow key={q.code} c={q} i={i} onOpen={() => setShown(q)} note={`申請 ${ago(q.at)}`}>
                <button className="claim-btn ready" disabled={busy} onClick={() => void answer(q, true)}>
                  承認
                </button>
                <button className="claim-btn" disabled={busy} onClick={() => void answer(q, false)}>
                  拒否
                </button>
              </FriendRow>
            ))
          ) : (
            <li className="friend-empty">届いている申請はありません</li>
          ))}
        {tab === 'outgoing' &&
          (list.outgoing.length ? (
            list.outgoing.map((q, i) => (
              <FriendRow key={q.code} c={q} i={i} onOpen={() => setShown(q)} note={`申請 ${ago(q.at)}・返事待ち`}>
                <button className="claim-btn" disabled={busy} onClick={() => void cancel(q)}>
                  取り消す
                </button>
              </FriendRow>
            ))
          ) : (
            <li className="friend-empty">返事待ちの申請はありません</li>
          ))}
      </ul>

      {shown && (
        <FriendDialog
          who={shown}
          relation={relation(shown)}
          cheered={!!list.friends.find((f) => f.code === shown.code)?.cheered}
          busy={busy}
          onCheer={() => void cheer(list.friends.find((f) => f.code === shown.code))}
          onAnswer={async (yes) => {
            if (await answer(shown, yes)) setShown(null)
          }}
          onCancel={async () => {
            await cancel(shown)
            setShown(null)
          }}
          onRemove={() => void remove(shown)}
          onClose={() => setShown(null)}
        />
      )}
    </div>
  )
}

function FriendRow({ c, i, note, onOpen, children }: { c: FriendCard; i: number; note?: string; onOpen: () => void; children: ReactNode }) {
  return (
    <li className="friend-row" data-friend={c.code} style={{ animationDelay: `${i * 0.04}s` }}>
      <button className="friend-who" onClick={onOpen} aria-label={`${c.name}の詳細`}>
        <FriendFace secretary={c.secretary} />
        <span className="friend-name">
          <small>Lv.{c.level}</small>
          <b>{c.name}</b>
          {c.comment && <em>{c.comment}</em>}
        </span>
      </button>
      <span className="friend-power">
        <small>艦隊戦力</small>
        <b>{c.fleetPower.toLocaleString()}</b>
      </span>
      <span className="friend-seen">
        <small>最終ログイン</small>
        {ago(c.lastActive)}
        {note && <i>{note}</i>}
      </span>
      <span className="friend-actions">{children}</span>
    </li>
  )
}

type Relation = 'friend' | 'incoming' | 'outgoing' | 'none'

/** A friend's (or would-be friend's) card: their fleet and records. */
function FriendDialog({
  who,
  relation,
  cheered,
  busy,
  onCheer,
  onAnswer,
  onCancel,
  onRemove,
  onClose,
}: {
  who: FriendCard
  relation: Relation
  cheered: boolean
  busy: boolean
  onCheer: () => void
  onAnswer: (yes: boolean) => Promise<void>
  onCancel: () => Promise<void>
  onRemove: () => void
  onClose: () => void
}) {
  const { card, notify } = useGame()
  const [v, setV] = useState<FriendProfile | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    friendsApi
      .profile(who.code)
      .then((r) => setV(r.friend))
      .catch((e) => {
        notify((e as Error).message, 'error')
        onClose()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who.code])

  const facts: [string, string][] = v
    ? [
        ['着任日', new Date(v.created).getFullYear() > 2000 ? new Date(v.created).toLocaleDateString('ja-JP') : '—'],
        ['通算ログイン', `${v.loginDays} 日`],
        ['戦績', `${v.wins} 勝 / ${v.battles} 戦`],
        ['最高連勝', `${v.bestStreak}`],
        ['保有艦', `${v.ships} 隻`],
        ['海域の星 / 無限最深', `★${v.totalStars} / 第${v.endless}層`],
      ]
    : []

  return (
    <Modal title="提督の詳細" onClose={onClose} wide className="friend-modal">
      <div className="profile-head friend-head">
        <FriendFace secretary={who.secretary} big />
        <div>
          <p className="friend-head-name">
            <small>Lv.{who.level}</small>
            <b>{who.name}</b>
          </p>
          {who.comment && <p className="friend-head-comment">「{who.comment}」</p>}
          <p className="profile-level">
            艦隊戦力 <b>{who.fleetPower.toLocaleString()}</b> ／ 最終ログイン <b>{ago(who.lastActive)}</b> ／ コード <b>{showCode(who.code)}</b>
          </p>
        </div>
      </div>
      {v ? (
        <>
          <dl className="profile-facts">
            {facts.map(([k, val]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{val}</dd>
              </div>
            ))}
          </dl>
          <h3 className="friend-fleet-head">艦隊編成</h3>
          <div className="friend-fleet">
            {v.fleet.map((s, i) => {
              const c = card(s.card)
              return c ? <CardView key={i} look={lookOfCard(c)} level={s.level} stars={s.stars} size="sm" lite /> : null
            })}
          </div>
        </>
      ) : (
        <p className="muted center">読み込み中…</p>
      )}
      <div className="modal-actions">
        {relation === 'friend' &&
          (confirming ? (
            <>
              <button className="pill-btn ghost" onClick={() => setConfirming(false)}>
                やめる
              </button>
              <button className="pill-btn warn" disabled={busy} onClick={onRemove}>
                解除する
              </button>
            </>
          ) : (
            <>
              <button className="pill-btn ghost" onClick={() => setConfirming(true)}>
                フレンド解除
              </button>
              <button className="pill-btn gold" disabled={cheered || busy} onClick={onCheer}>
                {cheered ? '今日のエールは送信済' : 'エールを送る'}
              </button>
            </>
          ))}
        {relation === 'incoming' && (
          <>
            <button className="pill-btn ghost" disabled={busy} onClick={() => void onAnswer(false)}>
              拒否
            </button>
            <button className="pill-btn gold" disabled={busy} onClick={() => void onAnswer(true)}>
              承認する
            </button>
          </>
        )}
        {relation === 'outgoing' && (
          <button className="pill-btn ghost" disabled={busy} onClick={() => void onCancel()}>
            申請を取り消す
          </button>
        )}
        {relation === 'none' && (
          <button className="pill-btn" onClick={onClose}>
            閉じる
          </button>
        )}
      </div>
    </Modal>
  )
}
