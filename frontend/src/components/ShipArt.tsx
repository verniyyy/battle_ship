// Card art: a themed seascape with, in front of it, the card's generated
// character portrait (see theme.portraitOf) or, failing that, a procedural
// ship silhouette, so every card has art without an asset pack.
//
// Rarity shows in the staging around the figure rather than in the portrait,
// which is generated without effects (they come out mangled): from R up an
// aura behind the figure, from SR light rays, rim light and rising motes,
// from SSR a compass-rose halo, and at UR a second halo and a holographic
// sheen.
import { useId, type CSSProperties, type ReactNode } from 'react'
import { CLASS_INFO, type Look } from '../game'
import { portraitOf, useAssets, type Portrait } from '../theme'
import { FxBack, FxFront, useMotionFx } from './MotionFx'
import type { ShipClass } from '../types'

// How a portrait sits in its box:
//  bust - zoomed on the face, which is placed by --face-h (face height as a
//         fraction of the box) and --face-top; the look of cards and cut-ins
//  full - the whole figure, feet on the bottom edge; for large showcases
export type Frame = 'bust' | 'full'

// The <img> of a portrait. Its box must be a size container (.ship-art and
// .token-disc are): bust framing is computed from the face box in cq units.
export function PortraitImg({ portrait, frame, className = '' }: { portrait: Portrait; frame: Frame; className?: string }) {
  const mode = frame === 'bust' && portrait.face ? 'bust' : 'full'
  let style: CSSProperties | undefined
  if (mode === 'bust' && portrait.face) {
    const [x0, y0, x1, y1] = portrait.face
    style = {
      ['--ar' as string]: portrait.w / portrait.h,
      ['--fh' as string]: y1 - y0,
      ['--fx' as string]: (x0 + x1) / 2,
      ['--fy' as string]: y0,
    }
  }
  return <img className={`portrait-img ${mode} ${className}`} src={portrait.src} alt="" draggable={false} decoding="async" style={style} />
}

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

// motion plays the card's motion effect (Card.fx) over the art; for the
// large showcases only, where it is worth the frames.
export function ShipArt({
  look,
  className = '',
  showKanji = true,
  frame = 'bust',
  motion = false,
}: {
  look: Look
  className?: string
  showKanji?: boolean
  frame?: Frame
  motion?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const portrait = portraitOf(look, useAssets())
  const hull = HULLS[look.cls]
  const pal = palette(look)
  const tier = look.enemy ? 0 : look.rarity
  const fx = useMotionFx(motion ? look.fx : undefined)
  const k = 176 / Math.max(hull.len, 150)
  const x0 = 100 - (hull.len * k) / 2

  return (
    <div className={`ship-art r${look.rarity} tier${tier} ${look.enemy ? 'enemy' : ''} ${look.boss ? 'boss' : ''} ${portrait ? 'has-portrait' : ''} ${fx.on ? 'has-fx' : ''} ${className}`}>
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
          <radialGradient id={`aura${id}`}>
            <stop offset="0" className="art-aura-core" />
            <stop offset="0.45" className="art-aura-mid" />
            <stop offset="1" className="art-aura-edge" />
          </radialGradient>
          <filter id={`glow${id}`} x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <rect width="200" height="280" fill={`url(#sky${id})`} />
        {look.boss && (
          <g className="art-rays" style={{ transformOrigin: '140px 96px' }}>
            {Array.from({ length: 12 }, (_, i) => (
              <path key={i} d="M140,96 L260,80 L260,112 Z" fill={pal.orb} opacity="0.13" transform={`rotate(${i * 30} 140 96)`} />
            ))}
          </g>
        )}
        <circle cx="140" cy="96" r="64" fill={`url(#orb${id})`} className="art-orb" />
        {tier >= 1 && <ellipse cx="100" cy="112" rx="96" ry="120" fill={`url(#aura${id})`} className="art-aura" />}
        {tier >= 2 && <Rays n={tier >= 3 ? 16 : 10} />}
        {tier >= 3 && <Compass r={74} className="art-ring" />}
        {tier >= 4 && <Compass r={92} className="art-ring outer" />}
        {showKanji && (
          <text x="16" y="120" className="art-kanji" fill="#fff" opacity="0.1" fontSize="110">
            {look.enemy ? '敵' : CLASS_INFO[look.cls].kanji}
          </text>
        )}
        {portrait ? null : (
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
      {fx.on && <FxBack fx={fx} />}
      {portrait && <PortraitImg portrait={portrait} frame={frame} className="art-portrait" />}
      {tier >= 2 && <Staging tier={tier} floor={frame === 'full' && !!portrait} />}
      {fx.on && look.fx && <FxFront fx={fx} preset={look.fx} portrait={portrait} frame={frame} />}
    </div>
  )
}

// Light rays fanning out from behind the figure.
function Rays({ n }: { n: number }) {
  const w = 180 / n
  return (
    <g className="art-halo-rays">
      {Array.from({ length: n }, (_, i) => (
        <path key={i} d={`M100,112 L300,${112 - w} L300,${112 + w} Z`} transform={`rotate(${(i * 360) / n} 100 112)`} />
      ))}
    </g>
  )
}

// A compass rose ring, the naval stand-in for a saint's halo.
function Compass({ r, className }: { r: number; className: string }) {
  const ticks = Array.from({ length: 32 }, (_, i) => {
    const a = (i * Math.PI) / 16
    const len = i % 4 === 0 ? 9 : i % 2 === 0 ? 5 : 3
    const [c, s] = [Math.cos(a), Math.sin(a)]
    return <path key={i} d={`M${100 + c * r},${112 + s * r} L${100 + c * (r - len)},${112 + s * (r - len)}`} />
  })
  const points = [0, 1, 2, 3].map((i) => {
    const a = (i * Math.PI) / 2 - Math.PI / 2
    const [c, s] = [Math.cos(a), Math.sin(a)]
    const [pc, ps] = [Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2)]
    const tip = r + 12
    return <path key={i} className="art-ring-point" d={`M${100 + c * tip},${112 + s * tip} L${100 + c * r + pc * 5},${112 + s * r + ps * 5} L${100 + c * r - pc * 5},${112 + s * r - ps * 5} Z`} />
  })
  return (
    <g className={className}>
      <circle cx="100" cy="112" r={r} />
      <circle cx="100" cy="112" r={r - 12} strokeDasharray="2 4" />
      {ticks}
      {points}
    </g>
  )
}

// Motes spread along both sides, mostly clear of the face; fixed so a card
// looks the same on every render.
const MOTES: [number, number, number, number][] = [
  // left %, top %, delay s, size (relative)
  [8, 70, 0, 1],
  [88, 58, 1.1, 0.8],
  [16, 38, 2.3, 0.7],
  [80, 82, 0.6, 1.1],
  [92, 30, 3.0, 0.9],
  [5, 50, 1.7, 0.6],
  [70, 92, 2.7, 0.7],
  [24, 88, 0.3, 0.9],
  [95, 70, 3.6, 0.6],
  [12, 18, 1.4, 0.8],
  [84, 12, 2.0, 0.7],
  [30, 62, 3.3, 0.5],
  [74, 45, 0.9, 0.5],
  [2, 84, 2.5, 1.0],
]

// The layer in front of the figure: motes, a lit floor under a full figure
// and, at UR, a holographic sheen.
function Staging({ tier, floor }: { tier: number; floor: boolean }) {
  const n = tier >= 4 ? 14 : tier >= 3 ? 10 : 6
  return (
    <div className="art-staging" aria-hidden>
      {floor && <i className="art-floor" />}
      {tier >= 4 && <i className="art-holo" />}
      {MOTES.slice(0, n).map(([x, y, d, s], i) => (
        <i key={i} className={`art-mote ${i % 3 === 0 ? 'star' : ''} ${i % 2 ? 'alt' : ''}`} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s`, ['--s' as string]: s }} />
      ))}
    </div>
  )
}
