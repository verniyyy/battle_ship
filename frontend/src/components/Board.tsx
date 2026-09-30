import type { ReactNode } from 'react'
import { COLS, type Pos } from '../types'

// Sea chart grid. Row/column 1 hold the axis labels, so cell (r, c) sits at
// grid-row r+2 / grid-column c+2. Overlays are positioned with CellOverlay.
// `span` is the pixel width the playing area should fill; cells scale to fit.
export function Board({
  size,
  span = 400,
  cellClass,
  renderCell,
  onCellClick,
  onCellHover,
  overlay,
  className = '',
}: {
  size: number
  span?: number
  cellClass?: (p: Pos) => string
  renderCell?: (p: Pos) => ReactNode
  onCellClick?: (p: Pos) => void
  onCellHover?: (p: Pos | null) => void
  overlay?: ReactNode
  className?: string
}) {
  const idx = Array.from({ length: size }, (_, i) => i)
  const cell = Math.floor(span / size)
  return (
    <div
      className={`board ${className}`}
      style={{ ['--size' as string]: size, ['--cell' as string]: `${cell}px` }}
      onMouseLeave={() => onCellHover?.(null)}
    >
      <span className="corner" />
      {idx.map((c) => (
        <span key={`c${c}`} className="axis">
          {COLS[c]}
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
              onMouseEnter={onCellHover ? () => onCellHover(p) : undefined}
              aria-label={`${COLS[c]}${r + 1}`}
              data-cell={`${r}-${c}`}
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
