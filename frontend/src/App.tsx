import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { Stage } from './components/Stage'
import { Battle } from './screens/Battle'
import { Home } from './screens/Home'
import { Sortie } from './screens/Sortie'
import { Title } from './screens/Title'
import type { GameResponse } from './types'

type Scene = { name: 'title' } | { name: 'home' } | { name: 'sortie' } | { name: 'battle'; game: GameResponse; resumed?: boolean }

const SAVE_KEY = 'currentGameId'

function saveGameId(id: string | null) {
  try {
    if (id) localStorage.setItem(SAVE_KEY, id)
    else localStorage.removeItem(SAVE_KEY)
  } catch {
    /* storage unavailable */
  }
}

function loadGameId() {
  try {
    return localStorage.getItem(SAVE_KEY)
  } catch {
    return null
  }
}

const CURTAIN_MS = 420

export function App() {
  const [scene, setScene] = useState<Scene>({ name: 'title' })
  const [curtain, setCurtain] = useState<'idle' | 'closing' | 'opening'>('idle')
  const [resumable, setResumable] = useState<GameResponse | null>(null)
  const timers = useRef<number[]>([])

  // Every scene change goes through a closing/opening shutter.
  const go = useCallback((next: Scene) => {
    timers.current.forEach(clearTimeout)
    setCurtain('closing')
    timers.current = [
      window.setTimeout(() => {
        setScene(next)
        setCurtain('opening')
      }, CURTAIN_MS),
      window.setTimeout(() => setCurtain('idle'), CURTAIN_MS * 2 + 80),
    ]
  }, [])

  useEffect(() => {
    if (scene.name !== 'home') return
    const id = loadGameId()
    if (!id) return
    api
      .getGame(id)
      .then((g) => {
        if (g.game.status === 'in_progress') setResumable(g)
        else saveGameId(null)
      })
      .catch(() => saveGameId(null))
  }, [scene.name])

  const startBattle = (game: GameResponse, resumed = false) => {
    saveGameId(game.id)
    setResumable(null)
    go({ name: 'battle', game, resumed })
  }

  return (
    <Stage>
      {scene.name === 'title' && <Title onStart={() => go({ name: 'home' })} />}
      {scene.name === 'home' && (
        <Home onSortie={() => go({ name: 'sortie' })} onResume={resumable ? () => startBattle(resumable, true) : undefined} />
      )}
      {scene.name === 'sortie' && <Sortie onDeploy={(g) => startBattle(g)} onBack={() => go({ name: 'home' })} />}
      {scene.name === 'battle' && (
        <Battle
          key={scene.game.id}
          initial={scene.game}
          resumed={scene.resumed}
          onFinished={() => saveGameId(null)}
          onRetry={() => go({ name: 'sortie' })}
          onHome={() => go({ name: 'home' })}
        />
      )}
      <div className={`curtain ${curtain}`} aria-hidden>
        <div className="curtain-half top" />
        <div className="curtain-half bottom" />
        <div className="curtain-emblem">⚓</div>
      </div>
    </Stage>
  )
}
