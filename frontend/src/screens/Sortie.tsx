import { useState } from 'react'
import { api } from '../api'
import { audio } from '../audio'
import { Board } from '../components/Board'
import { Backdrop, CardView, ShipToken, TopBar } from '../components/ui'
import { fx } from '../fx'
import { lookOfCard, stageLabel, usesLine } from '../game'
import { useGame } from '../state'
import { posLabel, samePos, type MatchResponse, type Pos, type Stage } from '../types'

export function Sortie({
  stage,
  onDeploy,
  onBack,
  onFormation,
}: {
  stage: Stage
  onDeploy: (m: MatchResponse) => void
  onBack: () => void
  onFormation: () => void
}) {
  const { profile, card, notify } = useGame()
  const n = profile?.fleet.length ?? 0
  const [placements, setPlacements] = useState<(Pos | null)[]>(() => Array(n).fill(null))
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  if (!profile) return null

  const fleet = profile.fleet.map((uid) => profile.ships.find((s) => s.uid === uid)!)
  const shipAt = (p: Pos) => placements.findIndex((q) => samePos(q, p))
  const size = stage.size

  const select = (i: number) => {
    setSelected(i)
    audio.play('tap')
  }

  const onCell = (p: Pos) => {
    const occupant = shipAt(p)
    if (occupant >= 0) {
      select(occupant)
      return
    }
    audio.play('move')
    const el = document.querySelector(`[data-cell="${p.row}-${p.col}"]`)
    const c = fx.center(el)
    fx.ring(c.x, c.y, '#9fe8ff', 50, 0.4)
    const next = placements.map((q, i) => (i === selected ? p : q))
    setPlacements(next)
    const unplaced = next.findIndex((q) => q === null)
    if (unplaced >= 0) setSelected(unplaced)
  }

  const randomize = () => {
    audio.play('move')
    const cells = Array.from({ length: size * size }, (_, i) => i).sort(() => Math.random() - 0.5)
    setPlacements(fleet.map((_, i) => ({ row: Math.floor(cells[i] / size), col: cells[i] % size })))
  }

  const reset = () => {
    audio.play('back')
    setPlacements(Array(n).fill(null))
    setSelected(0)
  }

  const ready = placements.length === n && placements.every((p) => p !== null)

  const deploy = async () => {
    setBusy(true)
    try {
      audio.play('charge')
      fx.flash('#bfe9ff', 400, 0.5)
      onDeploy(await api.createGame(stage.id, placements as Pos[]))
    } catch (e) {
      notify((e as Error).message, 'error')
      setBusy(false)
    }
  }

  const current = fleet[selected]
  const currentCard = current ? card(current.card) : undefined

  return (
    <div className="screen sortie-screen">
      <Backdrop scene="standby" />
      <TopBar title="出撃準備" en="DEPLOYMENT" onBack={onBack} />

      <section className="fleet-list">
        <h2 className="panel-title">
          第一艦隊
          <button className="mini-btn" onClick={onFormation}>
            編成変更
          </button>
        </h2>
        {fleet.map((s, i) => {
          const c = card(s.card)
          if (!c) return null
          return (
            <button key={s.uid} type="button" className={`fleet-card ${selected === i ? 'selected' : ''}`} onClick={() => select(i)}>
              <span className="fleet-no">{i + 1}</span>
              <CardView look={lookOfCard(c)} size="xs" />
              <span className="fleet-stats">
                <b>
                  {c.name} <small>Lv.{s.level}</small>
                </b>
                <span>
                  耐久 {s.stats.hp}・速力 {s.stats.speed}
                </span>
                <span>{usesLine(s.stats, c.class)}</span>
              </span>
              <span className={`fleet-pos ${placements[i] ? 'done' : ''}`}>{placements[i] ? posLabel(placements[i]!) : '未配置'}</span>
            </button>
          )
        })}
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
        <p className="board-hint">{currentCard ? <><b>{currentCard.name}</b> を配置する海域をタップ</> : null}</p>
        <Board
          size={size}
          span={size >= 7 ? 460 : 440}
          onCellClick={onCell}
          cellClass={(p) => (shipAt(p) >= 0 ? `has-ship ${shipAt(p) === selected ? 'selected-ship' : ''}` : 'placeable')}
          renderCell={(p) => {
            const i = shipAt(p)
            const c = i >= 0 ? card(fleet[i].card) : undefined
            return c ? <ShipToken look={lookOfCard(c)} no={i + 1} /> : null
          }}
        />
      </section>

      <aside className="sortie-side">
        <div className="sortie-stage">
          <span className={`stage-id ${stage.boss ? 'boss' : ''}`}>{stageLabel(stage)}</span>
          <b>{stage.name}</b>
          <small>
            {size}×{size} 海域{stage.maxTurns ? ` ／ ${stage.maxTurns}ターン` : ''}
          </small>
        </div>
        {currentCard && current && (
          <div className="sortie-portrait" key={current.uid}>
            <CardView look={lookOfCard(currentCard)} level={current.level} stars={current.stars} size="lg" />
            <p className="sortie-quote">「{currentCard.intro}」</p>
          </div>
        )}
        <button className={`go-btn ${ready ? 'ready' : ''}`} disabled={!ready || busy} onClick={deploy}>
          <span className="go-en">LAUNCH</span>
          <span className="go-jp">出撃！</span>
        </button>
      </aside>
    </div>
  )
}
