import { useEffect, useState, type ReactNode } from 'react'
import { KANJI } from '../game'
import { assets, backdropUrl, sound, useAssets, type Backdrop as BackdropName, type Fx } from '../theme'
import type { ShipClass } from '../types'

export function Backdrop({ scene, dim = 0.35 }: { scene: BackdropName; dim?: number }) {
  const packs = useAssets()
  const url = backdropUrl(scene, packs)
  return (
    <div
      className={`backdrop backdrop-${scene} ${url ? 'has-image' : ''}`}
      style={{ backgroundImage: url ? `url(${url})` : undefined, ['--dim' as string]: dim }}
    />
  )
}

export function ShipBadge({ cls, enemy, sunk }: { cls: ShipClass; enemy?: boolean; sunk?: boolean }) {
  return <span className={`ship-badge ${cls} ${enemy ? 'enemy' : ''} ${sunk ? 'sunk' : ''}`}>{KANJI[cls]}</span>
}

// Map piece for one ship. The class kanji alone can't tell two ships of the same
// class apart, so the token shows the character's face (when the legacy pack is
// present) plus the ship's fleet number, which matches the number on its plate.
export function ShipToken({ cls, no, enemy, sunk }: { cls: ShipClass; no: number; enemy?: boolean; sunk?: boolean }) {
  const { legacy } = useAssets()
  const face = legacy && !enemy
  return (
    <span className={`ship-token ${cls} ${enemy ? 'enemy' : ''} ${sunk ? 'sunk' : ''}`}>
      <span className="token-disc">
        {face ? <img className="token-face" src={assets.portrait(cls)} alt="" draggable={false} /> : <span className="token-kanji">{KANJI[cls]}</span>}
      </span>
      <span className="token-no">{no}</span>
      {face && <span className="token-class">{KANJI[cls]}</span>}
    </span>
  )
}

// Full-body character art, or a large emblem when the legacy pack is absent.
export function Portrait({ cls, className = '' }: { cls: ShipClass; className?: string }) {
  const { legacy } = useAssets()
  if (legacy) return <img className={`portrait ${cls} ${className}`} src={assets.portrait(cls)} alt="" draggable={false} />
  return (
    <div className={`portrait fallback ${cls} ${className}`}>
      <span>{KANJI[cls]}</span>
    </div>
  )
}

// Banner strip for a ship (the 240x60 plates), with a drawn fallback.
export function Banner({ cls, state, enemy }: { cls: ShipClass; state: 'b' | 'c' | 'd'; enemy?: boolean }) {
  const { legacy } = useAssets()
  if (legacy && enemy) {
    // There is only one enemy plate image (labelled 駆逐), so stamp the real class over its emblem.
    return (
      <span className={`banner enemy-plate ${state === 'd' ? 'sunk' : ''}`}>
        <img src={assets.enemyBanner(state !== 'b')} alt="" draggable={false} />
        <ShipBadge cls={cls} enemy sunk={state === 'd'} />
      </span>
    )
  }
  if (legacy) {
    return <img className={`banner ${state === 'd' ? 'sunk' : ''}`} src={assets.banner(cls, state)} alt="" draggable={false} />
  }
  return (
    <span className={`banner fallback ${cls} ${enemy ? 'enemy' : ''} ${state === 'd' ? 'sunk' : ''}`}>
      <ShipBadge cls={cls} enemy={enemy} sunk={state === 'd'} />
    </span>
  )
}

export function Pips({ value, max, kind }: { value: number; max: number; kind: 'hp' | 'ammo' }) {
  return (
    <span className={`pips ${kind}`} aria-label={`${kind === 'hp' ? '耐久' : '残弾'} ${value}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < value ? 'on' : ''} />
      ))}
    </span>
  )
}

// Cut-in label: the imported sprite when available, styled text otherwise.
export function FxLabel({ fx, text, tone = 'green' }: { fx?: Fx; text: string; tone?: 'green' | 'red' | 'white' }) {
  const { ui } = useAssets()
  if (ui && fx) return <img className="fx-label" src={assets.fx(fx)} alt={text} draggable={false} />
  return <span className={`fx-label text ${tone}`}>{text}</span>
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn close" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="back-btn"
      onClick={() => {
        sound.se('click', 0.3)
        onClick()
      }}
    >
      <span className="chev">◀</span>
      {label}
    </button>
  )
}

export function SoundToggle() {
  const { legacy } = useAssets()
  const [muted, setMuted] = useState(sound.muted)
  if (!legacy) return null
  return (
    <button
      className="icon-btn sound"
      aria-label={muted ? 'サウンドをオンにする' : 'サウンドをオフにする'}
      onClick={() => {
        sound.setMuted(!muted)
        setMuted(!muted)
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  )
}
