import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { audio } from './audio'
import { Stage } from './components/Stage'
import { ResumeChoice, Toasts } from './components/ui'
import { Admin } from './screens/Admin'
import { Battle } from './screens/Battle'
import { Dock } from './screens/Dock'
import { Duel } from './screens/Duel'
import { Enlist } from './screens/Enlist'
import { Formation } from './screens/Formation'
import { Friends } from './screens/Friends'
import { Gacha } from './screens/Gacha'
import { Home } from './screens/Home'
import { Missions } from './screens/Missions'
import { Ranking } from './screens/Ranking'
import { Sortie } from './screens/Sortie'
import { StageMap } from './screens/StageMap'
import { Title } from './screens/Title'
import { useGame } from './state'
import type { DuelResponse, MatchResponse, Stage as StageT } from './types'

export type Scene =
  | { name: 'title' }
  // A new admiral registers a name before reaching the harbour.
  | { name: 'enlist' }
  | { name: 'home' }
  | { name: 'map'; area?: number }
  // Opened from the sortie screen, the formation screen returns there.
  | { name: 'formation'; returnTo?: StageT }
  | { name: 'sortie'; stage: StageT }
  | { name: 'battle'; match: MatchResponse; resumed?: boolean; duel?: DuelResponse }
  // Duels against other admirals (beta): the lobby, the room and the deployment.
  | { name: 'duel' }
  | { name: 'gacha' }
  | { name: 'dock' }
  | { name: 'missions' }
  | { name: 'friends' }
  | { name: 'ranking' }
  | { name: 'admin' }

const CURTAIN_MS = 380

/** A duel's battle is shown as a match on a stage of its own. */
function duelMatch(d: DuelResponse): MatchResponse {
  const size = d.duel.boardSize
  const stage: StageT = {
    id: 'PvP', area: 0, no: 0, name: '対人戦 β', brief: '', size, maxTurns: d.duel.maxTurns, starTurns: 0, ai: 0,
    enemies: [], coins: 0, exp: 0, firstGems: 0, dropRate: 0, dropWeights: [],
  }
  return { id: d.id, game: d.duel.game!, stage, fleet: [] }
}

export function App() {
  const [scene, setScene] = useState<Scene>({ name: 'title' })
  const [curtain, setCurtain] = useState<'idle' | 'closing' | 'opening'>('idle')
  const [resumable, setResumable] = useState<MatchResponse | null>(null)
  const [choosing, setChoosing] = useState(false)
  const timers = useRef<number[]>([])
  const { refresh, session, profile, setProfile, notify } = useGame()

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

  // The server keeps the one suspended battle, so it can be resumed or
  // abandoned from the harbour or the sortie screens, on any device.
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
    setChoosing(false)
    go({ name: 'battle', match, resumed })
  }
  // Leaving the suspended battle always goes through the resume-or-abandon choice.
  const onResume = resumable ? () => setChoosing(true) : undefined
  const abandon = async () => {
    if (!resumable) return
    try {
      const res = await api.abandon(resumable.id)
      if (res.profile) setProfile(res.profile)
      setResumable(null)
      setChoosing(false)
      audio.play('back')
      notify('艦隊は海域から撤退しました（敗北）')
    } catch (e) {
      notify((e as Error).message, 'error')
      // It may have ended elsewhere meanwhile; show what the server has now.
      api
        .currentGame()
        .then(setResumable)
        .catch(() => setResumable(null))
    }
  }

  return (
    <Stage>
      {scene.name === 'title' && <Title onStart={() => go({ name: profile?.unnamed ? 'enlist' : 'home' })} />}
      {scene.name === 'enlist' && <Enlist onDone={() => go({ name: 'home' })} />}
      {scene.name === 'home' && <Home go={go} resumable={resumable} onResume={onResume} />}
      {scene.name === 'map' && <StageMap area={scene.area} go={go} resumable={resumable} onResume={onResume} />}
      {scene.name === 'formation' && (
        <Formation onBack={() => go(scene.returnTo ? { name: 'sortie', stage: scene.returnTo } : { name: 'home' })} />
      )}
      {scene.name === 'sortie' && (
        <Sortie
          stage={scene.stage}
          resumable={resumable}
          onResume={onResume}
          onDeploy={(m) => startBattle(m)} onBack={() => go({ name: 'map', area: scene.stage.area })} onFormation={() => go({ name: 'formation', returnTo: scene.stage })} />
      )}
      {scene.name === 'battle' && (
        <Battle
          key={scene.match.id}
          initial={scene.match}
          resumed={scene.resumed}
          onRematch={(m) => startBattle(m)}
          go={go}
          duel={scene.duel}
        />
      )}
      {scene.name === 'gacha' && <Gacha onBack={() => go({ name: 'home' })} />}
      {scene.name === 'dock' && <Dock onBack={() => go({ name: 'home' })} />}
      {scene.name === 'missions' && <Missions onBack={() => go({ name: 'home' })} />}
      {scene.name === 'friends' && <Friends onBack={() => go({ name: 'home' })} />}
      {scene.name === 'ranking' && <Ranking onBack={() => go({ name: 'home' })} />}
      {scene.name === 'duel' && <Duel go={go} onBattle={(d) => go({ name: 'battle', match: duelMatch(d), duel: d })} />}
      {scene.name === 'admin' && <Admin onBack={() => go({ name: 'home' })} />}
      {choosing && resumable && (
        <ResumeChoice match={resumable} onResume={() => startBattle(resumable, true)} onAbandon={abandon} onClose={() => setChoosing(false)} />
      )}
      <div className={`curtain ${curtain}`} aria-hidden>
        <div className="curtain-half top" />
        <div className="curtain-half bottom" />
        <div className="curtain-emblem">⚓</div>
      </div>
      <Toasts />
    </Stage>
  )
}
