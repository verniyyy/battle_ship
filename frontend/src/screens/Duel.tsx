import { useEffect, useRef, useState } from 'react'
import type { Scene } from '../App'
import { duels } from '../api'
import { audio } from '../audio'
import { Board } from '../components/Board'
import { Backdrop, CardView, ShipToken, TopBar } from '../components/ui'
import { fx } from '../fx'
import { CLASS_INFO, lookOfCard, RARITY } from '../game'
import { useGame } from '../state'
import { posLabel, samePos, type DuelLobby, type DuelOutcome, type DuelResponse, type DuelView, type Duellist, type EndReason, type GameView, type Pos } from '../types'
import { ago } from './Friends'

/** A room code as shown: ABC-DEF. */
export const showRoom = (code: string) => (code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code)

/** How a duel ended, from my side. */
export function duelEndLine(outcome: DuelOutcome, why?: EndReason) {
  switch (why) {
    case 'surrender':
      return outcome === 'win' ? '相手提督が降伏しました' : '降伏しました'
    case 'timeout':
      return outcome === 'draw' ? '両提督とも指示が途絶えました' : outcome === 'win' ? '相手提督の指示が途絶えました' : '指示の時間切れが続きました'
    case 'judgment':
      return outcome === 'draw' ? '残り耐久が同率で引き分け' : outcome === 'win' ? '判定勝利' : '判定敗北'
    case 'disarmed':
      return outcome === 'win' ? '相手艦隊、攻撃手段が尽きて撤退！' : '攻撃手段が尽き、戦略的撤退…'
    default:
      return outcome === 'win' ? '相手艦隊を撃滅！' : outcome === 'lose' ? '艦隊全滅…' : '引き分け'
  }
}

const OUTCOME = { win: '勝利', lose: '敗北', draw: '引分' } as const

/** The lobby, the room waiting for an opponent and the deployment of both fleets. */
export function Duel({ go, onBattle }: { go: (s: Scene) => void; onBattle: (d: DuelResponse) => void }) {
  const { profile, card, notify } = useGame()
  const [lobby, setLobby] = useState<DuelLobby | null>(null)
  const [room, setRoom] = useState<DuelResponse | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const deadline = useRef(0)
  const roomRef = useRef(room)
  roomRef.current = room

  // show takes a reply as the room's latest state; a battle under way moves to the battle screen.
  const show = (r: DuelResponse | null) => {
    if (r?.duel.phase === 'battle') {
      onBattle(r)
      return
    }
    if (r && (r.duel.phase === 'cancelled' || r.duel.phase === 'finished')) {
      const was = roomRef.current
      if (was && was.duel.phase !== r.duel.phase) notify(r.duel.phase === 'cancelled' ? '対戦は中止されました' : '対戦は終了しました')
      setRoom(null)
      void loadLobby()
      return
    }
    if (r) deadline.current = Date.now() + r.duel.secondsLeft * 1000
    setRoom(r)
  }

  const loadLobby = async () => {
    try {
      const l = await duels.lobby()
      setLobby(l)
      show(l.id && l.duel ? { id: l.id, duel: l.duel } : null)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  useEffect(() => {
    void loadLobby()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // While a room is open or the fleets deploy, keep an eye on the other admiral.
  const roomId = room?.id
  useEffect(() => {
    if (!roomId) return
    let alive = true
    let timer = 0
    const loop = async () => {
      if (!alive) return
      if (document.visibilityState === 'visible') {
        try {
          const r = await duels.get(roomId, roomRef.current?.duel.rev)
          if (r && alive) show(r)
        } catch {
          // Retried on the next beat.
        }
      }
      if (alive) timer = window.setTimeout(loop, 5000)
    }
    timer = window.setTimeout(loop, 5000)
    const tick = window.setInterval(() => setClock(Date.now()), 1000)
    return () => {
      alive = false
      clearTimeout(timer)
      clearInterval(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  const run = async (fn: () => Promise<DuelResponse>) => {
    if (busy) return
    setBusy(true)
    try {
      show(await fn())
    } catch (e) {
      notify((e as Error).message, 'error')
      void loadLobby()
    } finally {
      setBusy(false)
    }
  }

  if (!profile) return null
  const secondsLeft = Math.max(0, Math.ceil((deadline.current - clock) / 1000))
  const typed = code.replace(/[\s-]/g, '').toUpperCase()
  const myFleet = profile.fleet.map((uid) => profile.ships.find((s) => s.uid === uid)!).filter(Boolean)

  return (
    <div className="screen duel-screen">
      <Backdrop scene="standby" />
      <TopBar title="対人戦" en="VERSUS" onBack={() => go({ name: 'home' })} right={<span className="beta-tag">BETA</span>} />

      {!lobby ? (
        <p className="center-msg">読み込み中…</p>
      ) : room?.duel.phase === 'placing' ? (
        <Deploy room={room} secondsLeft={secondsLeft} busy={busy} onPlace={(ps) => void run(() => duels.place(room.id, ps))} onLeave={() => void run(() => duels.leave(room.id))} />
      ) : room?.duel.phase === 'open' ? (
        <section className="duel-room">
          <p className="duel-room-label">部屋番号</p>
          <p className="duel-room-code" data-testid="room-code">
            {showRoom(room.duel.code)}
          </p>
          <button
            className="mini-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(showRoom(room.duel.code))
                notify('部屋番号をコピーしました', 'good')
              } catch {
                notify('コピーできませんでした', 'error')
              }
            }}
          >
            コピー
          </button>
          <p className="duel-room-wait">
            <span className="duel-spinner" aria-hidden />
            対戦相手の入室を待っています…
          </p>
          <small>この番号を相手に伝えてください。あと {Math.floor(secondsLeft / 60)}分{secondsLeft % 60}秒 で部屋は閉じます。</small>
          <button className="pill-btn ghost" disabled={busy} onClick={() => void run(() => duels.leave(room.id))}>
            部屋を閉じる
          </button>
        </section>
      ) : (
        <>
          <section className="duel-start">
            <div className="duel-card">
              <h2>部屋を作る</h2>
              <p>部屋番号を発行して、相手の入室を待ちます。</p>
              <button className="pill-btn" disabled={busy || !myFleet.length} onClick={() => void run(duels.create)}>
                部屋を作る
              </button>
            </div>
            <div className="duel-card">
              <h2>部屋に入る</h2>
              <p>相手から聞いた 6 文字の部屋番号を入力します。</p>
              <form
                className="duel-join"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (typed.length === 6) void run(() => duels.join(typed))
                }}
              >
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABC-DEF" maxLength={8} aria-label="部屋番号" autoCapitalize="characters" />
                <button className="pill-btn" disabled={busy || typed.length !== 6}>
                  入室
                </button>
              </form>
            </div>
            <div className="duel-fleet">
              <h3>
                出撃する艦隊（現在の編成）
                <button className="mini-btn" onClick={() => go({ name: 'formation' })}>
                  編成変更
                </button>
              </h3>
              <ul>
                {myFleet.map((s) => {
                  const c = card(s.card)
                  return c ? (
                    <li key={s.uid}>
                      <CardView look={lookOfCard(c)} size="xs" />
                      <span>
                        {c.name} <small>Lv.{s.level}</small>
                      </span>
                    </li>
                  ) : null
                })}
              </ul>
            </div>
          </section>

          <aside className="duel-side">
            <section className="duel-beta">
              <h2>ベータ版のお知らせ</h2>
              <p>対人戦は試験運用中です。報酬はなく、ルールは今後調整します。遊んでみた感想をぜひお聞かせください。</p>
              <ul>
                <li>8×8 の海域。自分の艦隊は手前の 3 列に、相手には見えないように配置</li>
                <li>毎ターン両提督が同時に指示し、揃ったら行動（ルールは通常の海戦と同じ）</li>
                <li>1 ターンの持ち時間は 60 秒。時間切れはそのターンの行動なし、3 回続くと敗北</li>
                <li>30 ターンで決着しなければ残り耐久の割合で判定（同率は引き分け）</li>
              </ul>
            </section>
            <section className="duel-record">
              <h2>対戦成績</h2>
              <p className="duel-tally">
                <b>{lobby.record.wins}</b>勝 <b>{lobby.record.losses}</b>敗 <b>{lobby.record.draws}</b>分
              </p>
              <ul>
                {lobby.record.recent.map((r, i) => (
                  <li key={i} className={r.outcome}>
                    <span className="duel-outcome">{OUTCOME[r.outcome]}</span>
                    <span>vs {r.opponent}</span>
                    <small>
                      {r.turns}T・{ago(r.finishedAt)}
                    </small>
                  </li>
                ))}
                {lobby.record.recent.length === 0 && <li className="muted">まだ対戦記録はありません</li>}
              </ul>
            </section>
          </aside>
        </>
      )}
    </div>
  )
}

function FleetList({ who, d, title }: { who: string; d: Duellist; title: string }) {
  const { card } = useGame()
  return (
    <section className={`duel-who ${who}`}>
      <h3>
        {title}
        <span className={`duel-ready ${d.ready ? 'on' : ''}`}>{d.ready ? '配置完了' : '配置中…'}</span>
      </h3>
      <p className="duel-name">
        <b>{d.name}</b> Lv.{d.level} ・ 戦力 {d.power.toLocaleString()}
      </p>
      <ul>
        {d.fleet.map((s, i) => {
          const c = card(s.key)
          return (
            <li key={i}>
              {c ? <ShipToken look={lookOfCard(c)} no={i + 1} /> : null}
              <span>
                {s.name}
                <small>
                  {CLASS_INFO[s.class].name}・{RARITY[s.rarity]}・耐久 {s.hp}・速力 {s.speed}
                </small>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Deploys my fleet in my zone, the bottom rows of the sea. */
function Deploy({ room, secondsLeft, busy, onPlace, onLeave }: { room: DuelResponse; secondsLeft: number; busy: boolean; onPlace: (ps: Pos[]) => void; onLeave: () => void }) {
  const { card } = useGame()
  const d = room.duel
  const n = d.me.fleet.length
  const size = d.boardSize
  const zoneTop = size - d.zoneRows
  const [placements, setPlacements] = useState<(Pos | null)[]>(() => d.placement ?? Array(n).fill(null))
  const [selected, setSelected] = useState(0)
  const placed = !!d.placement
  const inZone = (p: Pos) => p.row >= zoneTop
  const shipAt = (p: Pos) => placements.findIndex((q) => samePos(q, p))

  const onCell = (p: Pos) => {
    if (placed || !inZone(p)) return
    const occupant = shipAt(p)
    if (occupant >= 0) {
      setSelected(occupant)
      audio.play('tap')
      return
    }
    audio.play('move')
    const c = fx.center(document.querySelector(`[data-cell="${p.row}-${p.col}"]`))
    fx.ring(c.x, c.y, '#9fe8ff', 50, 0.4)
    const next = placements.map((q, i) => (i === selected ? p : q))
    setPlacements(next)
    const unplaced = next.findIndex((q) => q === null)
    if (unplaced >= 0) setSelected(unplaced)
  }

  const randomize = () => {
    audio.play('move')
    const cells = Array.from({ length: d.zoneRows * size }, (_, i) => i).sort(() => Math.random() - 0.5)
    setPlacements(d.me.fleet.map((_, i) => ({ row: zoneTop + Math.floor(cells[i] / size), col: cells[i] % size })))
  }

  const ready = placements.every((p) => p !== null)

  return (
    <>
      <aside className="duel-deploy-side">
        <FleetList who="me" d={d.me} title="自軍" />
        {d.opponent && <FleetList who="foe" d={d.opponent} title="相手" />}
      </aside>

      <section className="duel-deploy-board">
        <p className="board-hint">
          {placed ? (
            <>
              <span className="duel-spinner" aria-hidden />
              配置完了。相手の配置を待っています…
            </>
          ) : (
            <>
              <b>{d.me.fleet[selected]?.name}</b> を手前の {d.zoneRows} 列に配置（奥は相手の陣地）
            </>
          )}
        </p>
        <Board
          size={size}
          span={440}
          onCellClick={onCell}
          className="duel-board"
          cellClass={(p) => {
            const i = shipAt(p)
            if (i >= 0) return `has-ship ${i === selected && !placed ? 'selected-ship' : ''}`
            if (inZone(p)) return placed ? 'duel-zone' : 'placeable duel-zone'
            return p.row < d.zoneRows ? 'duel-foe-zone' : 'duel-neutral'
          }}
          renderCell={(p) => {
            const i = shipAt(p)
            const c = i >= 0 ? card(d.me.fleet[i].key) : undefined
            return c ? <ShipToken look={lookOfCard(c)} no={i + 1} /> : null
          }}
        />
      </section>

      <aside className="duel-deploy-go">
        <div className={`duel-clock big ${secondsLeft <= 20 ? 'urgent' : ''}`}>
          <small>配置の残り時間</small>
          <b>{secondsLeft}</b>
          <span>秒</span>
        </div>
        <small className="muted">時間切れになると、未配置の艦隊はおまかせで配置されます。</small>
        <ol className="duel-places">
          {d.me.fleet.map((s, i) => (
            <li key={i} className={selected === i && !placed ? 'on' : ''} onClick={() => !placed && setSelected(i)}>
              {i + 1}. {s.name} <span>{placements[i] ? posLabel(placements[i]!) : '未配置'}</span>
            </li>
          ))}
        </ol>
        {!placed && (
          <div className="fleet-tools">
            <button className="pill-btn" onClick={randomize}>
              おまかせ配置
            </button>
            <button
              className="pill-btn ghost"
              onClick={() => {
                setPlacements(Array(n).fill(null))
                setSelected(0)
              }}
            >
              リセット
            </button>
          </div>
        )}
        <button className={`go-btn ${ready && !placed ? 'ready' : ''}`} disabled={!ready || placed || busy} onClick={() => onPlace(placements as Pos[])}>
          <span className="go-en">{placed ? 'STANDBY' : 'DEPLOY'}</span>
          <span className="go-jp">{placed ? '待機中' : '配置完了！'}</span>
        </button>
        <button className="chip-btn" disabled={busy} onClick={onLeave}>
          対戦をやめる
        </button>
      </aside>
    </>
  )
}

/** The end of a duel, over the board. */
export function DuelResult({ duel, game, onBoard, go }: { duel: DuelView; game: GameView; onBoard: () => void; go: (s: Scene) => void }) {
  const outcome: DuelOutcome = !game.winner ? 'draw' : game.winner === 'player' ? 'win' : 'lose'
  const mine = game.history.filter((r) => r.side === 'player' && r.type !== 'recon')
  const shots = mine.reduce((n, r) => n + (r.shots?.length ?? 0), 0)
  const hits = mine.reduce((n, r) => n + (r.shots ?? []).filter((s) => (s.damage ?? 0) > 0).length, 0)
  const sunk = game.enemyShips.filter((s) => s.hp <= 0).length
  const lost = game.playerShips.filter((s) => s.hp <= 0).length
  return (
    <div className={`duel-result ${outcome}`}>
      <div className="duel-result-card">
        <span className="duel-result-en">{outcome === 'win' ? 'VICTORY' : outcome === 'lose' ? 'DEFEAT' : 'DRAW'}</span>
        <b className="duel-result-jp">{OUTCOME[outcome]}</b>
        <p>
          vs <b>{duel.opponent?.name}</b> 提督 ・ {duelEndLine(outcome, game.endReason)}
        </p>
        <dl>
          <div>
            <dt>ターン</dt>
            <dd>{game.turn}</dd>
          </div>
          <div>
            <dt>命中</dt>
            <dd>
              {hits}/{shots}
            </dd>
          </div>
          <div>
            <dt>撃沈</dt>
            <dd>{sunk}</dd>
          </div>
          <div>
            <dt>損失</dt>
            <dd>{lost}</dd>
          </div>
        </dl>
        <small className="muted">ベータ版のため報酬はありません</small>
        <div className="duel-result-btns">
          <button className="pill-btn ghost" onClick={onBoard}>
            盤面を見る
          </button>
          <button className="pill-btn" onClick={() => go({ name: 'duel' })}>
            ロビーへ
          </button>
          <button className="pill-btn ghost" onClick={() => go({ name: 'home' })}>
            母港へ
          </button>
        </div>
      </div>
    </div>
  )
}
