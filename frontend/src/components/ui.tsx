import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { audio } from '../audio'
import { CLASS_INFO, KANJI, rarityName, type Look } from '../game'
import { anchors, useGame } from '../state'
import { backdropUrl, portraitOf, useAssets, type Backdrop as BackdropName } from '../theme'
import type { ShipClass } from '../types'
import { PortraitImg, ShipArt } from './ShipArt'

export function Backdrop({ scene, dim = 0.35 }: { scene: BackdropName; dim?: number }) {
  const packs = useAssets()
  const url = backdropUrl(scene, packs)
  return (
    <div
      className={`backdrop backdrop-${scene} ${url ? 'has-image' : ''}`}
      style={{ backgroundImage: url ? `url(${url})` : undefined, ['--dim' as string]: dim }}
    >
      {!url && <div className="sea-anim" />}
    </div>
  )
}

export function ShipBadge({ cls, enemy, sunk }: { cls: ShipClass; enemy?: boolean; sunk?: boolean }) {
  return <span className={`ship-badge ${cls} ${enemy ? 'enemy' : ''} ${sunk ? 'sunk' : ''}`}>{KANJI[cls]}</span>
}

// Map piece for one ship: the character's face for cards with a portrait,
// otherwise the class kanji, ringed in the card colour, with its fleet number.
export function ShipToken({ look, no, sunk, spotted }: { look: Look; no: number; sunk?: boolean; spotted?: boolean }) {
  const portrait = portraitOf(look, useAssets())
  return (
    <span
      className={`ship-token ${look.cls} ${look.enemy ? 'enemy' : ''} ${look.boss ? 'boss' : ''} ${sunk ? 'sunk' : ''} ${spotted ? 'spotted' : ''}`}
      style={{ ['--c' as string]: look.enemy ? undefined : look.color }}
    >
      <span className="token-disc">
        {portrait ? <PortraitImg portrait={portrait} frame="bust" className="token-face" /> : <span className="token-kanji">{look.enemy && look.boss ? '王' : KANJI[look.cls]}</span>}
      </span>
      <span className="token-no">{no}</span>
      {portrait && <span className="token-class">{KANJI[look.cls]}</span>}
    </span>
  )
}

export function Stars({ n, max = 5, className = '' }: { n: number; max?: number; className?: string }) {
  return (
    <span className={`stars ${className}`} aria-label={`★${n}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''}>
          ★
        </i>
      ))}
    </span>
  )
}

export function RarityBadge({ r }: { r: number }) {
  return <span className={`rarity-badge r${r}`}>{rarityName(r)}</span>
}

// A collectible card: art, rarity frame, name, level and limit-break stars.
export function CardView({
  look,
  level,
  stars,
  size = 'md',
  fresh,
  motion,
  className = '',
  onClick,
  children,
}: {
  look: Look
  level?: number
  stars?: number
  size?: 'xs' | 'sm' | 'md' | 'lg'
  fresh?: boolean
  // Plays the card's motion effect; see ShipArt.
  motion?: boolean
  className?: string
  onClick?: (e: MouseEvent<HTMLElement>) => void
  children?: ReactNode
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`card card-${size} r${look.rarity} ${className}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <ShipArt look={look} motion={motion} />
      <span className="card-shine" />
      <span className="card-top">
        <RarityBadge r={look.rarity} />
        <span className="card-class" style={{ background: CLASS_INFO[look.cls].color }}>
          {KANJI[look.cls]}
        </span>
      </span>
      <span className="card-name">{look.name}</span>
      {(level !== undefined || stars !== undefined) && (
        <span className="card-foot">
          {level !== undefined && <span className="card-lv">Lv.{level}</span>}
          {stars !== undefined && stars > 0 && <Stars n={stars} />}
        </span>
      )}
      {fresh && <span className="card-new">NEW</span>}
      {children}
    </Tag>
  )
}

export function Pips({ value, max, kind }: { value: number; max: number; kind: 'hp' | 'ammo' | 'skill' }) {
  return (
    <span className={`pips ${kind}`} aria-label={`${value}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < value ? 'on' : ''} />
      ))}
    </span>
  )
}

/** A number that rolls to its new value. */
export function Counter({ value, ms = 700, tick = false, className = '' }: { value: number; ms?: number; tick?: boolean; className?: string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    if (a === value) return
    let raf = 0
    let lastTick = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const e = 1 - Math.pow(1 - t, 3)
      const v = Math.round(a + (value - a) * e)
      setShown(v)
      if (tick && now - lastTick > 60 && t < 1) {
        audio.play('tick', { pitch: t * 10 })
        lastTick = now
      }
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    if (value > a) setBump((b) => b + 1)
    return () => {
      cancelAnimationFrame(raf)
      from.current = value
    }
  }, [value, ms, tick])
  return (
    <span className={`counter ${className}`} key={bump}>
      {shown.toLocaleString()}
    </span>
  )
}

/** The persistent header: admiral level, currencies and optional navigation. */
export function TopBar({ title, en, onBack, right }: { title?: string; en?: string; onBack?: () => void; right?: ReactNode }) {
  const { profile } = useGame()
  if (!profile) return null
  const pct = Math.min(100, (profile.exp / profile.nextExp) * 100)
  return (
    <header className="topbar">
      {onBack ? (
        <button
          className="back-btn"
          onClick={() => {
            audio.play('back')
            onBack()
          }}
        >
          <span className="chev">◀</span>
          戻る
        </button>
      ) : (
        <div className="admiral" ref={(el) => void (anchors.level = el)}>
          <div className="admiral-lv" style={{ ['--p' as string]: `${pct}%` }}>
            <small>Lv</small>
            <b>{profile.level}</b>
          </div>
          <div className="admiral-info">
            <span className="admiral-name">{profile.name}</span>
            <span className="exp-bar">
              <i style={{ width: `${pct}%` }} />
            </span>
          </div>
        </div>
      )}
      {title ? (
        <div className="topbar-title">
          {en && <span className="head-en">{en}</span>}
          <h1>{title}</h1>
        </div>
      ) : (
        <span />
      )}
      <div className="wallet">
        {right}
        <span className="wallet-pill coins" ref={(el) => void (anchors.coins = el)}>
          <b className="coin-ico" />
          <Counter value={profile.coins} />
        </span>
        <span className="wallet-pill gems" ref={(el) => void (anchors.gems = el)}>
          <b className="gem-ico" />
          <Counter value={profile.gems} />
        </span>
        <SoundToggle />
      </div>
    </header>
  )
}

export function Modal({ title, onClose, children, wide, className = '' }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''} ${className}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button
            className="icon-btn close"
            onClick={() => {
              audio.play('back')
              onClose()
            }}
            aria-label="閉じる"
          >
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function SoundToggle() {
  const [muted, setMuted] = useState(audio.muted)
  useEffect(() => audio.onMute(setMuted), [])
  return (
    <button className="icon-btn sound" aria-label={muted ? 'サウンドをオンにする' : 'サウンドをオフにする'} onClick={() => audio.setMuted(!muted)}>
      {muted ? '🔇' : '🔊'}
    </button>
  )
}

/** Red notification dot with an optional count. */
export function Badge({ n, text }: { n?: number | boolean; text?: string }) {
  if (!n && !text) return null
  return <span className={`badge ${text ? 'text' : ''}`}>{text ?? (typeof n === 'number' && n > 1 ? n : '!')}</span>
}

export function Toasts() {
  const { toasts } = useGame()
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-pop ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
