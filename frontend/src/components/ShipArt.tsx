// Procedural card art: a ship silhouette on a themed seascape, so every card
// has art without an asset pack. The three starter cards use the legacy
// character portraits when that pack is installed.
import { useId, type ReactNode } from 'react'
import { CLASS_INFO, type Look } from '../game'
import { assets, PORTRAIT_CARDS, useAssets } from '../theme'
import type { ShipClass } from '../types'

interface Hull {
  len: number
  body: ReactNode
  lights: [number, number][]
}

// Side views with the bow to the right, waterline at y=0.
const HULLS: Record<ShipClass, Hull> = {
  battleship: {
    len: 180,
    body: (
      <>
        <path d="M4,-1 L0,-14 L150,-14 L180,-21 L171,-1 Z" />
        <rect x="22" y="-22" width="20" height="8" rx="2" />
        <path d="M24,-19 L6,-20" strokeWidth="2.5" />
        <rect x="48" y="-31" width="18" height="17" />
        <path d="M71,-14 L74,-42 L87,-42 L90,-14 Z" />
        <path d="M95,-14 L98,-52 L102,-66 L106,-52 L109,-14 Z" />
        <rect x="91" y="-46" width="22" height="4" />
        <rect x="94" y="-57" width="16" height="3" />
        <rect x="110" y="-29" width="16" height="15" />
        <rect x="128" y="-23" width="18" height="9" rx="2" />
        <path d="M144,-20 L166,-22" strokeWidth="2.5" />
        <rect x="146" y="-19" width="14" height="6" rx="2" />
        <path d="M158,-17 L178,-19" strokeWidth="2" />
      </>
    ),
    lights: [
      [54, -24],
      [60, -24],
      [100, -40],
      [104, -40],
      [115, -22],
      [120, -22],
    ],
  },
  cruiser: {
    len: 156,
    body: (
      <>
        <path d="M6,-1 L0,-12 L130,-12 L156,-19 L148,-1 Z" />
        <rect x="18" y="-18" width="15" height="6" rx="2" />
        <path d="M20,-16 L4,-17" strokeWidth="2" />
        <rect x="40" y="-27" width="26" height="15" />
        <path d="M58,-27 L58,-50" strokeWidth="2" />
        <path d="M70,-12 L72,-37 L80,-37 L82,-12 Z" />
        <path d="M86,-12 L88,-33 L95,-33 L97,-12 Z" />
        <rect x="100" y="-24" width="12" height="12" />
        <rect x="112" y="-18" width="14" height="6" rx="2" />
        <path d="M124,-16 L142,-18" strokeWidth="2" />
      </>
    ),
    lights: [
      [46, -20],
      [52, -20],
      [104, -18],
    ],
  },
  destroyer: {
    len: 124,
    body: (
      <>
        <path d="M4,-1 L0,-10 L100,-10 L124,-16 L117,-1 Z" />
        <rect x="12" y="-15" width="11" height="5" rx="2" />
        <path d="M14,-13 L2,-14" strokeWidth="2" />
        <path d="M38,-10 L41,-30 L52,-30 L55,-10 Z" />
        <rect x="62" y="-23" width="17" height="13" />
        <path d="M71,-23 L71,-42" strokeWidth="2" />
        <path d="M64,-36 L78,-36" strokeWidth="1.5" />
        <rect x="86" y="-15" width="11" height="5" rx="2" />
        <path d="M95,-13 L110,-15" strokeWidth="2" />
      </>
    ),
    lights: [
      [67, -17],
      [73, -17],
    ],
  },
  submarine: {
    len: 150,
    body: (
      <>
        <path d="M0,2 C10,-9 40,-10 75,-10 C115,-10 142,-8 150,2 Z" />
        <path d="M56,-9 L61,-28 L82,-28 L88,-9 Z" />
        <path d="M71,-28 L71,-44" strokeWidth="2" />
        <path d="M76,-28 L76,-38" strokeWidth="1.5" />
        <rect x="96" y="-14" width="8" height="4" rx="1" />
        <path d="M102,-13 L112,-14" strokeWidth="1.5" />
      </>
    ),
    lights: [[68, -20]],
  },
  carrier: {
    len: 190,
    body: (
      <>
        <path d="M8,-1 L0,-14 L176,-14 L188,-18 L180,-1 Z" />
        <rect x="0" y="-22" width="190" height="8" />
        <rect x="126" y="-46" width="16" height="24" />
        <path d="M142,-40 L144,-52 L152,-52 L150,-30 Z" />
        <path d="M133,-46 L133,-62" strokeWidth="2" />
        <path d="M126,-56 L140,-56" strokeWidth="1.5" />
        <path d="M30,-25 l10,0 m-5,-3 l0,6 M60,-25 l10,0 m-5,-3 l0,6 M90,-25 l10,0 m-5,-3 l0,6" strokeWidth="2" />
      </>
    ),
    lights: [
      [131, -38],
      [137, -38],
      [131, -30],
    ],
  },
}

// A little sky/sea mood per class and a sinister one for the enemy.
function palette(look: Look) {
  if (look.enemy) return { sky1: look.boss ? '#3a0010' : '#240812', sky2: '#050206', sea1: '#2a0a12', sea2: '#070205', orb: look.boss ? '#ff2d55' : '#ff5a4e' }
  return { sky1: look.color, sky2: '#07101f', sea1: '#0e3a66', sea2: '#040b18', orb: look.color }
}

export function ShipArt({ look, className = '', showKanji = true }: { look: Look; className?: string; showKanji?: boolean }) {
  const id = useId().replace(/:/g, '')
  const { legacy } = useAssets()
  const hull = HULLS[look.cls]
  const pal = palette(look)
  const rays = look.rarity >= 3 || look.boss
  const portraitCls = legacy && look.cardId ? PORTRAIT_CARDS[look.cardId] : undefined
  const k = 176 / Math.max(hull.len, 150)
  const x0 = 100 - (hull.len * k) / 2

  return (
    <div className={`ship-art r${look.rarity} ${look.enemy ? 'enemy' : ''} ${look.boss ? 'boss' : ''} ${className}`}>
      <svg viewBox="0 0 200 280" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <linearGradient id={`sky${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={pal.sky1} stopOpacity="0.85" />
            <stop offset="0.75" stopColor={pal.sky2} />
          </linearGradient>
          <radialGradient id={`orb${id}`}>
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="0.25" stopColor={pal.orb} stopOpacity="0.8" />
            <stop offset="1" stopColor={pal.orb} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`sea${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={pal.sea1} />
            <stop offset="1" stopColor={pal.sea2} />
          </linearGradient>
          <filter id={`glow${id}`} x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <rect width="200" height="280" fill={`url(#sky${id})`} />
        {rays && (
          <g className="art-rays" style={{ transformOrigin: '140px 96px' }}>
            {Array.from({ length: 12 }, (_, i) => (
              <path key={i} d="M140,96 L260,80 L260,112 Z" fill={pal.orb} opacity="0.13" transform={`rotate(${i * 30} 140 96)`} />
            ))}
          </g>
        )}
        <circle cx="140" cy="96" r="64" fill={`url(#orb${id})`} className="art-orb" />
        {showKanji && (
          <text x="16" y="120" className="art-kanji" fill="#fff" opacity="0.1" fontSize="110">
            {look.enemy ? '敵' : CLASS_INFO[look.cls].kanji}
          </text>
        )}
        {portraitCls ? null : (
          <g transform={`translate(${x0} 214) scale(${k})`}>
            <g filter={`url(#glow${id})`} fill={pal.orb} stroke={pal.orb} opacity="0.7">
              {hull.body}
            </g>
            <g fill="#0a111d" stroke="#0a111d" strokeLinejoin="round">
              {hull.body}
            </g>
            {hull.lights.map(([lx, ly], i) => (
              <circle key={i} cx={lx} cy={ly} r="1.6" fill={look.enemy ? '#ff3b3b' : '#ffe9a6'} className="art-light" style={{ animationDelay: `${i * 0.3}s` }} />
            ))}
          </g>
        )}
        <rect y="212" width="200" height="68" fill={`url(#sea${id})`} opacity="0.92" />
        <path className="art-wave" d="M-20,214 Q0,208 20,214 T60,214 T100,214 T140,214 T180,214 T220,214 T260,214" stroke="#9fe0ff" strokeOpacity="0.45" strokeWidth="1.5" fill="none" />
        <path className="art-wave slow" d="M-20,232 Q0,226 20,232 T60,232 T100,232 T140,232 T180,232 T220,232 T260,232" stroke="#9fe0ff" strokeOpacity="0.2" strokeWidth="1.2" fill="none" />
      </svg>
      {portraitCls && <img className="art-portrait" src={assets.portrait(portraitCls)} alt="" draggable={false} />}
    </div>
  )
}
