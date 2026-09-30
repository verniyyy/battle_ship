import { useEffect, useRef } from 'react'

// Lets a mouse drag a scrollable strip sideways, the way a finger swipes it.
// A press that turned into a drag swallows the click it ends with, so the
// card under the pointer is not picked by accident.
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let id: number | null = null
    let startX = 0
    let startLeft = 0
    let dragged = false

    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      id = e.pointerId
      startX = e.clientX
      startLeft = el.scrollLeft
      dragged = false
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      const dx = e.clientX - startX
      if (!dragged) {
        if (Math.abs(dx) < 6) return
        dragged = true
        el.setPointerCapture(e.pointerId)
        el.classList.add('dragging')
      }
      el.scrollLeft = startLeft - dx
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      id = null
      el.classList.remove('dragging')
    }
    const click = (e: MouseEvent) => {
      if (!dragged) return
      dragged = false
      e.stopPropagation()
      e.preventDefault()
    }

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('click', click, true)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('click', click, true)
    }
  }, [])
  return ref
}
