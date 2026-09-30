import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { audio } from './audio'
import { Stage } from './components/Stage'
import { Toasts } from './components/ui'
import { Battle } from './screens/Battle'
import { Dock } from './screens/Dock'
import { Formation } from './screens/Formation'
import { Gacha } from './screens/Gacha'
import { Home } from './screens/Home'
import { Missions } from './screens/Missions'
import { Sortie } from './screens/Sortie'
import { StageMap } from './screens/StageMap'
import { Title } from './screens/Title'
import { useGame } from './state'
import type { MatchResponse, Stage as StageT } from './types'

export type Scene =
  | { name: 'title' }
  | { name: 'home' }
  | { name: 'map'; area?: number }
  | { name: 'formation' }
  | { name: 'sortie'; stage: StageT }
  | { name: 'battle'; match: MatchResponse; resumed?: boolean }
  | { name: 'gacha' }
  | { name: 'dock' }
  | { name: 'missions' }

const CURTAIN_MS = 380

export function App() {
  const [scene, setScene] = useState<Scene>({ name: 'title' })
  const [curtain, setCurtain] = useState<'idle' | 'closing' | 'opening'>('idle')
  const [resumable, setResumable] = useState<MatchResponse | null>(null)
  const timers = useRef<number[]>([])
  const { refresh, session } = useGame()

  // Every scene change goes through a closing/opening shutter.
  const go = useCallback((next: Scene) => {
    timers.current.forEach(clearTimeout)
    setCurtain('closing')
    audio.play('whoosh')
    timers.current = [
      window.setTimeout(() => {
        setScene(next)
        setCurtain('opening')
      }, CURTAIN_MS),
      window.setTimeout(() => setCurtain('idle'), CURTAIN_MS * 2 + 80),
    ]
  }, [])

  useEffect(() => {
    const track = scene.name === 'title' ? null : scene.name === 'battle' ? (scene.match.stage.boss ? 'boss' : 'battle') : scene.name === 'gacha' ? 'gacha' : 'home'
    if (track) audio.music(track)
  }, [scene])

  // Signing out, or a session running out, goes back to the sign-in screen.
  useEffect(() => {
    if (session && !session.signedIn && scene.name !== 'title') go({ name: 'title' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.signedIn])

  // The server remembers the battle retreated from, so it can be resumed from
  // the harbour or the sortie screens, on this device or another.
  useEffect(() => {
    if (scene.name === 'home') void refresh()
    if (scene.name !== 'home' && scene.name !== 'map') return
    api
      .currentGame()
      .then(setResumable)
      .catch(() => setResumable(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.name])

  const startBattle = (match: MatchResponse, resumed = false) => {
    setResumable(null)
    go({ name: 'battle', match, resumed })
  }
  const onResume = resumable ? () => startBattle(resumable, true) : undefined

  return (
    <Stage>
      {scene.name === 'title' && <Title onStart={() => go({ name: 'home' })} />}
      {scene.name === 'home' && <Home go={go} resumable={resumable} onResume={onResume} />}
      {scene.name === 'map' && <StageMap area={scene.area} go={go} resumable={resumable} onResume={onResume} />}
      {scene.name === 'formation' && <Formation onBack={() => go({ name: 'home' })} />}
      {scene.name === 'sortie' && (
        <Sortie
          stage={scene.stage}
          resumable={resumable}
          onResume={onResume}
          onDeploy={(m) => startBattle(m)} onBack={() => go({ name: 'map', area: scene.stage.area })} onFormation={() => go({ name: 'formation' })} />
      )}
      {scene.name === 'battle' && (
        <Battle
          key={scene.match.id}
          initial={scene.match}
          resumed={scene.resumed}
          onRematch={(m) => startBattle(m)}
          go={go}
        />
      )}
      {scene.name === 'gacha' && <Gacha onBack={() => go({ name: 'home' })} />}
      {scene.name === 'dock' && <Dock onBack={() => go({ name: 'home' })} />}
      {scene.name === 'missions' && <Missions onBack={() => go({ name: 'home' })} />}
      <div className={`curtain ${curtain}`} aria-hidden>
        <div className="curtain-half top" />
        <div className="curtain-half bottom" />
        <div className="curtain-emblem">⚓</div>
      </div>
      <Toasts />
    </Stage>
  )
}
