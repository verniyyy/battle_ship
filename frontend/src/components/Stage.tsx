import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { fx } from '../fx'
import { liteFx } from '../gfx'

export const STAGE_W = 1280
export const STAGE_H = 720

// Stage lays the game out on a fixed 1280x720 canvas and scales it to fit the
// window (letterboxed), the way browser games of this genre do. It also hosts
// the full-screen effect layers: the shake wrapper, particles and flash.
export function Stage({ children }: { children: ReactNode }) {
  const [view, setView] = useState({ scale: 1, portrait: false })
  const stage = useRef<HTMLDivElement>(null)
  const shaker = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const flash = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const fit = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      setView({ scale: Math.min(w / STAGE_W, h / STAGE_H), portrait: h > w * 1.1 })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // Render particles at device resolution so they stay crisp when scaled up
  // (up to 2x; in light mode at stage resolution, a quarter of the memory).
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const k = Math.min(liteFx() ? 1 : 2, Math.max(1, view.scale * (window.devicePixelRatio || 1)))
    c.width = STAGE_W * k
    c.height = STAGE_H * k
    c.getContext('2d')?.setTransform(k, 0, 0, k, 0, 0)
  }, [view.scale])

  useEffect(() => {
    fx.attach(canvas.current!, stage.current!, shaker.current!, flash.current!)
    return () => fx.detach()
  }, [])

  return (
    <div className="viewport">
      <div className="stage" ref={stage} style={{ transform: `translate(-50%, -50%) scale(${view.scale})` }}>
        <div className="shaker" ref={shaker}>
          {children}
        </div>
        <canvas className="fx-canvas" ref={canvas} width={STAGE_W} height={STAGE_H} />
        <div className="fx-flash" ref={flash} />
      </div>
      {view.portrait && <div className="rotate-hint">📱↻ 横向きにするとより快適に遊べます</div>}
    </div>
  )
}
