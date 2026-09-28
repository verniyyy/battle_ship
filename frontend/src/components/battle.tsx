import { useEffect, useState } from 'react'
import { DAMAGE_LABEL, damageOf } from '../game'
import { assets, useAssets } from '../theme'
import { posLabel, type Pos, type ShipClass, type ShipView } from '../types'
import { CellOverlay } from './Board'
import { Banner, FxLabel, Pips, Portrait } from './ui'

export function ShipPlate({
  ship,
  enemy,
  selected,
  onClick,
}: {
  ship: ShipView
  enemy?: boolean
  selected?: boolean
  onClick?: () => void
}) {
  const { legacy } = useAssets()
  const dmg = damageOf(ship)
  const state = dmg === 'sunk' ? 'd' : dmg === 'none' ? 'b' : 'c'
  const hpPct = (ship.hp / ship.maxHp) * 100
  return (
    <button
      type="button"
      className={`plate ${enemy ? 'enemy' : 'player'} dmg-${dmg} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      disabled={!onClick || dmg === 'sunk'}
    >
      <span className="fleet-no">{ship.id + 1}</span>
      <span className="plate-banner">
        <Banner cls={ship.class} state={state} enemy={enemy} />
        {dmg !== 'none' && dmg !== 'sunk' && <span className={`dmg-tag ${dmg}`}>{DAMAGE_LABEL[dmg]}</span>}
      </span>
      <span className="plate-body">
        <span className="plate-name">
          {enemy ? '敵' : ''}
          {ship.name}
          {!enemy && ship.pos && dmg !== 'sunk' && <small>{posLabel(ship.pos)}</small>}
        </span>
        <span className="hp-bar">
          <i style={{ width: `${hpPct}%` }} />
          <b>
            {ship.hp}/{ship.maxHp}
          </b>
        </span>
        <span className="plate-ammo">
          主砲 <Pips value={ship.ammo} max={ship.maxAmmo} kind="ammo" />
        </span>
      </span>
      {dmg === 'sunk' &&
        (legacy ? <img className="sunk-stamp" src={assets.sunk} alt="撃沈" /> : <span className="sunk-stamp text">撃沈</span>)}
    </button>
  )
}

export type ImpactKind = 'hit' | 'sunk' | 'splash' | 'miss'

const IMPACT_TEXT: Record<ImpactKind, string> = { hit: '命中！', sunk: '撃沈！', splash: '水しぶき', miss: 'MISS' }
const FRAMES = 20 // explosion.png is a 5x4 sheet of 96px frames

// Shell impact drawn over a board cell: explosion or water column plus a popup word.
export function Impact({ at, kind, enemyFire }: { at: Pos; kind: ImpactKind; enemyFire?: boolean }) {
  const { legacy, ui } = useAssets()
  const [frame, setFrame] = useState(0)
  const boom = kind === 'hit' || kind === 'sunk'

  useEffect(() => {
    if (!legacy || !boom) return
    const t = setInterval(() => setFrame((f) => (f + 1 < FRAMES ? f + 1 : f)), 40)
    return () => clearInterval(t)
  }, [legacy, boom])

  return (
    <CellOverlay at={at} className={`impact ${kind} ${enemyFire ? 'enemy-fire' : ''}`}>
      {boom ? (
        <>
          {ui && <img className="impact-burst" src={assets.fx('burst')} alt="" />}
          {legacy ? (
            <div
              className="impact-sprite"
              style={{
                backgroundImage: `url(${assets.explosion})`,
                backgroundPosition: `${-(frame % 5) * 96}px ${-Math.floor(frame / 5) * 96}px`,
              }}
            />
          ) : (
            <div className="impact-boom" />
          )}
        </>
      ) : ui ? (
        <img className="impact-column" src={assets.fx('column')} alt="" />
      ) : (
        <div className="impact-splash" />
      )}
      <span className="impact-text">{IMPACT_TEXT[kind]}</span>
    </CellOverlay>
  )
}

export type Cutin =
  | { kind: 'intro'; step: 'search' | 'found' | 'sighted' }
  | { kind: 'attack'; cls: ShipClass; name: string }
  | { kind: 'enemy'; cls: ShipClass; name: string }
  | { kind: 'toast'; side: 'player' | 'cpu'; text: string }
  | { kind: 'turn'; turn: number }

export function CutinLayer({ cutin, onSkip }: { cutin: Cutin; onSkip?: () => void }) {
  const { legacy, ui } = useAssets()
  switch (cutin.kind) {
    case 'intro':
      return (
        <div className="cutin intro" onClick={onSkip} key={cutin.step}>
          <div className="cutin-strip" style={ui ? { backgroundImage: `url(${assets.strip})` } : undefined} />
          <div className="cutin-label">
            {cutin.step === 'search' && <FxLabel fx="search" text="索敵開始！" />}
            {cutin.step === 'found' && <FxLabel fx="found" text="敵艦隊発見！" />}
            {cutin.step === 'sighted' && <FxLabel fx="sighted" text="敵艦隊 見ゆ！" />}
          </div>
        </div>
      )
    case 'attack':
      return (
        <div className={`cutin attack ${legacy ? 'has-portrait' : ''}`} onClick={onSkip}>
          <div className="cutin-band" style={ui ? { backgroundImage: `url(${assets.band('green')})` } : undefined} />
          {legacy && (
            <div className="cutin-portrait">
              <Portrait cls={cutin.cls} />
            </div>
          )}
          <div className="cutin-label">
            <FxLabel fx="observe" text="砲撃開始！" tone="white" />
            <span className="cutin-caption">{cutin.name}、撃ちます！</span>
          </div>
        </div>
      )
    case 'enemy':
      return (
        <div className="cutin enemy" onClick={onSkip}>
          <div className="cutin-diag" style={ui ? { backgroundImage: `url(${assets.band('red_diag')})` } : undefined} />
          {/* Tilted to the same angle as the band so the label and plate sit inside it. */}
          <div className="cutin-rig">
            <div className="cutin-label">
              <FxLabel text="敵艦の砲撃！" tone="red" />
              <span className="cutin-caption">敵{cutin.name}が発砲！</span>
            </div>
            <div className="cutin-enemy-banner">
              <Banner cls={cutin.cls} state="b" enemy />
            </div>
          </div>
        </div>
      )
    case 'toast':
      // "notice", not "toast": the global .toast class is the error popup.
      return (
        <div className={`cutin notice ${cutin.side}`}>
          <div className="notice-band" style={ui ? { backgroundImage: `url(${assets.band(cutin.side === 'player' ? 'green' : 'red')})` } : undefined}>
            <span>{cutin.text}</span>
          </div>
        </div>
      )
    case 'turn':
      return (
        <div className="cutin turn" key={cutin.turn}>
          <div className="turn-flash">
            <small>YOUR TURN</small>
            TURN {cutin.turn}
          </div>
        </div>
      )
  }
}
