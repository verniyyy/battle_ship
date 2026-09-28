import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Backdrop, Banner, Modal, Portrait, SoundToggle } from '../components/ui'
import { SECRETARY_LINES, TIPS } from '../game'
import { assets, sound, useAssets } from '../theme'
import type { GameSummary, ShipClass, Stats } from '../types'

const SECRETARY_KEY = 'secretary'
const CLASSES: { cls: ShipClass; name: string }[] = [
  { cls: 'battleship', name: '戦艦' },
  { cls: 'destroyer', name: '駆逐艦' },
  { cls: 'submarine', name: '潜水艦' },
]

function loadSecretary(): ShipClass {
  try {
    const v = localStorage.getItem(SECRETARY_KEY)
    if (v === 'battleship' || v === 'destroyer' || v === 'submarine') return v
  } catch {
    /* storage unavailable */
  }
  return 'destroyer'
}

type Dialog = 'record' | 'rules' | 'secretary' | null

export function Home({ onSortie, onResume }: { onSortie: () => void; onResume?: () => void }) {
  const { legacy, ui } = useAssets()
  const [stats, setStats] = useState<Stats | null>(null)
  const [games, setGames] = useState<GameSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [secretary, setSecretary] = useState<ShipClass>(loadSecretary)
  const [line, setLine] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const lineTimer = useRef<number>(undefined)

  useEffect(() => {
    sound.playBgm('title')
    Promise.all([api.stats(), api.history(20)])
      .then(([s, h]) => {
        setStats(s)
        setGames(h.games)
      })
      .catch((e) => setError(`司令部との通信に失敗: ${e.message}`))
    // Greet on arrival.
    const t = window.setTimeout(() => say(SECRETARY_LINES[secretary][0]), 700)
    return () => {
      clearTimeout(t)
      clearTimeout(lineTimer.current)
    }
  }, [])

  const say = (text: string) => {
    setLine(text)
    clearTimeout(lineTimer.current)
    lineTimer.current = window.setTimeout(() => setLine(null), 4200)
  }

  const poke = () => {
    const lines = SECRETARY_LINES[secretary]
    say(lines[Math.floor(Math.random() * lines.length)])
    if (secretary === 'destroyer') sound.voice()
    else sound.se('click', 0.3)
  }

  const open = (d: Dialog) => {
    sound.se('click', 0.3)
    setDialog(d)
  }

  const chooseSecretary = (cls: ShipClass) => {
    setSecretary(cls)
    try {
      localStorage.setItem(SECRETARY_KEY, cls)
    } catch {
      /* storage unavailable */
    }
    setDialog(null)
    window.setTimeout(() => say(SECRETARY_LINES[cls][0]), 250)
  }

  const played = stats?.played ?? 0
  const wins = stats?.wins ?? 0
  const rate = played ? Math.round((wins / played) * 100) : 0
  const level = 1 + wins * 2 + (played - wins)

  return (
    <div className="screen home-screen">
      <Backdrop scene="home" dim={0.15} />
      <div className="home-vignette" />

      {/* ---- header ---- */}
      <header className="hud-top">
        <div className="admiral-plate">
          <div className="admiral-lv">
            <small>Lv</small>
            {level}
          </div>
          <div className="admiral-info">
            <span className="admiral-name">提督</span>
            <span className="admiral-rank">{wins >= 10 ? '元帥' : wins >= 5 ? '大将' : wins >= 2 ? '中佐' : '新米少佐'}</span>
            <span className="exp-bar">
              <i style={{ width: `${rate}%` }} />
            </span>
          </div>
        </div>
        <div className="resources">
          <span className="res">
            <b className="res-icon sortie">⚓</b>
            <em>出撃</em>
            {played}
          </span>
          <span className="res">
            <b className="res-icon win">★</b>
            <em>勝利</em>
            {wins}
          </span>
          <span className="res">
            <b className="res-icon lose">✕</b>
            <em>敗北</em>
            {stats?.losses ?? 0}
          </span>
          <span className="res">
            <b className="res-icon rate">%</b>
            <em>勝率</em>
            {rate}
          </span>
        </div>
        <SoundToggle />
      </header>

      {/* ---- secretary ---- */}
      <button className={`secretary ${secretary}`} onClick={poke} aria-label="秘書艦に話しかける">
        <Portrait cls={secretary} className="secretary-art" key={secretary} />
      </button>
      {line && (
        <div className="speech" key={line}>
          <span className="speech-name">{CLASSES.find((c) => c.cls === secretary)?.name}</span>
          {line}
        </div>
      )}

      {/* ---- main menu ---- */}
      <nav className="home-menu">
        <div className="sortie-wrap">
          {ui && <img className="sortie-ring" src={assets.fx('ring')} alt="" />}
          <button
            className="sortie-btn"
            onClick={() => {
              sound.se('launch', 0.5)
              ;(onResume ?? onSortie)()
            }}
          >
            <span className="sortie-en">{onResume ? 'RESUME' : 'SORTIE'}</span>
            <span className="sortie-jp">{onResume ? '再開' : '出撃'}</span>
          </button>
        </div>
        {onResume && (
          <button className="pill-btn warn" onClick={() => {
              sound.se('click', 0.3)
              onSortie()
            }}>
            新たに出撃する
          </button>
        )}
        <div className="sub-menu">
          <button className="round-btn" onClick={() => open('record')}>
            <b>📜</b>戦績
          </button>
          <button className="round-btn" onClick={() => open('rules')}>
            <b>📘</b>作戦要綱
          </button>
          <button className="round-btn" onClick={() => open('secretary')}>
            <b>🎖</b>秘書艦
          </button>
        </div>
      </nav>

      {/* ---- ticker ---- */}
      <div className="ticker">
        <span className="ticker-tag">司令部通達</span>
        <div className="ticker-track">
          <p>{error ?? TIPS.join('　／　')}</p>
        </div>
      </div>

      {dialog === 'record' && (
        <Modal title="戦績" onClose={() => setDialog(null)} wide>
          <div className="record-sum">
            <div>
              <span className="big">{played}</span>出撃
            </div>
            <div className="win">
              <span className="big">{wins}</span>勝利
            </div>
            <div className="lose">
              <span className="big">{stats?.losses ?? 0}</span>敗北
            </div>
            <div className="rate">
              <span className="big">{rate}</span>%
            </div>
          </div>
          {games.length ? (
            <ul className="record-list">
              {games.map((g) => (
                <li key={g.id} className={g.winner === 'player' ? 'win' : 'lose'}>
                  <span className="rec-badge">{g.winner === 'player' ? '勝利' : '敗北'}</span>
                  <span>{new Date(g.finishedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <span className="rec-turn">{g.turn} ターン</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted center">まだ戦績がありません。出撃しましょう！</p>
          )}
        </Modal>
      )}

      {dialog === 'rules' && (
        <Modal title="作戦要綱" onClose={() => setDialog(null)} wide>
          <ol className="rules">
            <li>
              <b>配置</b>自艦隊 3 隻（戦艦・駆逐艦・潜水艦）を 5×5 の海域に配置します。敵艦隊も同じ海域のどこかに潜んでいます。
            </li>
            <li>
              <b>行動</b>毎ターン 1 隻を選び、<em>砲撃</em>（周囲 8 マスのどこか・主砲 1 消費）か<em>移動</em>（縦横に何マスでも）を指示します。
            </li>
            <li>
              <b>報告</b>砲撃結果は「<em>命中</em>」「<em>水しぶき</em>（着弾点の周囲に敵艦あり）」「外れ」で報告されます。
            </li>
            <li>
              <b>索敵</b>移動は「どの艦が・どの方角へ・何マス」動いたかが相手に伝わります。
            </li>
            <li>
              <b>勝敗</b>全艦が撃沈、または弾切れになった側の負けです。
            </li>
          </ol>
          <p className="muted">戦果に応じて S〜E の評価が与えられます。無傷で完全勝利を目指しましょう。</p>
        </Modal>
      )}

      {dialog === 'secretary' && (
        <Modal title="秘書艦を選択" onClose={() => setDialog(null)}>
          <div className="secretary-pick">
            {CLASSES.map((c) => (
              <button key={c.cls} className={`pick-card ${c.cls === secretary ? 'on' : ''}`} onClick={() => chooseSecretary(c.cls)}>
                <Banner cls={c.cls} state="b" />
                <span>{c.name}</span>
                {c.cls === secretary && <em>秘書艦</em>}
              </button>
            ))}
          </div>
          {!legacy && <p className="muted">立ち絵素材が無いため、紋章で表示しています。</p>}
        </Modal>
      )}
    </div>
  )
}
