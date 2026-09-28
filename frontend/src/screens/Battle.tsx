import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Board, CellOverlay } from '../components/Board'
import { CutinLayer, Impact, ShipPlate, type Cutin, type ImpactKind } from '../components/battle'
import { Backdrop, Portrait, ShipBadge, SoundToggle } from '../components/ui'
import { describe, historyLog, report, type LogLine } from '../game'
import { assets, sound, useAssets } from '../theme'
import { posLabel, samePos, type ActionType, type GameResponse, type GameView, type Pos, type Result, type ShipView } from '../types'
import { ResultOverlay } from './Result'

type Marker = 'hit' | 'splash' | 'miss' | 'enemy-fire'

// Markers for the most recent round only: older reports are stale once ships move.
function lastRoundMarkers(game: GameView): Map<string, Marker> {
  const m = new Map<string, Marker>()
  const h = game.history
  let start = h.length - 1
  while (start > 0 && h[start].side !== 'player') start--
  for (const r of h.slice(Math.max(start, 0))) {
    if (r.type !== 'attack' || !r.target) continue
    const k = `${r.target.row},${r.target.col}`
    if (r.side === 'cpu') m.set(k, 'enemy-fire')
    else m.set(k, r.hitShipId !== undefined ? 'hit' : r.splash ? 'splash' : 'miss')
  }
  return m
}

const SPEED_KEY = 'battleSpeed'
function loadSpeed() {
  try {
    return localStorage.getItem(SPEED_KEY) === '2' ? 2 : 1
  } catch {
    return 1
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function Battle({
  initial,
  resumed,
  onFinished,
  onRetry,
  onHome,
}: {
  initial: GameResponse
  resumed?: boolean
  onFinished: () => void
  onRetry: () => void
  onHome: () => void
}) {
  const { ui } = useAssets()
  const gameId = initial.id
  const [game, setGame] = useState(initial.game)
  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState<ActionType | null>(null)
  const [target, setTarget] = useState<Pos | null>(null)
  const [busy, setBusy] = useState(false)
  const [cutin, setCutin] = useState<Cutin | null>(null)
  const [impact, setImpact] = useState<{ at: Pos; kind: ImpactKind; enemyFire: boolean; key: number } | null>(null)
  const [shake, setShake] = useState(0)
  const [flash, setFlash] = useState(0)
  const [log, setLog] = useState<LogLine[]>(() => historyLog(initial.game))
  const [error, setError] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(initial.game.status === 'finished')
  const [speed, setSpeed] = useState(loadSpeed)
  const mounted = useRef(true)
  const speedRef = useRef(speed)
  const skip = useRef<(() => void) | null>(null)
  speedRef.current = speed

  // wait sleeps for a (speed-adjusted) duration; a tap on the cut-in ends it early.
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(done, ms / speedRef.current)
      function done() {
        clearTimeout(t)
        skip.current = null
        resolve()
      }
      skip.current = done
    })

  const show = async (c: Cutin, ms: number) => {
    if (!mounted.current) return
    setCutin(c)
    await wait(ms)
    if (mounted.current) setCutin(null)
  }

  useEffect(() => {
    mounted.current = true
    sound.playBgm('battle')
    const finishedAlready = initial.game.status === 'finished'
    if (!finishedAlready) {
      ;(async () => {
        setBusy(true)
        sound.se('launch')
        if (resumed || initial.game.history.length > 0) {
          await show({ kind: 'intro', step: 'sighted' }, 1400)
        } else {
          await show({ kind: 'intro', step: 'search' }, 1100)
          await show({ kind: 'intro', step: 'found' }, 1400)
        }
        if (mounted.current) setBusy(false)
      })()
    }
    return () => {
      mounted.current = false
    }
  }, [])

  const finished = game.status === 'finished'
  const ship = selected !== null ? game.playerShips[selected] : null
  const targets = ship && mode ? ((mode === 'attack' ? ship.attackTargets : ship.moveTargets) ?? []) : []
  const markers = lastRoundMarkers(game)
  const turn = game.turn + (finished ? 0 : 1)
  const lead = ship ?? game.playerShips.find((s) => s.hp > 0) ?? game.playerShips[0]

  const selectShip = (id: number) => {
    if (busy || finished) return
    sound.se('click', 0.3)
    if (game.playerShips[id].class === 'destroyer') sound.voice()
    setSelected(id)
    setMode(null)
    setTarget(null)
  }

  const chooseMode = (m: ActionType) => {
    sound.se('click', 0.3)
    setMode(m)
    setTarget(null)
  }

  const onCell = (p: Pos) => {
    if (busy || finished) return
    if (targets.some((t) => samePos(t, p))) {
      if (samePos(target, p)) {
        execute()
        return
      }
      sound.se('click', 0.2)
      setTarget(p)
      return
    }
    const own = game.playerShips.find((s) => s.hp > 0 && samePos(s.pos, p))
    if (own) selectShip(own.id)
  }

  const kindOf = (r: Result): ImpactKind => (r.hitShipId !== undefined ? (r.sunk ? 'sunk' : 'hit') : r.splash ? 'splash' : 'miss')

  // play animates one side's action: cut-in, then the impact on the board.
  const play = async (r: Result, view: GameView, actor: ShipView) => {
    const mine = r.side === 'player'
    const line = describe(r, view, turn)
    if (r.type === 'move') {
      sound.se('move', 0.4)
      setLog((l) => [line, ...l])
      await show({ kind: 'toast', side: r.side, text: line.text }, 1100)
      return
    }
    sound.se('launch', 0.5)
    await show(mine ? { kind: 'attack', cls: actor.class, name: actor.name } : { kind: 'enemy', cls: actor.class, name: actor.name }, mine ? 1100 : 900)
    if (!mounted.current) return
    const kind = kindOf(r)
    const hit = kind === 'hit' || kind === 'sunk'
    setImpact({ at: r.target!, kind, enemyFire: !mine, key: Math.random() })
    sound.se(hit ? (kind === 'sunk' ? 'explosion3' : 'explosion1') : 'explosion2', hit ? 0.6 : 0.3)
    if (hit) setShake((s) => s + 1)
    if (hit && !mine) setFlash((f) => f + 1)
    setLog((l) => [line, ...l])
    await wait(kind === 'sunk' ? 1500 : 1100)
    if (mounted.current) setImpact(null)
  }

  const execute = async () => {
    if (selected === null || !mode || !target || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.act(gameId, mode, selected, target)
      setSelected(null)
      setMode(null)
      setTarget(null)
      await play(res.player, res.game, res.game.playerShips[res.player.shipId])
      if (!mounted.current) return
      setGame(res.game)
      if (res.cpu) await play(res.cpu, res.game, res.game.enemyShips[res.cpu.shipId])
      if (!mounted.current) return
      if (res.game.status === 'finished') {
        onFinished()
        sound.stopBgm()
        await sleep(500)
        if (mounted.current) setShowResult(true)
      } else {
        await show({ kind: 'turn', turn: res.game.turn + 1 }, 800)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const toggleSpeed = () => {
    const s = speed === 1 ? 2 : 1
    setSpeed(s)
    try {
      localStorage.setItem(SPEED_KEY, String(s))
    } catch {
      /* storage unavailable */
    }
  }

  const reticle = ui ? { ['--reticle' as string]: `url(${assets.fx('reticle')})` } : undefined
  const lastLine = log[0]

  return (
    <div className={`screen battle-screen ${shake % 2 ? 'shake-a' : shake ? 'shake-b' : ''}`}>
      <Backdrop scene="battle" dim={0.5} />
      {flash > 0 && <div className="damage-flash" key={flash} />}

      {/* ---- header ---- */}
      <header className="battle-hud">
        <span className="side-tag player">自艦隊</span>
        <div className="turn-plate">
          <small>TURN</small>
          <b>{turn}</b>
        </div>
        <span className="side-tag enemy">敵艦隊</span>
        <div className="hud-tools">
          <button className={`chip-btn ${speed === 2 ? 'on' : ''}`} onClick={toggleSpeed} aria-pressed={speed === 2}>
            ▶▶ ×{speed}
          </button>
          <SoundToggle />
          {!finished && (
            <button className="chip-btn" onClick={onHome} title="対局は保存され、母港から再開できます">
              撤退
            </button>
          )}
        </div>
      </header>

      {/* ---- player fleet ---- */}
      <aside className="fleet-col player">
        {game.playerShips.map((s) => (
          <ShipPlate key={s.id} ship={s} selected={selected === s.id} onClick={finished ? undefined : () => selectShip(s.id)} />
        ))}
        <div className="flagship">
          <div className="flagship-art" key={lead.class}>
            <Portrait cls={lead.class} />
          </div>
          <p className="flagship-line">
            {finished
              ? '戦闘終了。'
              : busy
                ? '交戦中……'
                : ship
                  ? mode === 'attack'
                    ? '目標はどこ？'
                    : mode === 'move'
                      ? '針路を指示して。'
                      : '指示をちょうだい。'
                  : '行動する艦を選んで。'}
          </p>
        </div>
      </aside>

      {/* ---- board ---- */}
      <main className="battle-center" style={reticle}>
        <Board
          size={game.boardSize}
          onCellClick={onCell}
          className={`battle-board ${mode ? `mode-${mode}` : ''}`}
          cellClass={(p) => {
            const cls: string[] = []
            if (targets.some((t) => samePos(t, p))) cls.push(`target-${mode}`)
            if (samePos(target, p)) cls.push('chosen')
            const own = game.playerShips.find((s) => s.hp > 0 && samePos(s.pos, p))
            if (own) cls.push('has-ship')
            if (own && own.id === selected) cls.push('selected-ship')
            return cls.join(' ')
          }}
          renderCell={(p) => {
            const own = game.playerShips.find((s) => s.hp > 0 && samePos(s.pos, p))
            const enemy = finished ? game.enemyShips.find((s) => samePos(s.pos, p)) : undefined
            const marker = markers.get(`${p.row},${p.col}`)
            return (
              <>
                {marker && !busy && <span className={`marker ${marker}`} />}
                {own && <ShipBadge cls={own.class} />}
                {enemy && <ShipBadge cls={enemy.class} enemy sunk={enemy.hp <= 0} />}
              </>
            )
          }}
          overlay={
            <>
              {ship?.pos && ui && (
                <CellOverlay at={ship.pos} className="under">
                  <img className="select-ring" src={assets.fx('ring')} alt="" />
                </CellOverlay>
              )}
              {target && mode === 'attack' && ui && (
                <CellOverlay at={target}>
                  <img className="lock-reticle" src={assets.fx('reticle')} alt="" />
                </CellOverlay>
              )}
              {impact && <Impact key={impact.key} at={impact.at} kind={impact.kind} enemyFire={impact.enemyFire} />}
            </>
          }
        />

        <div className="command-dock">
          {finished ? (
            !showResult && (
              <>
                <button className="pill-btn" onClick={() => setShowResult(true)}>
                  戦果報告
                </button>
                <button className="pill-btn ghost" onClick={onHome}>
                  母港へ
                </button>
              </>
            )
          ) : ship ? (
            <>
              <button
                className={`cmd-btn attack ${mode === 'attack' ? 'on' : ''}`}
                disabled={busy || ship.ammo <= 0 || !ship.attackTargets?.length}
                onClick={() => chooseMode('attack')}
              >
                <b>砲撃</b>
                <small>残弾 {ship.ammo}</small>
              </button>
              <button
                className={`cmd-btn move ${mode === 'move' ? 'on' : ''}`}
                disabled={busy || !ship.moveTargets?.length}
                onClick={() => chooseMode('move')}
              >
                <b>移動</b>
                <small>縦横に航行</small>
              </button>
              <button className={`cmd-btn go ${target ? 'ready' : ''}`} disabled={busy || !target} onClick={execute}>
                <b>{target ? (mode === 'attack' ? '撃て！' : '航行！') : '決定'}</b>
                <small>{target ? `${posLabel(target)} ${mode === 'attack' ? 'を砲撃' : 'へ移動'}` : mode ? 'マスを選択' : '行動を選択'}</small>
              </button>
            </>
          ) : (
            <p className="dock-hint">{busy ? '交戦中……' : '▲ 左の艦隊、または海域上の自艦をタップ'}</p>
          )}
        </div>
        {error && <p className="toast error">{error}</p>}
      </main>

      {/* ---- enemy fleet & log ---- */}
      <aside className="fleet-col enemy">
        {game.enemyShips.map((s) => (
          <ShipPlate key={s.id} ship={s} enemy />
        ))}
        <section className="battle-log">
          <h3>戦闘記録</h3>
          <ol>
            {log.map((l) => (
              <li key={l.key} className={`${l.tone} ${l === lastLine ? 'new' : ''}`}>
                <span className="log-turn">T{l.turn}</span>
                {l.text}
              </li>
            ))}
            {log.length === 0 && <li className="muted">まだ交戦記録はありません</li>}
          </ol>
        </section>
      </aside>

      {cutin && <CutinLayer cutin={cutin} onSkip={() => skip.current?.()} />}

      {showResult && (
        <ResultOverlay game={game} report={report(game)} onBoard={() => setShowResult(false)} onHome={onHome} onRetry={onRetry} />
      )}
    </div>
  )
}
