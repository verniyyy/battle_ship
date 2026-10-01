import type { ReactNode } from 'react'

/**
 * Line icons for the harbour menu, drawn on a 24-unit grid in one stroke
 * weight so the tiles read as a set (emoji came in a different style each).
 * They take the tile's text colour.
 */
export type MenuIconName = 'formation' | 'gacha' | 'dock' | 'missions' | 'login' | 'friends' | 'ranking' | 'record' | 'rules' | 'news'

const PATHS: Record<MenuIconName, ReactNode> = {
  // anchor
  formation: (
    <>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 6.5V21M8 10h8M4 13.5c0 4.2 3.6 7.5 8 7.5s8-3.3 8-7.5M2.5 15l1.5-1.5 1.5 1.5M18.5 15l1.5-1.5 1.5 1.5" />
    </>
  ),
  // dockyard tower crane
  gacha: (
    <>
      <path d="M7 21V7M10 21V7M7 11l3 3M10 11l-3 3M7 17l3 3M10 17l-3 3" />
      <path d="M2.5 7h19M8.5 7V3M8.5 3 2.5 7M8.5 3l13 4" />
      <path d="M2.5 7v2.5h3V7M18 7v5.5" />
      <path d="M18 12.5a1.7 1.7 0 1 1-1.7 1.7" />
      <path d="M4.5 21h8" />
    </>
  ),
  // warship in profile
  dock: (
    <>
      <path d="M2 15h20l-2.5 4.5h-15z" />
      <path d="M6 15v-3h11v3M9 12V9h4v3M11 9V5M8 7h6M15 10.5h5" />
    </>
  ),
  // medal on a ribbon
  missions: (
    <>
      <path d="M8 2.5h8L13.5 9h-3z" />
      <circle cx="12" cy="15" r="6" />
      <path d="m12 12 .9 1.9 2.1.2-1.6 1.4.5 2-1.9-1.1-1.9 1.1.5-2-1.6-1.4 2.1-.2z" />
    </>
  ),
  // gift box
  login: (
    <>
      <path d="M3.5 8h17v4h-17zM5 12v9h14v-9M12 8v13" />
      <path d="M12 8C10.5 4.5 7 4 7 6s3 2 5 2c2 0 5 0 5-2s-3.5-1.5-5 2" />
    </>
  ),
  // two officers
  friends: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20.5c0-3.9 2.9-6.5 6.5-6.5s6.5 2.6 6.5 6.5" />
      <path d="M15 4.7a3.5 3.5 0 0 1 0 6.6M17.5 14.4c2.4.9 4 3.1 4 6.1" />
    </>
  ),
  // crown
  ranking: (
    <>
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z" />
      <path d="M5 21h14" />
    </>
  ),
  // logbook with a rising chart
  record: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 17l3-3.5 2.5 2L17 11M8 7h5" />
    </>
  ),
  // open manual
  rules: (
    <>
      <path d="M12 6.5C10 5 7 4.5 3 5v14c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5z" />
      <path d="M12 6.5v14" />
    </>
  ),
  // signal bell
  news: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0M12 3v2" />
    </>
  ),
}

export function MenuIcon({ name }: { name: MenuIconName }) {
  return (
    <svg className="menu-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  )
}
