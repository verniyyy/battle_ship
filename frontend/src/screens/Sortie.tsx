import { useEffect, useState } from 'react'
import { api } from '../api'
import { Board } from '../components/Board'
import { Backdrop, BackButton, Banner, Pips, Portrait, ShipBadge, ShipToken } from '../components/ui'
import { sound } from '../theme'
import { posLabel, samePos, type FleetInfo, type GameResponse, type Pos } from '../types'

export function Sortie({ onDeploy, onBack }: { onDeploy: (g: GameResponse) => void; onBack: () => void }) {
  const [fleet, setFleet] = useState<FleetInfo | null>(null)
  const [placements, setPlacements] = useState<(Pos | null)[]>([])
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    sound.playBgm('title')
    api
      .fleet()
      .then((f) => {
        setFleet(f)
        setPlacements(f.ships.map(() => null))
      })
      .catch((e) => setError(e.message))
  }, [])

  const shipAt = (p: Pos) => placements.findIndex((q) => samePos(q, p))

  const select = (i: number) => {
    setSelected(i)
    sound.se('click', 0.3)
  }

  const onCell = (p: Pos) => {
    const occupant = shipAt(p)
    if (occupant >= 0) {
      select(occupant)
      return
    }
    sound.se('move', 0.3)
    const next = placements.map((q, i) => (i === selected ? p : q))
    setPlacements(next)
    const unplaced = next.findIndex((q) => q === null)
    if (unplaced >= 0) setSelected(unplaced)
  }

  const randomize = () => {
    if (!fleet) return
    sound.se('move', 0.3)
    const cells = Array.from({ length: fleet.boardSize ** 2 }, (_, i) => i).sort(() => Math.random() - 0.5)
    setPlacements(fleet.ships.map((_, i) => ({ row: Math.floor(cells[i] / fleet.boardSize), col: cells[i] % fleet.boardSize })))
  }

  const reset = () => {
    if (!fleet) return
    sound.se('click', 0.3)
    setPlacements(fleet.ships.map(() => null))
    setSelected(0)
  }

  const ready = placements.length > 0 && placements.every((p) => p !== null)
  const placedCount = placements.filter(Boolean).length

  const deploy = async () => {
    setBusy(true)
    setError(null)
    try {
      sound.se('launch')
      onDeploy(await api.createGame(placements as Pos[]))
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const current = fleet?.ships[selected]

  return (
    <div className="screen sortie-screen">
      <Backdrop scene="standby" dim={0.45} />

      <header className="screen-head">
        <BackButton label="母港" onClick={onBack} />
        <div className="head-title">
          <span className="head-en">FORMATION</span>
          <h1>出撃準備</h1>
        </div>
        <span className="head-step">
          配置 <b>{placedCount}</b> / {fleet?.ships.length ?? 3}
        </span>
      </header>

      {!fleet ? (
        <p className={`center-msg ${error ? 'error' : ''}`}>{error ?? '艦隊情報を受信中…'}</p>
      ) : (
        <>
          <section className="fleet-list">
            <h2 className="panel-title">第一艦隊</h2>
            {fleet.ships.map((s, i) => (
              <button key={s.class} type="button" className={`fleet-card ${selected === i ? 'selected' : ''}`} onClick={() => select(i)}>
                <span className="fleet-no">{i + 1}</span>
                <Banner cls={s.class} state="b" />
                <span className="fleet-stats">
                  <span>
                    耐久 <Pips value={s.hp} max={s.hp} kind="hp" />
                  </span>
                  <span>
                    主砲 <Pips value={s.ammo} max={s.ammo} kind="ammo" />
                  </span>
                </span>
                <span className={`fleet-pos ${placements[i] ? 'done' : ''}`}>{placements[i] ? posLabel(placements[i]!) : '未配置'}</span>
              </button>
            ))}
            <div className="fleet-tools">
              <button className="pill-btn" onClick={randomize}>
                おまかせ配置
              </button>
              <button className="pill-btn ghost" onClick={reset}>
                リセット
              </button>
            </div>
          </section>

          <section className="sortie-board">
            <p className="board-hint">
              {current ? (
                <>
                  <ShipBadge cls={current.class} /> <b>{current.name}</b> を配置する海域をタップ
                </>
              ) : null}
            </p>
            <Board
              size={fleet.boardSize}
              onCellClick={onCell}
              cellClass={(p) => (shipAt(p) >= 0 ? `has-ship ${shipAt(p) === selected ? 'selected-ship' : ''}` : 'placeable')}
              renderCell={(p) => {
                const i = shipAt(p)
                return i >= 0 ? <ShipToken cls={fleet.ships[i].class} no={i + 1} /> : null
              }}
            />
          </section>

          {current && (
            <div className="sortie-portrait" key={current.class}>
              <Portrait cls={current.class} />
              <div className="portrait-name">
                <small>{current.class.toUpperCase()}</small>
                {current.name}
              </div>
            </div>
          )}

          {error && <p className="toast error">{error}</p>}

          <button className={`go-btn ${ready ? 'ready' : ''}`} disabled={!ready || busy} onClick={deploy}>
            <span className="go-en">LAUNCH</span>
            <span className="go-jp">出撃！</span>
          </button>
        </>
      )}
    </div>
  )
}
