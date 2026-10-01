// The operators' console: hand out gifts to everyone or to chosen admirals,
// stop them, and look back on what was done. The server checks that the
// signed-in account is an admin; this screen is only linked for admins.
import { useCallback, useEffect, useState } from 'react'
import { admin, type GiftDraft } from '../api'
import { audio } from '../audio'
import { Backdrop, Modal, TopBar } from '../components/ui'
import { useGame } from '../state'
import type { AuditEntry, Gift, GiftRecord, PlayerSummary } from '../types'

type Tab = 'list' | 'new' | 'audit'

// Mirrors the server's limits (meta/gift.go) so mistakes show before sending.
const LIMITS = { title: 30, message: 300, gems: 10000, coins: 1000000, cards: 5, recipients: 500, days: 180 }
const DAY = 24 * 60 * 60 * 1000

/** A Date as the value of an <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(d: Date) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

const fmt = (iso: string) => new Date(iso).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })

function status(g: GiftRecord, now: number) {
  if (g.revokedAt) return { label: '停止', cls: 'revoked' }
  if (now < Date.parse(g.startsAt)) return { label: '予約', cls: 'scheduled' }
  if (now >= Date.parse(g.endsAt)) return { label: '終了', cls: 'ended' }
  return { label: '配布中', cls: 'live' }
}

export function Admin({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('list')
  const [gifts, setGifts] = useState<GiftRecord[] | null>(null)
  const { notify } = useGame()

  const load = useCallback(() => {
    admin
      .gifts()
      .then((r) => setGifts(r.gifts))
      .catch((e) => {
        setGifts([])
        notify((e as Error).message, 'error')
      })
  }, [notify])
  useEffect(load, [load])

  return (
    <div className="screen admin-screen">
      <Backdrop scene="standby" dim={0.6} />
      <TopBar title="管理" en="ADMIN" onBack={onBack} />
      <nav className="dock-tabs">
        {(
          [
            ['list', '配布一覧'],
            ['new', '新しい配布'],
            ['audit', '操作ログ'],
          ] as const
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="admin-body">
        {tab === 'list' && <GiftList gifts={gifts} onChanged={load} />}
        {tab === 'new' && (
          <GiftForm
            onCreated={() => {
              load()
              setTab('list')
            }}
          />
        )}
        {tab === 'audit' && <AuditLog />}
      </div>
    </div>
  )
}

function Contents({ g }: { g: Pick<Gift, 'gems' | 'coins' | 'cards'> }) {
  const { card } = useGame()
  return (
    <span className="gift-contents">
      {!!g.gems && <span className="gift-item gems">💎{g.gems.toLocaleString()}</span>}
      {!!g.coins && <span className="gift-item coins">💰{g.coins.toLocaleString()}</span>}
      {g.cards?.map((c, i) => (
        <span key={i} className="gift-item card">
          ⚓{card(c)?.name ?? c}
        </span>
      ))}
    </span>
  )
}

function GiftList({ gifts, onChanged }: { gifts: GiftRecord[] | null; onChanged: () => void }) {
  const { notify } = useGame()
  const [stopping, setStopping] = useState<GiftRecord | null>(null)
  const now = Date.now()

  const revoke = async (g: GiftRecord) => {
    try {
      await admin.revokeGift(g.id)
      audio.play('back')
      notify(`「${g.title}」の配布を停止しました`, 'good')
      onChanged()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setStopping(null)
    }
  }

  if (!gifts) return <p className="muted center">読み込み中…</p>
  if (!gifts.length) return <p className="muted center">まだ配布はありません。「新しい配布」から作成できます。</p>
  return (
    <>
      <ul className="admin-gifts">
        {gifts.map((g) => {
          const st = status(g, now)
          return (
            <li key={g.id} data-admin-gift={g.id}>
              <span className={`admin-status ${st.cls}`}>{st.label}</span>
              <div className="admin-gift-main">
                <b>{g.title}</b>
                <Contents g={g} />
                <small>
                  {fmt(g.startsAt)} 〜 {fmt(g.endsAt)} ／ {g.everyone ? (g.joinedBefore ? `${fmt(g.joinedBefore)} より前に着任した全員` : '全員') : `${g.recipients} 人`} ／ 受取{' '}
                  <b>{g.claims}</b> 件
                </small>
                <small className="muted">
                  作成 {fmt(g.createdAt)} {g.createdBy}
                  {g.revokedAt && ` ／ 停止 ${fmt(g.revokedAt)} ${g.revokedBy}`}
                </small>
              </div>
              {(st.cls === 'live' || st.cls === 'scheduled') && (
                <button className="pill-btn warn" onClick={() => setStopping(g)}>
                  停止
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {stopping && (
        <Modal title="配布を停止" onClose={() => setStopping(null)}>
          <p>
            「{stopping.title}」の配布を停止します。まだ受け取っていない提督は受け取れなくなります。受け取り済みの分は取り消されません。
          </p>
          <div className="modal-actions">
            <button className="pill-btn" onClick={() => setStopping(null)}>
              やめる
            </button>
            <button className="pill-btn warn" onClick={() => void revoke(stopping)}>
              停止する
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

function GiftForm({ onCreated }: { onCreated: () => void }) {
  const { catalog, card, notify } = useGame()
  const [now] = useState(() => new Date())
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [gems, setGems] = useState(0)
  const [coins, setCoins] = useState(0)
  const [cards, setCards] = useState<string[]>([])
  const [pick, setPick] = useState('')
  const [startsAt, setStartsAt] = useState(toLocalInput(now))
  const [endsAt, setEndsAt] = useState(toLocalInput(new Date(now.getTime() + 14 * DAY)))
  const [everyone, setEveryone] = useState(true)
  const [cutoff, setCutoff] = useState(false)
  const [joinedBefore, setJoinedBefore] = useState(toLocalInput(now))
  const [ids, setIds] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const recipients = [...new Set(ids.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))]
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  const problems = [
    (!title.trim() || [...title.trim()].length > LIMITS.title) && `件名は 1〜${LIMITS.title} 文字`,
    [...message.trim()].length > LIMITS.message && `本文は ${LIMITS.message} 文字まで`,
    !(gems || coins || cards.length) && '配布するものを指定してください',
    (gems < 0 || gems > LIMITS.gems) && `ジェムは 0〜${LIMITS.gems}`,
    (coins < 0 || coins > LIMITS.coins) && `コインは 0〜${LIMITS.coins.toLocaleString()}`,
    (!(end > start) || isNaN(start)) && '終了日時は開始日時より後に',
    end - start > LIMITS.days * DAY && `受け取り期間は ${LIMITS.days} 日まで`,
    !everyone && !recipients.length && '受取人を指定してください',
    recipients.length > LIMITS.recipients && `受取人は ${LIMITS.recipients} 人まで`,
  ].filter(Boolean) as string[]

  const draft = (): GiftDraft => ({
    title: title.trim(),
    message: message.trim(),
    gems,
    coins,
    cards,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    everyone,
    joinedBefore: everyone && cutoff ? new Date(joinedBefore).toISOString() : undefined,
  })

  const submit = async () => {
    setBusy(true)
    try {
      await admin.createGift(draft(), everyone ? [] : recipients)
      audio.play('stamp')
      notify(`「${title.trim()}」を配布しました`, 'good')
      onCreated()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="admin-form">
      <section>
        <label>
          <span>
            件名 <small>{[...title.trim()].length}/{LIMITS.title}</small>
          </span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：メンテナンス延長のお詫び" />
        </label>
        <label>
          <span>
            本文 <small>{[...message.trim()].length}/{LIMITS.message}</small>
          </span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="提督に届くメッセージ" />
        </label>
        <div className="admin-row">
          <label>
            <span>💎 ジェム</span>
            <input type="number" min={0} max={LIMITS.gems} value={gems} onChange={(e) => setGems(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label>
            <span>💰 コイン</span>
            <input type="number" min={0} max={LIMITS.coins} step={100} value={coins} onChange={(e) => setCoins(Math.max(0, Number(e.target.value) || 0))} />
          </label>
        </div>
        <label>
          <span>
            ⚓ 艦カード <small>{cards.length}/{LIMITS.cards}</small>
          </span>
          <div className="admin-row">
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">艦を選ぶ…</option>
              {catalog?.cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {['N', 'R', 'SR', 'SSR', 'UR'][c.rarity]} {c.name}（{c.title}）
                </option>
              ))}
            </select>
            <button
              className="chip-btn"
              disabled={!pick || cards.length >= LIMITS.cards}
              onClick={() => {
                setCards([...cards, pick])
                setPick('')
              }}
            >
              追加
            </button>
          </div>
          {cards.length > 0 && (
            <div className="admin-chips">
              {cards.map((c, i) => (
                <button key={i} className="chip-btn on" onClick={() => setCards(cards.filter((_, j) => j !== i))} title="外す">
                  {card(c)?.name ?? c} ✕
                </button>
              ))}
            </div>
          )}
        </label>
      </section>

      <section>
        <div className="admin-row">
          <label>
            <span>受け取り開始</span>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label>
            <span>受け取り期限</span>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </div>
        <fieldset className="admin-target">
          <legend>配布先</legend>
          <label className="inline">
            <input type="radio" checked={everyone} onChange={() => setEveryone(true)} /> 全員
          </label>
          <label className="inline">
            <input type="radio" checked={!everyone} onChange={() => setEveryone(false)} /> 指定した提督
          </label>
          {everyone ? (
            <div className="admin-row">
              <label className="inline">
                <input type="checkbox" checked={cutoff} onChange={(e) => setCutoff(e.target.checked)} /> この日時より前に着任した提督のみ
              </label>
              <input type="datetime-local" value={joinedBefore} disabled={!cutoff} onChange={(e) => setJoinedBefore(e.target.value)} />
            </div>
          ) : (
            <>
              <PlayerSearch onAdd={(id) => setIds((s) => (recipients.includes(id) ? s : `${s.trim()}\n${id}`.trim()))} />
              <label>
                <span>
                  提督 ID（改行・カンマ区切り） <small>{recipients.length} 人</small>
                </span>
                <textarea value={ids} onChange={(e) => setIds(e.target.value)} rows={4} placeholder="xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx" className="mono" />
              </label>
            </>
          )}
        </fieldset>
        {problems.length > 0 && (
          <ul className="admin-problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button className="pill-btn gold big" disabled={problems.length > 0} onClick={() => setConfirming(true)}>
            内容を確認
          </button>
        </div>
      </section>

      {confirming && (
        <Modal title="この内容で配布しますか？" onClose={() => setConfirming(false)} className="admin-confirm">
          <dl className="profile-facts">
            <div>
              <dt>件名</dt>
              <dd>{title.trim()}</dd>
            </div>
            <div>
              <dt>内容</dt>
              <dd>
                <Contents g={{ gems, coins, cards }} />
              </dd>
            </div>
            <div>
              <dt>期間</dt>
              <dd>
                {fmt(draft().startsAt)} 〜 {fmt(draft().endsAt)}
              </dd>
            </div>
            <div>
              <dt>配布先</dt>
              <dd>
                {everyone ? (
                  <b className="warn">{cutoff ? `${fmt(draft().joinedBefore!)} より前に着任した全員` : '全員'}</b>
                ) : (
                  `${recipients.length} 人`
                )}
              </dd>
            </div>
          </dl>
          {message.trim() && <p className="admin-preview">{message.trim()}</p>}
          <p className="muted">配布後に内容は変更できません（停止はできます）。</p>
          <div className="modal-actions">
            <button className="pill-btn" onClick={() => setConfirming(false)}>
              戻る
            </button>
            <button className="pill-btn gold" disabled={busy} onClick={() => void submit()}>
              配布する
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function PlayerSearch({ onAdd }: { onAdd: (id: string) => void }) {
  const { notify } = useGame()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<PlayerSummary[] | null>(null)
  const search = async () => {
    if (!q.trim()) return
    try {
      setFound((await admin.players(q.trim())).players)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  return (
    <div className="admin-search">
      <div className="admin-row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          placeholder="提督名・メールアドレス・ID で検索"
        />
        <button className="chip-btn" onClick={() => void search()}>
          検索
        </button>
      </div>
      {found && (
        <ul className="admin-players">
          {found.length ? (
            found.map((p) => (
              <li key={p.id}>
                <b>{p.name}</b> Lv.{p.level}
                <small className="mono">{p.id}</small>
                {p.email && <small>{p.email}</small>}
                <button className="chip-btn" onClick={() => onAdd(p.id)}>
                  追加
                </button>
              </li>
            ))
          ) : (
            <li className="muted">見つかりませんでした</li>
          )}
        </ul>
      )}
    </div>
  )
}

const ACTIONS: Record<string, string> = { 'gift.create': '配布を作成', 'gift.revoke': '配布を停止' }

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  useEffect(() => {
    admin
      .audit()
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]))
  }, [])
  if (!entries) return <p className="muted center">読み込み中…</p>
  if (!entries.length) return <p className="muted center">操作の記録はまだありません</p>
  return (
    <table className="admin-audit">
      <thead>
        <tr>
          <th>日時</th>
          <th>操作者</th>
          <th>操作</th>
          <th>対象</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td>{fmt(e.at)}</td>
            <td>{e.actor}</td>
            <td>{ACTIONS[e.action] ?? e.action}</td>
            <td className="mono">{e.target}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
