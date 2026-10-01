import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { audio } from '../audio'
import { Backdrop, TopBar } from '../components/ui'
import { useGame } from '../state'
import type { Board, RankEntry, Ranking as RankingT } from '../types'
import { FriendFace } from './Friends'

const BOARDS: { id: Board; name: string; icon: string; desc: string; score: (n: number) => string }[] = [
  { id: 'level', name: '提督レベル', icon: '🎖', desc: '提督レベルの高い順。同じレベルなら経験値の多い順です。', score: (n) => `Lv.${n}` },
  { id: 'power', name: '艦隊戦力', icon: '⚓', desc: '編成中の艦隊の戦力の合計。艦の育成と編成で上がります。', score: (n) => n.toLocaleString() },
  { id: 'wins', name: '勝利数', icon: '🏆', desc: 'これまでに勝利した戦闘の数です。', score: (n) => `${n.toLocaleString()} 勝` },
  { id: 'endless', name: '無限海域', icon: '🌀', desc: '無限海域で突破した最深の層です。', score: (n) => `第${n}層` },
]

// Mirrors the server's meta.RankingSize.
const RANKING_SIZE = 100

/** 1st to 3rd get a medal, the rest a number. */
function Place({ rank }: { rank: number }) {
  return <span className={`rank-place ${rank <= 3 ? `medal m${rank}` : ''}`}>{rank}</span>
}

export function Ranking({ onBack }: { onBack: () => void }) {
  const { profile, notify } = useGame()
  const [board, setBoard] = useState<Board>('level')
  // Boards already fetched this visit; switching back shows them at once.
  const [boards, setBoards] = useState<Partial<Record<Board, RankingT>>>({})
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    let live = true
    api
      .ranking(board)
      .then((r) => live && setBoards((b) => ({ ...b, [board]: r.ranking })))
      .catch((e) => notify((e as Error).message, 'error'))
    return () => {
      live = false
    }
  }, [board, notify])

  if (!profile) return null
  const info = BOARDS.find((b) => b.id === board)!
  const r = boards[board]

  const pick = (b: Board) => {
    if (b === board) return
    audio.play('select')
    setBoard(b)
    listRef.current?.scrollTo({ top: 0 })
  }

  const toMe = () => {
    const row = listRef.current?.querySelector<HTMLElement>('.rank-row.me')
    if (!row) return
    audio.play('select')
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const me = r?.me
  const listed = !!r?.entries.some((e) => e.me)

  return (
    <div className="screen ranking-screen">
      <Backdrop scene="standby" />
      <TopBar title="ランキング" en="RANKING" onBack={onBack} />

      {/* ---- where I stand ---- */}
      <aside className="ranking-side">
        <section className={`my-rank ${me?.rank && me.rank <= 3 ? 'podium' : ''}`}>
          <h2>あなたの順位</h2>
          <div className="my-rank-head">
            <FriendFace secretary={profile.ships.find((s) => s.uid === profile.secretary)?.card ?? ''} big />
            <p className="my-rank-name">
              <small>Lv.{profile.level}</small>
              <b>{profile.name}</b>
            </p>
          </div>
          <p className="my-rank-place" data-rank={me?.rank ?? ''}>
            {!me ? '…' : me.rank ? (
              <>
                第<b>{me.rank.toLocaleString()}</b>位
              </>
            ) : (
              <span className="muted">ランク外</span>
            )}
          </p>
          <p className="my-rank-score">
            {info.icon} {info.name} <b>{me ? info.score(me.score) : '—'}</b>
          </p>
          {r && (
            <small>
              {me?.rank ? `全 ${r.total.toLocaleString()} 名中` : `${info.name}の記録を作るとランキングに載ります`}
            </small>
          )}
          {listed && (
            <button className="chip-btn" onClick={toMe}>
              リストで自分を見る
            </button>
          )}
        </section>
        <section className="ranking-about">
          <h2>{info.name}ランキング</h2>
          <p>{info.desc}</p>
          <small>上位 {RANKING_SIZE} 名まで表示します。同じ記録の提督は同じ順位です。</small>
        </section>
      </aside>

      {/* ---- the board ---- */}
      <nav className="dock-tabs ranking-tabs">
        {BOARDS.map((b) => (
          <button key={b.id} className={board === b.id ? 'on' : ''} onClick={() => pick(b.id)}>
            {b.icon} {b.name}
          </button>
        ))}
      </nav>

      <ol className="ranking-list" ref={listRef} aria-label={`${info.name}ランキング`}>
        {!r ? (
          <li className="friend-empty">読み込み中…</li>
        ) : r.entries.length ? (
          r.entries.map((e, i) => <RankRow key={`${board}-${i}`} e={e} i={i} score={info.score(e.score)} />)
        ) : (
          <li className="friend-empty">まだランキングに載っている提督はいません</li>
        )}
      </ol>
    </div>
  )
}

function RankRow({ e, i, score }: { e: RankEntry; i: number; score: string }) {
  return (
    <li className={`rank-row ${e.me ? 'me' : ''} ${e.rank <= 3 ? `top m${e.rank}` : ''}`} data-rank={e.rank} style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}>
      <Place rank={e.rank} />
      <FriendFace secretary={e.secretary} />
      <span className="friend-name">
        <small>
          Lv.{e.level}
          {e.me && <i className="rank-tag me">あなた</i>}
          {e.friend && <i className="rank-tag friend">フレンド</i>}
        </small>
        <b>{e.name}</b>
        {e.comment && <em>{e.comment}</em>}
      </span>
      <span className="rank-score">{score}</span>
    </li>
  )
}
