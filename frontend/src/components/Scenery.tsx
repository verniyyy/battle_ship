// Painted-in-code backdrops for the menu screens, drawn to the game's navy
// and gold palette instead of borrowed photos:
//
//   Harbor - the home port at the player's local time of day: sky, drifting
//            clouds, a lighthouse sweeping the dusk, waves and a ship passing
//   Dock   - the construction dock: a blueprint floor, rune rings turning
//            around the build, light pillars and welding sparks
//   Chart  - the operations room's sea chart with a sonar sweep lighting
//            contacts as it passes, behind the fleet and sortie screens
//
// A static SVG plate carries everything that holds still; each moving part is
// its own HTML layer animating only transform and opacity, so the compositor
// runs the motion without repainting the scene every frame.
import { useMemo, type CSSProperties } from 'react'

const W = 1280
const H = 720
const HORIZON = 468

// Deterministic scatter so layouts don't reshuffle between renders.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const vars = (v: Record<string, string | number>) => v as CSSProperties

// A wave line of the given period, long enough to scroll one period and loop.
function wave(width: number, period: number, amp: number, y: number) {
  let d = `M0 ${y} Q${period / 4} ${y - amp} ${period / 2} ${y}`
  for (let x = period; x <= width + period; x += period / 2) d += ` T${x} ${y}`
  return d
}

/* ------------------------------------------------------------------ */
/* Harbor                                                               */
/* ------------------------------------------------------------------ */

type TimeOfDay = 'day' | 'dusk' | 'night'

function timeOfDay(h = new Date().getHours()): TimeOfDay {
  if (h >= 7 && h < 16) return 'day'
  if ((h >= 16 && h < 19) || (h >= 5 && h < 7)) return 'dusk'
  return 'night'
}

interface Palette {
  sky: [string, string, string, string, string]
  sea: [string, string, string, string]
  ridge: [string, string]
  cloud: [string, string]
  cloudOpacity: number
  land: string
  glint: string
  light: string
  stars: number
}

const PALETTES: Record<TimeOfDay, Palette> = {
  day: {
    sky: ['#1d5fb8', '#3f86d4', '#7db7e8', '#bfdcf3', '#e8f3fb'],
    sea: ['#7eaedb', '#3a74b0', '#163f73', '#061630'],
    ridge: ['#9ab4d6', '#6f8fbd'],
    cloud: ['#ffffff', '#c3d5ec'],
    cloudOpacity: 0.85,
    land: '#1f3a63',
    glint: '#ffffff',
    light: '#fff3c4',
    stars: 0,
  },
  dusk: {
    sky: ['#0a1230', '#1e2a5e', '#5a3a7a', '#d3705a', '#ffbd6e'],
    sea: ['#b8705f', '#4f3668', '#1a2150', '#060b1e'],
    ridge: ['#5a3f74', '#3a2b5e'],
    cloud: ['#3b3163', '#ff9a6c'],
    cloudOpacity: 0.9,
    land: '#140e2a',
    glint: '#ffd08a',
    light: '#ffcf7a',
    stars: 0.55,
  },
  night: {
    sky: ['#02050e', '#061228', '#0b1e40', '#142c52', '#1f3c63'],
    sea: ['#1b3456', '#0d203e', '#061228', '#02050e'],
    ridge: ['#0f1f3b', '#0a1630'],
    cloud: ['#0b172e', '#2c4872'],
    cloudOpacity: 0.7,
    land: '#030916',
    glint: '#dce8ff',
    light: '#ffd98a',
    stars: 1,
  },
}

const LIGHTHOUSE = { x: 716, y: 402 }

// Side-on warship silhouette, bow to the left, waterline at y=0.
const SHIP =
  'M0 0 L10 -9 L30 -9 L30 -13 L38 -13 L38 -9 L52 -9 L52 -17 L58 -17 L58 -27 L61 -27 L61 -40 L62 -40 L62 -27 L68 -27 ' +
  'L68 -17 L74 -17 L74 -24 L82 -24 L82 -17 L88 -17 L88 -9 L98 -9 L98 -13 L106 -13 L106 -9 L124 -9 L130 -5 L128 0 Z ' +
  'M28 -12 L16 -13 L16 -12 L28 -11 Z M108 -12 L118 -13 L118 -12 L108 -11 Z'

function crane(x: number, h: number, flip = false) {
  const s = flip ? -1 : 1
  const y = HORIZON
  return (
    `M${x} ${y} L${x + 4} ${y - h} L${x + 10} ${y - h} L${x + 14} ${y} Z ` +
    `M${x + 22} ${y} L${x + 26} ${y - h} L${x + 32} ${y - h} L${x + 36} ${y} Z ` +
    `M${x - 2} ${y - h} L${x + 38} ${y - h} L${x + 38} ${y - h - 10} L${x - 2} ${y - h - 10} Z ` +
    `M${x + 18} ${y - h - 10} L${x + 18 + s * 70} ${y - h - 4} L${x + 18 + s * 70} ${y - h - 1} L${x + 18} ${y - h - 2} Z ` +
    `M${x + 18} ${y - h - 10} L${x + 18} ${y - h - 26} L${x + 20} ${y - h - 26} L${x + 20} ${y - h - 10} Z`
  )
}

// A puff reaches this far above and below its centre (see the ellipses below).
const PUFF_UP = 42
const PUFF_DOWN = 20

function Clouds({ seed, y0, y1, count, p }: { seed: number; y0: number; y1: number; count: number; p: Palette }) {
  const r = rng(seed)
  const puffs = Array.from({ length: count }, () => {
    const cx = r() * W
    const cy = y0 + r() * (y1 - y0)
    const w = 90 + r() * 220
    return { cx, cy, w, h: 6 + r() * 14 }
  })
  // Drawn twice, one stage-width apart, so the layer can scroll a full width and loop.
  // Only the band the puffs fill: the layer moves, so its whole area is a texture.
  const top = y0 - PUFF_UP
  const h = y1 - y0 + PUFF_UP + PUFF_DOWN
  return (
    <svg width={W * 2} height={h} viewBox={`0 ${top} ${W * 2} ${h}`} style={{ marginTop: top }} aria-hidden>
      <defs>
        <linearGradient id={`cloud-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.cloud[0]} />
          <stop offset="1" stopColor={p.cloud[1]} />
        </linearGradient>
      </defs>
      <g fill={`url(#cloud-${seed})`} opacity={p.cloudOpacity}>
        {[0, W].map((dx) =>
          puffs.map((c, i) => (
            <g key={`${dx}-${i}`} transform={`translate(${c.cx + dx} ${c.cy})`}>
              <ellipse rx={c.w / 2} ry={c.h} />
              <ellipse cx={-c.w * 0.18} cy={-c.h * 0.7} rx={c.w * 0.22} ry={c.h * 0.9} />
              <ellipse cx={c.w * 0.12} cy={-c.h * 0.9} rx={c.w * 0.26} ry={c.h * 1.1} />
            </g>
          )),
        )}
      </g>
    </svg>
  )
}

function HarborScene() {
  const time = useMemo(() => timeOfDay(), [])
  const p = PALETTES[time]
  const r = useMemo(() => rng(7), [])
  const stars = useMemo(() => Array.from({ length: 46 }, () => ({ x: r() * W, y: r() * 260, s: r() < 0.15 ? 3 : 2, d: r() * 6, t: 2.5 + r() * 4 })), [r])
  const glints = useMemo(() => {
    const out: { y: number; w: number; d: number; x: number }[] = []
    for (let i = 0; i < 16; i++) {
      const k = i / 15
      out.push({ y: HORIZON + 4 + k * k * 190, w: 40 + k * 190, d: (i * 0.37) % 2.4, x: (r() - 0.5) * 16 })
    }
    return out
  }, [r])
  // Where the light sits and throws its reflection.
  const sun = time === 'dusk' ? { x: 586, y: HORIZON - 14, r: 38 } : time === 'day' ? { x: 640, y: 70, r: 30 } : { x: 660, y: 66, r: 22 }

  return (
    <div className={`scenery sc-harbor t-${time}`} style={vars({ '--glint': p.glint, '--light': p.light })}>
      <svg className="sc-plate" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <linearGradient id="h-sky" x1="0" y1="0" x2="0" y2={HORIZON} gradientUnits="userSpaceOnUse">
            {p.sky.map((c, i) => (
              <stop key={i} offset={[0, 0.34, 0.62, 0.85, 1][i]} stopColor={c} />
            ))}
          </linearGradient>
          <linearGradient id="h-sea" x1="0" y1={HORIZON} x2="0" y2={H} gradientUnits="userSpaceOnUse">
            {p.sea.map((c, i) => (
              <stop key={i} offset={[0, 0.12, 0.5, 1][i]} stopColor={c} />
            ))}
          </linearGradient>
          <radialGradient id="h-halo">
            <stop offset="0" stopColor={p.light} stopOpacity={time === 'night' ? 0.35 : 0.6} />
            <stop offset="0.4" stopColor={p.light} stopOpacity={time === 'night' ? 0.08 : 0.18} />
            <stop offset="1" stopColor={p.light} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="h-disc">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.7" stopColor={time === 'night' ? '#e9efff' : '#fff4d0'} />
            <stop offset="1" stopColor={time === 'dusk' ? '#ffb55c' : time === 'night' ? '#b9c9ea' : '#fff'} />
          </radialGradient>
          <mask id="h-crescent">
            <circle cx={sun.x} cy={sun.y} r={sun.r} fill="#fff" />
            <circle cx={sun.x + sun.r * 0.45} cy={sun.y - sun.r * 0.3} r={sun.r * 0.85} fill="#000" />
          </mask>
          <linearGradient id="h-haze" x1="0" y1={HORIZON - 60} x2="0" y2={HORIZON} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={p.sky[4]} stopOpacity="0" />
            <stop offset="1" stopColor={p.sky[4]} stopOpacity="0.55" />
          </linearGradient>
        </defs>

        <rect width={W} height={HORIZON} fill="url(#h-sky)" />
        <circle cx={sun.x} cy={sun.y} r={sun.r * 9} fill="url(#h-halo)" />
        <circle cx={sun.x} cy={sun.y} r={sun.r} fill="url(#h-disc)" mask={time === 'night' ? 'url(#h-crescent)' : undefined} />

        {/* far ridges */}
        <path
          d={`M0 ${HORIZON} L0 ${HORIZON - 22} Q60 ${HORIZON - 46} 130 ${HORIZON - 30} T260 ${HORIZON - 38} T400 ${HORIZON - 18} L470 ${HORIZON - 10} L520 ${HORIZON} Z
              M880 ${HORIZON} L940 ${HORIZON - 16} Q1010 ${HORIZON - 40} 1080 ${HORIZON - 26} T1200 ${HORIZON - 44} T1280 ${HORIZON - 30} L1280 ${HORIZON} Z`}
          fill={p.ridge[0]}
        />
        <path
          d={`M0 ${HORIZON} L0 ${HORIZON - 12} Q90 ${HORIZON - 24} 180 ${HORIZON - 12} T360 ${HORIZON - 8} L420 ${HORIZON} Z
              M1000 ${HORIZON} Q1080 ${HORIZON - 20} 1160 ${HORIZON - 12} T1280 ${HORIZON - 16} L1280 ${HORIZON} Z`}
          fill={p.ridge[1]}
        />
        <rect y={HORIZON - 60} width={W} height={60} fill="url(#h-haze)" />

        {/* port: warehouses and cranes to the left, the naval yard to the right */}
        <g fill={p.land}>
          <path
            d={`M0 ${HORIZON} L0 ${HORIZON - 26} L60 ${HORIZON - 26} L60 ${HORIZON - 34} L120 ${HORIZON - 34} L120 ${HORIZON - 22}
                L200 ${HORIZON - 22} L210 ${HORIZON - 30} L290 ${HORIZON - 30} L300 ${HORIZON - 20} L380 ${HORIZON - 20} L380 ${HORIZON - 12} L470 ${HORIZON - 8} L480 ${HORIZON} Z`}
          />
          <path d={crane(150, 58)} />
          <path d={crane(330, 44, true)} />
          <path
            d={`M860 ${HORIZON} L860 ${HORIZON - 14} L930 ${HORIZON - 14} L930 ${HORIZON - 30} L1040 ${HORIZON - 30} L1040 ${HORIZON - 20}
                L1120 ${HORIZON - 20} L1120 ${HORIZON - 36} L1200 ${HORIZON - 36} L1200 ${HORIZON - 24} L1280 ${HORIZON - 24} L1280 ${HORIZON} Z`}
          />
          <path d={crane(960, 64)} />
          <path d={crane(1150, 76, true)} />
          <path d={SHIP} transform={`translate(${1010} ${HORIZON + 1}) scale(1.6)`} />
          <path d={SHIP} transform={`translate(${880} ${HORIZON + 1}) scale(-1.1 1.1)`} />
          {/* breakwater and lighthouse */}
          <path d={`M600 ${HORIZON + 2} L610 ${HORIZON - 4} L760 ${HORIZON - 4} L770 ${HORIZON + 2} Z`} />
          <path
            d={`M${LIGHTHOUSE.x - 9} ${HORIZON - 4} L${LIGHTHOUSE.x - 5} ${LIGHTHOUSE.y + 8} L${LIGHTHOUSE.x - 8} ${LIGHTHOUSE.y + 8}
                L${LIGHTHOUSE.x - 8} ${LIGHTHOUSE.y + 4} L${LIGHTHOUSE.x + 8} ${LIGHTHOUSE.y + 4} L${LIGHTHOUSE.x + 8} ${LIGHTHOUSE.y + 8}
                L${LIGHTHOUSE.x + 5} ${LIGHTHOUSE.y + 8} L${LIGHTHOUSE.x + 9} ${HORIZON - 4} Z
                M${LIGHTHOUSE.x - 5} ${LIGHTHOUSE.y - 6} L${LIGHTHOUSE.x - 5} ${LIGHTHOUSE.y + 4} L${LIGHTHOUSE.x - 3} ${LIGHTHOUSE.y + 4} L${LIGHTHOUSE.x - 3} ${LIGHTHOUSE.y - 6} Z
                M${LIGHTHOUSE.x + 3} ${LIGHTHOUSE.y - 6} L${LIGHTHOUSE.x + 3} ${LIGHTHOUSE.y + 4} L${LIGHTHOUSE.x + 5} ${LIGHTHOUSE.y + 4} L${LIGHTHOUSE.x + 5} ${LIGHTHOUSE.y - 6} Z
                M${LIGHTHOUSE.x - 7} ${LIGHTHOUSE.y - 6} L${LIGHTHOUSE.x} ${LIGHTHOUSE.y - 14} L${LIGHTHOUSE.x + 7} ${LIGHTHOUSE.y - 6} Z`}
          />
        </g>
        {time !== 'day' && (
          <g fill={p.light}>
            {[36, 92, 104, 226, 250, 272, 418, 902, 990, 1066, 1140, 1176, 1240].map((x, i) => (
              <rect key={x} x={x} y={HORIZON - 16 - (i % 3) * 5} width="3" height="2" opacity={0.5 + (i % 3) * 0.2} />
            ))}
            <circle cx={LIGHTHOUSE.x} cy={LIGHTHOUSE.y - 1} r="4" />
          </g>
        )}
        {time !== 'day' && <circle cx={LIGHTHOUSE.x} cy={LIGHTHOUSE.y - 1} r="26" fill="url(#h-halo)" />}

        <rect y={HORIZON} width={W} height={H - HORIZON} fill="url(#h-sea)" />
        {/* the shore's reflection, broken up by the swell */}
        <rect y={HORIZON} width={W} height="10" fill={p.land} opacity="0.35" />
      </svg>

      {time !== 'day' && (
        <div className="sc-stars" style={vars({ opacity: p.stars })}>
          {stars.map((s, i) => (
            <i key={i} style={vars({ left: s.x, top: s.y, width: s.s, height: s.s, animationDelay: `-${s.d}s`, animationDuration: `${s.t}s` })} />
          ))}
        </div>
      )}
      <div className="sc-cloud-layer sc-far">
        <Clouds seed={11} y0={HORIZON - 150} y1={HORIZON - 50} count={9} p={p} />
      </div>
      <div className="sc-cloud-layer sc-near">
        <Clouds seed={23} y0={40} y1={220} count={7} p={p} />
      </div>
      <div className="sc-sun-pulse" style={vars({ left: sun.x, top: sun.y })} />

      {time !== 'day' && (
        <div className="sc-beam" style={vars({ left: LIGHTHOUSE.x, top: LIGHTHOUSE.y - 1 })}>
          <i />
        </div>
      )}

      <div className="sc-passing-ship" style={vars({ top: HORIZON + 1 })}>
        <svg width="80" height="30" viewBox="0 -30 130 30" aria-hidden>
          <path d={SHIP} fill={p.land} />
        </svg>
      </div>

      <div className="sc-glints" style={vars({ left: sun.x })}>
        {glints.map((g, i) => (
          <i key={i} style={vars({ top: g.y, width: g.w, marginLeft: g.x - g.w / 2, animationDelay: `-${g.d}s` })} />
        ))}
      </div>

      {[
        { y: HORIZON + 14, p: 90, a: 2, w: 1, t: 26, o: 0.28 },
        { y: HORIZON + 48, p: 150, a: 4, w: 1.5, t: 20, o: 0.22 },
        { y: HORIZON + 110, p: 240, a: 7, w: 2, t: 15, o: 0.18 },
        { y: HORIZON + 196, p: 360, a: 11, w: 3, t: 11, o: 0.14 },
      ].map((l, i) => (
        // Each row is a strip just tall enough for its line: the layer moves, so its whole area is a texture.
        <div
          key={i}
          className={`sc-wave-row ${i % 2 ? 'sc-rev' : ''}`}
          style={vars({ '--period': `${l.p}px`, top: l.y - l.a - l.w, animationDuration: `${l.t}s` })}
        >
          <svg width={W + l.p * 2} height={2 * (l.a + l.w)} aria-hidden>
            <path
              d={wave(W + l.p * 2, l.p, l.a, l.a + l.w)}
              stroke="var(--glint)"
              strokeWidth={l.w}
              opacity={l.o}
              fill="none"
              strokeDasharray={`${l.p * 0.3} ${l.p * 0.2}`}
            />
          </svg>
        </div>
      ))}

      <div className="sc-gulls">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`sc-gull sc-g${i}`}>
            <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
              <path d="M1 6 Q6 0 11 6 Q16 0 21 6" fill="none" stroke={p.land} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
        ))}
      </div>
      <div className="scenery-shade" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Construction dock                                                    */
/* ------------------------------------------------------------------ */

// Blueprint of a battleship in profile, 1000 units long, waterline at y=0.
const BLUEPRINT = [
  // hull and deck
  'M0 -40 L40 -52 L960 -52 L1000 -44 L985 0 L60 0 Q20 -10 0 -40 Z',
  'M40 -52 L40 -62 L960 -62 L960 -52',
  // turrets
  'M150 -62 L150 -82 L230 -82 L245 -72 L245 -62',
  'M245 -74 L330 -76 M245 -70 L330 -70',
  'M270 -62 L270 -90 L350 -90 L362 -80 L362 -62',
  'M362 -84 L440 -86 M362 -78 L440 -78',
  'M730 -62 L730 -82 L810 -82 L822 -72 L822 -62',
  'M730 -74 L650 -76 M730 -70 L650 -70',
  // superstructure, bridge tower, funnel and masts
  'M400 -62 L400 -110 L620 -110 L620 -62',
  'M440 -110 L452 -190 L500 -190 L512 -110',
  'M452 -190 L446 -210 L506 -210 L500 -190',
  'M476 -210 L476 -290 M456 -262 L496 -262',
  'M540 -110 L550 -200 L600 -200 L606 -110',
  'M548 -184 L604 -184',
  'M660 -62 L660 -96 L700 -96 L700 -62',
  'M680 -96 L680 -210 M664 -180 L696 -180',
]

function DockScene() {
  const sparks = useMemo(() => {
    const r = rng(42)
    return Array.from({ length: 28 }, () => ({ x: 140 + r() * 1000, d: r() * 6, t: 3.5 + r() * 3.5, s: 2 + r() * 2.5, dx: (r() - 0.5) * 120 }))
  }, [])
  const ticks = Array.from({ length: 120 }, (_, i) => i)
  return (
    <div className="scenery sc-dock">
      <div className="sc-dock-floor">
        <i />
      </div>

      <svg className="sc-plate sc-blueprint" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <g transform="translate(140 600) scale(1)" fill="none" stroke="#6fe3ff" strokeWidth="1.4" strokeLinejoin="round">
          {BLUEPRINT.map((d, i) => (
            <path key={i} d={d} />
          ))}
          {Array.from({ length: 34 }, (_, i) => (
            <circle key={i} cx={90 + i * 26} cy={-28} r="3" strokeWidth="1" />
          ))}
          {/* dimension lines */}
          <path d="M0 30 L1000 30 M0 22 L0 38 M1000 22 L1000 38 M476 -300 L476 -320" strokeWidth="1" opacity="0.7" />
          <text x="500" y="52" fill="#6fe3ff" stroke="none" fontSize="16" textAnchor="middle" letterSpacing="6">
            LOA 263.0 m ・ 大型戦艦 設計図
          </text>
        </g>
      </svg>
      <div className="sc-blueprint-scan" />

      <div className="sc-rings">
        <div className="sc-dock-glow" />
        {[
          { size: 820, cls: 'sc-ring sc-outer' },
          { size: 640, cls: 'sc-ring sc-mid' },
          { size: 460, cls: 'sc-ring sc-inner' },
        ].map((ring, n) => (
          <div key={n} className={ring.cls} style={vars({ width: ring.size, height: ring.size, marginLeft: -ring.size / 2, marginTop: -ring.size / 2 })}>
            <svg viewBox="-100 -100 200 200" aria-hidden>
              {n === 0 && (
                <>
                  <circle r="98" fill="none" stroke="currentColor" strokeWidth="0.35" />
                  <circle r="92" fill="none" stroke="currentColor" strokeWidth="0.2" />
                  {ticks.map((i) => (
                    <line
                      key={i}
                      y1={-98}
                      y2={i % 10 === 0 ? -90 : -94}
                      stroke="currentColor"
                      strokeWidth={i % 10 === 0 ? 0.5 : 0.25}
                      transform={`rotate(${i * 3})`}
                    />
                  ))}
                </>
              )}
              {n === 1 && (
                <>
                  <defs>
                    <path id="ring-text" d="M0 -84 A84 84 0 1 1 -0.01 -84" />
                  </defs>
                  <circle r="90" fill="none" stroke="currentColor" strokeWidth="0.3" strokeDasharray="1.5 3" />
                  <circle r="78" fill="none" stroke="currentColor" strokeWidth="0.3" />
                  <text fontSize="6" fill="currentColor" letterSpacing="2.2">
                    <textPath href="#ring-text">蒼海工廠 ・ FLEET CONSTRUCTION ・ 大型艦建造 ・ NAVAL ARSENAL ・ 艦霊召喚 ・ SHIPWRIGHT ・</textPath>
                  </text>
                </>
              )}
              {n === 2 && (
                <>
                  <circle r="96" fill="none" stroke="currentColor" strokeWidth="0.5" />
                  <polygon points={hexagram(92)} fill="none" stroke="currentColor" strokeWidth="0.45" />
                  <circle r="46" fill="none" stroke="currentColor" strokeWidth="0.35" />
                  {[0, 60, 120, 180, 240, 300].map((a) => (
                    <circle key={a} r="5" cy={-92} fill="none" stroke="currentColor" strokeWidth="0.45" transform={`rotate(${a})`} />
                  ))}
                </>
              )}
            </svg>
          </div>
        ))}
      </div>

      <div className="sc-pillars">
        {[180, 400, 880, 1100].map((x, i) => (
          <i key={x} style={vars({ left: x, animationDelay: `-${i * 1.3}s` })} />
        ))}
      </div>
      <div className="sc-sparks">
        {sparks.map((s, i) => (
          <i key={i} style={vars({ left: s.x, width: s.s, height: s.s, '--dx': `${s.dx}px`, animationDelay: `-${s.d}s`, animationDuration: `${s.t}s` })} />
        ))}
      </div>
      <div className="scenery-shade" />
    </div>
  )
}

function hexagram(r: number) {
  const pts: string[] = []
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6 - Math.PI / 2
    const rr = i % 2 ? r * 0.58 : r
    pts.push(`${(Math.cos(a) * rr).toFixed(2)},${(Math.sin(a) * rr).toFixed(2)}`)
  }
  return pts.join(' ')
}

/* ------------------------------------------------------------------ */
/* Operations chart                                                     */
/* ------------------------------------------------------------------ */

const SONAR = { x: 1010, y: 560, period: 9 }

const CONTOURS = [
  'M120 140 C180 90 300 100 330 160 S290 270 210 260 S70 200 120 140 Z',
  'M95 130 C170 60 330 70 365 160 S320 300 200 292 S30 210 95 130 Z',
  'M70 120 C160 30 370 40 400 160 S350 330 190 324 S-10 220 70 120 Z',
  'M560 520 C620 470 740 490 760 560 S700 660 620 650 S510 580 560 520 Z',
  'M530 505 C610 440 780 460 800 560 S730 700 610 690 S470 590 530 505 Z',
  'M900 110 C960 70 1080 90 1100 150 S1030 240 960 230 S850 160 900 110 Z',
  'M870 95 C950 40 1120 60 1140 150 S1060 280 950 268 S810 170 870 95 Z',
]

function ChartScene() {
  const contacts = useMemo(() => {
    const r = rng(5)
    return Array.from({ length: 9 }, () => {
      const dist = 120 + r() * 520
      const ang = Math.PI * (0.9 + r() * 0.75)
      const x = SONAR.x + Math.cos(ang) * dist
      const y = SONAR.y + Math.sin(ang) * dist
      // Blink as the sweep, turning clockwise from 12 o'clock, crosses the pip.
      const bearing = ((Math.atan2(x - SONAR.x, SONAR.y - y) * 180) / Math.PI + 360) % 360
      return { x, y, delay: (bearing / 360) * SONAR.period, enemy: r() < 0.35 }
    })
  }, [])
  return (
    <div className="scenery sc-chart">
      <div className="sc-chart-grid" />
      <svg className="sc-plate" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <g fill="none" stroke="#5fb8ff" strokeWidth="1">
          {CONTOURS.map((d, i) => (
            <path key={i} d={d} opacity={0.14 + (i % 3 === 0 ? 0.1 : 0)} strokeDasharray={i % 3 === 2 ? '6 5' : undefined} />
          ))}
        </g>
        <g fill="#1a3a5e" opacity="0.55">
          <path d={CONTOURS[0]} />
          <path d={CONTOURS[3]} />
          <path d={CONTOURS[5]} />
        </g>
        {/* compass rose */}
        <g transform="translate(250 540)" stroke="#8fd0ff" fill="none" opacity="0.28">
          <circle r="120" />
          <circle r="112" strokeDasharray="2 4" />
          <circle r="60" />
          {Array.from({ length: 16 }, (_, i) => (
            <path
              key={i}
              d={i % 2 ? 'M0 -60 L6 -6 L0 0 L-6 -6 Z' : 'M0 -118 L10 -10 L0 0 L-10 -10 Z'}
              transform={`rotate(${i * 22.5})`}
              fill={i % 4 === 0 ? '#8fd0ff' : 'none'}
              fillOpacity="0.25"
            />
          ))}
          <text y="-128" fill="#8fd0ff" stroke="none" fontSize="18" textAnchor="middle" fontFamily="serif">
            N
          </text>
        </g>
        {/* sonar range rings */}
        <g transform={`translate(${SONAR.x} ${SONAR.y})`} fill="none" stroke="#46e0ff" opacity="0.18">
          {[140, 280, 420, 560, 700].map((r) => (
            <circle key={r} r={r} strokeDasharray={r % 280 ? '3 6' : undefined} />
          ))}
          <path d="M-720 0 L720 0 M0 -720 L0 720" strokeDasharray="2 8" />
        </g>
        <g fill="#8fd0ff" opacity="0.35" fontSize="11" fontFamily="monospace" letterSpacing="1">
          {['34°N', '33°N', '32°N', '31°N'].map((t, i) => (
            <text key={t} x="8" y={96 + i * 160}>
              {t}
            </text>
          ))}
          {['132°E', '134°E', '136°E', '138°E', '140°E'].map((t, i) => (
            <text key={t} x={150 + i * 256} y="712">
              {t}
            </text>
          ))}
        </g>
      </svg>
      <div className="sc-sonar" style={vars({ left: SONAR.x, top: SONAR.y, animationDuration: `${SONAR.period}s` })} />
      {contacts.map((c, i) => (
        <i
          key={i}
          className={`sc-contact ${c.enemy ? 'sc-enemy' : ''}`}
          style={vars({ left: c.x, top: c.y, animationDelay: `${c.delay}s`, animationDuration: `${SONAR.period}s` })}
        />
      ))}
      <div className="scenery-shade" />
    </div>
  )
}

export type SceneryName = 'harbor' | 'dock' | 'chart'

export function Scenery({ name }: { name: SceneryName }) {
  return name === 'harbor' ? <HarborScene /> : name === 'dock' ? <DockScene /> : <ChartScene />
}
