import { useEffect } from 'react'
import { audio } from '../audio'
import { Backdrop } from '../components/ui'
import { fx } from '../fx'
import { useGame } from '../state'
import { useAssets } from '../theme'

// Tap-to-start splash. The tap also unlocks audio playback in the browser.
export function Title({ onStart }: { onStart: () => void }) {
  const { ready } = useAssets()
  const { profile, error } = useGame()
  const loaded = ready && (!!profile || !!error)

  useEffect(() => {
    const t = window.setInterval(() => fx.sparkle(200 + Math.random() * 880, 180 + Math.random() * 200, '#bfe9ff', 3, 40), 700)
    return () => clearInterval(t)
  }, [])

  const start = () => {
    if (!loaded) return
    audio.unlock()
    audio.play('ssr')
    fx.flash('#fff', 500, 0.9)
    fx.rays(640, 300, '#bfe9ff', 16, 1)
    onStart()
  }
  return (
    <div className="screen title-screen" onClick={start}>
      <Backdrop scene="title" dim={0.2} />
      <div className="title-glare" />
      <div className="title-logo">
        <p className="title-kicker">NAVAL TACTICS × FLEET COLLECTION</p>
        <h1>
          <span className="title-jp">蒼海戦記</span>
          <span className="title-en">BATTLE SHIP</span>
        </h1>
        <p className="title-sub">― 見えざる艦隊を撃滅せよ ―</p>
      </div>
      <p className={`tap-to-start ${loaded ? '' : 'loading'}`}>{loaded ? 'TAP TO START' : 'LOADING…'}</p>
      {error && <p className="title-error">{error}</p>}
      <footer className="title-foot">© battle_ship project</footer>
    </div>
  )
}
