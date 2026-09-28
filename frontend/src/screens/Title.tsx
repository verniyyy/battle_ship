import { Backdrop } from '../components/ui'
import { sound, useAssets } from '../theme'

// Tap-to-start splash. The tap also unlocks audio playback in the browser.
export function Title({ onStart }: { onStart: () => void }) {
  const { ready } = useAssets()
  const start = () => {
    if (!ready) return
    sound.se('click')
    sound.playBgm('title')
    onStart()
  }
  return (
    <div className="screen title-screen" onClick={start}>
      <Backdrop scene="title" dim={0.2} />
      <div className="title-glare" />
      <div className="title-logo">
        <p className="title-kicker">NAVAL TACTICS SIMULATION</p>
        <h1>
          <span className="title-jp">海戦</span>
          <span className="title-en">BATTLE SHIP</span>
        </h1>
        <p className="title-sub">― 見えざる艦隊を撃滅せよ ―</p>
      </div>
      <p className={`tap-to-start ${ready ? '' : 'loading'}`}>{ready ? 'TAP TO START' : 'LOADING…'}</p>
      <footer className="title-foot">© battle_ship project</footer>
    </div>
  )
}
