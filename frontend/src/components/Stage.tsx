import { useLayoutEffect, useState, type ReactNode } from 'react'

export const STAGE_W = 1280
export const STAGE_H = 720

// Stage lays the game out on a fixed 1280x720 canvas and scales it to fit the
// window (letterboxed), the way browser games of this genre do.
export function Stage({ children }: { children: ReactNode }) {
  const [view, setView] = useState({ scale: 1, portrait: false })

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

  return (
    <div className="viewport">
      <div className="stage" style={{ transform: `scale(${view.scale})` }}>
        {children}
      </div>
      {view.portrait && <div className="rotate-hint">📱↻ 横向きにするとより快適に遊べます</div>}
    </div>
  )
}
