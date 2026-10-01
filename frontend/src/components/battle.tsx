import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DAMAGE_LABEL, damageOf, SKILL_INFO, SPECIAL_INFO, TORPEDO_INFO, type Look } from '../game'
import type { Pos, ShipView, SkillKind, Special } from '../types'
import { ShipArt } from './ShipArt'
import { Pips } from './ui'

export function ShipPlate({
  ship,
  look,
  selected,
  hot,
  onClick,
}: {
  ship: ShipView
  look: Look
  selected?: boolean
  hot?: boolean
  onClick?: () => void
}) {
  const dmg = damageOf(ship)
  const hpPct = (Math.max(ship.hp, 0) / ship.maxHp) * 100
  const enemy = !!look.enemy
  return (
    <button
      type="button"
      className={`plate ${enemy ? 'enemy' : 'player'} dmg-${dmg} ${selected ? 'selected' : ''} ${hot ? 'hot' : ''} ${ship.boss ? 'boss' : ''} r${look.rarity}`}
      onClick={onClick}
      disabled={!onClick || dmg === 'sunk'}
      data-plate={`${enemy ? 'e' : 'p'}${ship.id}`}
    >
      <span className="plate-art">
        <ShipArt look={look} showKanji={false} />
        <span className="plate-no">{ship.id + 1}</span>
      </span>
      <span className="plate-body">
        <span className="plate-name">
          {ship.name}
          {dmg !== 'none' && dmg !== 'sunk' && <em className={`dmg-tag ${dmg}`}>{DAMAGE_LABEL[dmg]}</em>}
          {enemy && ship.spotted && ship.hp > 0 && <em className="spot-tag">追跡</em>}
          {ship.marked && ship.hp > 0 && (
            <em className="lock-tag" title="索敵で捕捉された。次のターンまで攻撃が回避されず必ず会心">
              捕捉
            </em>
          )}
          {ship.pinned && ship.hp > 0 && <em className="pin-tag">水柱</em>}
          {ship.underWay && !ship.pinned && ship.hp > 0 && (
            <em className="sail-tag" title="前のターンに移動した。続けて移動すると後攻になる">
              航行中
            </em>
          )}
        </span>
        <span className={`hp-bar ${hpPct <= 34 ? 'low' : ''}`}>
          <i style={{ width: `${hpPct}%` }} />
          <b>
            {Math.max(ship.hp, 0)}/{ship.maxHp}
          </b>
        </span>
        <span className="plate-meta">
          <span className="speed" title="速力：速い艦から行動する">
            速<b>{ship.speed}</b>
          </span>
          {ship.maxAmmo > 0 && (
            <span className="ammo" title="主砲の残弾">
              砲 <Pips value={ship.ammo} max={Math.min(ship.maxAmmo, 10)} kind="ammo" />
            </span>
          )}
          {ship.maxTorps > 0 && (
            <span className="torps" title="魚雷の残数">
              {TORPEDO_INFO.icon}
              <Pips value={ship.torps} max={ship.maxTorps} kind="ammo" />
            </span>
          )}
          {ship.maxSkill > 0 && (
            <span className="skill" title={SKILL_INFO[ship.skillKind].name}>
              {SKILL_INFO[ship.skillKind].icon}
              <Pips value={ship.skill} max={ship.maxSkill} kind="skill" />
            </span>
          )}
        </span>
      </span>
      {dmg === 'sunk' && <span className="sunk-stamp text">{enemy ? '撃沈' : '轟沈'}</span>}
    </button>
  )
}

export function GaugeBar({ value, enemy }: { value: number; enemy?: boolean }) {
  const full = value >= 100
  return (
    <div className={`gauge ${enemy ? 'enemy' : ''} ${full ? 'full' : ''}`}>
      <span className="gauge-label">{enemy ? '敵決戦' : '決戦ゲージ'}</span>
      <span className="gauge-track">
        <i style={{ width: `${Math.min(value, 100)}%` }} />
        {!enemy && [25, 50, 75].map((m) => <span key={m} className="gauge-tick" style={{ left: `${m}%` }} />)}
      </span>
      <b className="gauge-num">{full ? 'MAX' : `${value}%`}</b>
    </div>
  )
}

export type Cutin =
  | { kind: 'intro'; text: string; sub?: string; boss?: boolean }
  | { kind: 'attack'; look: Look; line: string; title: string; skill?: SkillKind }
  | { kind: 'enemy'; look: Look; title: string }
  | { kind: 'ultimate'; crew: { look: Look; line?: string }[]; enemy?: boolean; speed: number }
  | { kind: 'notice'; side: 'player' | 'cpu'; text: string }
  | { kind: 'banner'; text: string; sub?: string; tone: 'gold' | 'red' | 'blue' | 'rainbow' }
  | { kind: 'turn'; turn: number; left?: number }
  | { kind: 'special'; special: Special; look: Look; line: string; enemy?: boolean }

export function CutinLayer({ cutin, onSkip }: { cutin: Cutin; onSkip?: () => void }) {
  switch (cutin.kind) {
    case 'intro':
      return (
        <div className={`cutin intro ${cutin.boss ? 'boss' : ''}`} onClick={onSkip}>
          <div className="cutin-strip" />
          <div className="cutin-label">
            <span className="fx-label text green">{cutin.text}</span>
            {cutin.sub && <span className="cutin-caption">{cutin.sub}</span>}
          </div>
        </div>
      )
    case 'attack':
      return (
        <div className={`cutin attack ${cutin.skill ? 'skill' : ''}`} onClick={onSkip} style={{ ['--accent' as string]: cutin.look.color }}>
          <div className="speedlines" />
          <div className="cutin-band" />
          <div className="cutin-art">
            <ShipArt look={cutin.look} showKanji={false} />
          </div>
          <div className="cutin-label">
            <span className="fx-label text white">{cutin.title}</span>
            <span className="cutin-caption">
              {cutin.look.name}「{cutin.line}」
            </span>
          </div>
        </div>
      )
    case 'enemy':
      return (
        <div className="cutin enemy" onClick={onSkip}>
          <div className="alert-stripes top" />
          <div className="alert-stripes bottom" />
          <div className="cutin-diag" />
          <div className="cutin-rig">
            <div className="cutin-label">
              <span className="fx-label text red">{cutin.title}</span>
              <span className="cutin-caption">{cutin.look.name}</span>
            </div>
            <div className="cutin-enemy-art">
              <ShipArt look={cutin.look} showKanji={false} />
            </div>
          </div>
        </div>
      )
    case 'ultimate': {
      // Timed in CSS against --k (1 / battle speed): the crew slams in one by one,
      // the screen whites out and the title stamps down a character at a time.
      const k = 1 / cutin.speed
      return (
        <div className={`cutin ultimate ${cutin.enemy ? 'enemy-side' : ''}`} onClick={onSkip} style={{ ['--k' as string]: k }}>
          <div className="ult-sky" />
          <div className="ult-rays" />
          <div className="speedlines fast" />
          <div className="letterbox top" />
          <div className="letterbox bottom" />
          <div className="ult-cards" style={{ ['--n' as string]: cutin.crew.length }}>
            {cutin.crew.map((m, i) => (
              <div key={i} className="ult-card" style={{ ['--i' as string]: i, ['--accent' as string]: m.look.color }}>
                <div className="ult-card-art">
                  <ShipArt look={m.look} showKanji={false} />
                </div>
                <b className="ult-card-name">{m.look.name}</b>
                {m.line && <span className="ult-card-line">「{m.line}」</span>}
              </div>
            ))}
          </div>
          <div className="ult-whiteout" />
          <div className="ult-shock" />
          <div className="ult-shock late" />
          <div className="ult-title">
            <small>{cutin.enemy ? 'ENEMY ALL FLEET BARRAGE' : 'ALL FLEET BARRAGE'}</small>
            <span className="ult-kanji">
              {[...'全艦斉射'].map((ch, i) => (
                <i key={i} style={{ ['--i' as string]: i }}>
                  {ch}
                </i>
              ))}
            </span>
            <em>{cutin.enemy ? '総員、衝撃に備えよ！' : '装甲貫通・回避不能 ── 全砲門、開けッ！'}</em>
          </div>
        </div>
      )
    }
    case 'notice':
      return (
        <div className={`cutin notice ${cutin.side}`}>
          <div className="notice-band">
            <span>{cutin.text}</span>
          </div>
        </div>
      )
    case 'banner':
      return (
        <div className={`cutin banner ${cutin.tone}`} onClick={onSkip}>
          <div className="banner-text">
            {cutin.text}
            {cutin.sub && <small>{cutin.sub}</small>}
          </div>
        </div>
      )
    case 'special': {
      const info = SPECIAL_INFO[cutin.special]
      return (
        <div className={`cutin special ${cutin.special} ${cutin.enemy ? 'enemy-side' : ''}`} onClick={onSkip} style={{ ['--accent' as string]: cutin.look.color }}>
          <div className="special-flash" />
          <div className="speedlines fast" />
          <div className="special-rays" />
          <div className="special-art">
            <ShipArt look={cutin.look} showKanji={false} />
          </div>
          <div className="special-title">
            <small>{info.en}</small>
            <b>{info.name}</b>
            <span className="cutin-caption">
              {cutin.look.name}「{cutin.line}」
            </span>
          </div>
        </div>
      )
    }
    case 'turn':
      return (
        <div className="cutin turn" key={cutin.turn}>
          <div className={`turn-flash ${cutin.left !== undefined && cutin.left <= 3 ? 'urgent' : ''}`}>
            <small>YOUR TURN</small>
            TURN {cutin.turn}
            {cutin.left !== undefined && cutin.left <= 3 && <em>残り {cutin.left} ターン！</em>}
          </div>
        </div>
      )
  }
}

export interface Float {
  id: number
  at: Pos
  text: string
  kind: 'dmg' | 'crit' | 'evade' | 'miss' | 'splash' | 'sunk' | 'hurt' | 'found' | 'combo'
  tier?: number // 0 normal, 1 big, 2 huge: how hard the hit was for its victim
}

export function FloatText({ f, children }: { f: Float; children?: ReactNode }) {
  return <span className={`float-text ${f.kind} t${f.tier ?? 0}`}>{children ?? f.text}</span>
}

// Tally is the running damage of one action, shown large beside the board.
export interface Tally {
  key: number
  total: number
  hits: number
  enemy: boolean
  scale: number // average max HP of the fleet taking the hits
  rating?: string // set once the action has landed
}

// tallyTier grades damage against the fleet it hit: 1 a good hit, 3 half a fleet's worth of ship gone.
export function tallyTier(total: number, scale: number) {
  const r = total / Math.max(scale, 1)
  return r >= 1.2 ? 3 : r >= 0.7 ? 2 : r >= 0.35 ? 1 : 0
}

export function DamageTally({ t }: { t: Tally }) {
  const [shown, setShown] = useState(0)
  const shownRef = useRef(0)
  // Count up to the new total rather than jumping to it.
  useEffect(() => {
    const from = shownRef.current
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 320)
      const v = Math.round(from + (t.total - from) * (1 - (1 - k) ** 3))
      shownRef.current = v
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [t.total])
  const tier = tallyTier(shown, t.scale)
  return (
    <div className={`dmg-tally t${tier} ${t.enemy ? 'enemy' : ''} ${t.rating !== undefined ? 'done' : ''}`}>
      <small>{t.enemy ? 'DAMAGE TAKEN' : t.hits > 1 ? `${t.hits} HITS` : 'DAMAGE'}</small>
      <b key={t.hits}>{shown.toLocaleString()}</b>
      {t.rating && <em>{t.rating}</em>}
    </div>
  )
}

// ---------------- projectiles ----------------

type Pt = { x: number; y: number }

function spawn(layer: HTMLElement, cls: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = cls
  layer.appendChild(el)
  return el
}

/** A shell flying on an arc; resolves on impact. */
export function flyShell(layer: HTMLElement | null, from: Pt, to: Pt, ms: number, enemy = false): Promise<void> {
  if (!layer || ms <= 0) return Promise.resolve()
  const el = spawn(layer, `shell ${enemy ? 'enemy' : ''}`)
  const n = 16
  const lift = Math.max(80, Math.hypot(to.x - from.x, to.y - from.y) * 0.5)
  const frames: Keyframe[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = from.x + (to.x - from.x) * t
    const y = from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * lift
    const s = 1 + Math.sin(t * Math.PI) * 0.6
    frames.push({ transform: `translate(${x}px, ${y}px) scale(${s})` })
  }
  return el
    .animate(frames, { duration: ms, easing: 'cubic-bezier(.35,.1,.6,1)' })
    .finished.catch(() => undefined)
    .then(() => el.remove())
}

/** A torpedo running straight along cells; calls onCell as it passes each. */
export async function runTorpedo(layer: HTMLElement | null, pts: Pt[], msPerCell: number, onCell: (i: number) => void) {
  if (!layer || !pts.length) return
  const el = spawn(layer, 'torpedo')
  const angle = pts.length > 1 ? (Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) * 180) / Math.PI : 0
  for (let i = 0; i < pts.length; i++) {
    const a = i === 0 ? pts[0] : pts[i - 1]
    const b = pts[i]
    await el
      .animate(
        [{ transform: `translate(${a.x}px, ${a.y}px) rotate(${angle}deg)` }, { transform: `translate(${b.x}px, ${b.y}px) rotate(${angle}deg)` }],
        { duration: i === 0 ? msPerCell * 0.5 : msPerCell, fill: 'forwards' },
      )
      .finished.catch(() => undefined)
    onCell(i)
  }
  el.remove()
}

/** A plane crossing the stage over the target; resolves when the bomb lands. */
export function flyPlane(layer: HTMLElement | null, to: Pt, ms: number): Promise<void> {
  if (!layer || ms <= 0) return Promise.resolve()
  const plane = spawn(layer, 'plane')
  plane.textContent = '✈'
  const y = to.y - 150
  plane
    .animate([{ transform: `translate(-80px, ${y + 60}px)` }, { transform: `translate(1360px, ${y - 60}px)` }], { duration: ms * 1.6, easing: 'linear' })
    .finished.catch(() => undefined)
    .then(() => plane.remove())
  const dropAt = (to.x + 80) / 1440
  return new Promise((r) =>
    setTimeout(
      () => {
        const bomb = spawn(layer, 'shell bomb')
        bomb
          .animate([{ transform: `translate(${to.x}px, ${y}px) scale(.6)` }, { transform: `translate(${to.x}px, ${to.y}px) scale(1.1)` }], {
            duration: ms * 0.35,
            easing: 'ease-in',
          })
          .finished.catch(() => undefined)
          .then(() => {
            bomb.remove()
            r()
          })
      },
      ms * 1.6 * dropAt,
    ),
  )
}
