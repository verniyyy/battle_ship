import type { ReactNode } from 'react'
import type { Pos } from '../types'

// Sea chart grid. Row/column 1 hold the axis labels, so cell (r, c) sits at
// grid-row r+2 / grid-column c+2. Overlays are positioned with CellOverlay.
export function Board({
  size,
  cellClass,
  renderCell,
  onCellClick,
  overlay,
  className = '',
}: {
  size: number
  cellClass?: (p: Pos) => string
  renderCell?: (p: Pos) => ReactNode
  onCellClick?: (p: Pos) => void
  overlay?: ReactNode
  className?: string
}) {
  const idx = Array.from({ length: size }, (_, i) => i)
  return (
    <div className={`board ${className}`} style={{ ['--size' as string]: size }}>
      <span className="corner" />
      {idx.map((c) => (
        <span key={`c${c}`} className="axis">
          {'ABCDE'[c]}
        </span>
      ))}
      {idx.map((r) => [
        <span key={`r${r}`} className="axis">
          {r + 1}
        </span>,
        ...idx.map((c) => {
          const p = { row: r, col: c }
          return (
            <button
              key={`${r}-${c}`}
              type="button"
              className={`cell ${cellClass?.(p) ?? ''}`}
              onClick={onCellClick ? () => onCellClick(p) : undefined}
              aria-label={`${'ABCDE'[c]}${r + 1}`}
            >
              {renderCell?.(p)}
            </button>
          )
        }),
      ])}
      {overlay}
    </div>
  )
}

// CellOverlay is an absolutely positioned box exactly over cell `at`, for effects
// that must not take a slot in the grid.
export function CellOverlay({ at, className = '', children }: { at: Pos; className?: string; children?: ReactNode }) {
  return (
    <div
      className={`cell-overlay ${className}`}
      style={{ left: `calc(var(--axis) + ${at.col} * var(--cell))`, top: `calc(var(--axis) + ${at.row} * var(--cell))` }}
    >
      {children}
    </div>
  )
}
