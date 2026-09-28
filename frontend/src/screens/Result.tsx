import { useEffect, useState } from 'react'
import { Portrait } from '../components/ui'
import type { Report } from '../game'
import { assets, backdropUrl, sound, useAssets } from '../theme'
import type { GameView } from '../types'

const RANK_TEXT = {
  S: '完全勝利',
  A: '勝利',
  B: '辛勝',
  C: '戦術的敗北',
  D: '敗北',
  E: '惨敗',
} as const

export function ResultOverlay({
  game,
  report,
  onBoard,
  onHome,
  onRetry,
}: {
  game: GameView
  report: Report
  onBoard: () => void
  onHome: () => void
  onRetry: () => void
}) {
  const packs = useAssets()
  // Reveal in beats: header → stats → rank stamp → buttons.
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    const ts = [400, 1100, 1900].map((ms, i) =>
      window.setTimeout(() => {
        setBeat(i + 1)
        if (i === 1) sound.se(report.win ? 'explosion3' : 'explosion2', 0.5)
      }, ms),
    )
    return () => ts.forEach(clearTimeout)
  }, [])

  const bg = backdropUrl('result', packs)
  const accuracy = report.shots ? Math.round((report.hits / report.shots) * 100) : 0

  return (
    <div className={`result ${report.win ? 'win' : 'lose'}`} onClick={() => setBeat(3)}>
      <div className="result-bg" style={bg ? { backgroundImage: `url(${bg})` } : undefined} />
      <header className="result-head">
        <span className="result-en">{report.win ? 'VICTORY' : 'DEFEAT'}</span>
        <h2>{report.win ? '作戦成功' : '作戦失敗'}</h2>
      </header>

      <div className="result-body">
        {report.mvp ? (
          <div className={`mvp ${beat >= 1 ? 'in' : ''}`}>
            <div className="mvp-art">
              <Portrait cls={report.mvp.class} />
            </div>
            <div className="mvp-tag">
              <b>MVP</b>
              {report.mvp.name}
              <small>命中 {report.mvpHits}</small>
            </div>
          </div>
        ) : (
          <div className="mvp" />
        )}

        <dl className={`result-stats ${beat >= 1 ? 'in' : ''}`}>
          <div>
            <dt>決着ターン</dt>
            <dd>{game.turn}</dd>
          </div>
          <div>
            <dt>撃沈</dt>
            <dd>
              {report.sunkEnemies}
              <small> / {game.enemyShips.length}</small>
            </dd>
          </div>
          <div>
            <dt>損失</dt>
            <dd className={report.lostShips ? 'bad' : ''}>
              {report.lostShips}
              <small> / {game.playerShips.length}</small>
            </dd>
          </div>
          <div>
            <dt>命中率</dt>
            <dd>
              {accuracy}
              <small>%</small>
            </dd>
          </div>
        </dl>

        <div className={`rank rank-${report.rank} ${beat >= 2 ? 'in' : ''}`}>
          <span className="rank-label">戦闘評価</span>
          <span className="rank-letter">{report.rank}</span>
          <span className="rank-text">{RANK_TEXT[report.rank]}</span>
          {packs.ui && report.win && <img className="rank-ring" src={assets.fx('ring')} alt="" />}
        </div>
      </div>

      <footer className={`result-actions ${beat >= 3 ? 'in' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button className="pill-btn ghost" onClick={onBoard}>
          盤面を確認
        </button>
        <button className="pill-btn" onClick={onHome}>
          母港へ帰投
        </button>
        <button className="pill-btn gold" onClick={onRetry}>
          再出撃
        </button>
      </footer>
    </div>
  )
}
