import { useEffect, useState } from 'react'
import { api, auth } from '../api'
import { audio } from '../audio'
import { Backdrop } from '../components/ui'
import { fx } from '../fx'
import { useGame } from '../state'
import { useAssets } from '../theme'

const LOGIN_PROBLEMS: Record<string, string> = {
  cancelled: 'ログインをキャンセルしました',
  expired: 'ログインの有効期限が切れました。もう一度お試しください',
  failed: 'ログインに失敗しました。時間をおいて再度お試しください',
}

/** Takes the ?login= problem the server sent the browser back with, and tidies the URL. */
function takeLoginProblem(): string | null {
  const url = new URL(location.href)
  const problem = url.searchParams.get('login')
  if (problem === null) return null
  url.searchParams.delete('login')
  history.replaceState(null, '', url)
  return LOGIN_PROBLEMS[problem] ?? LOGIN_PROBLEMS.failed
}

// Tap-to-start splash, behind sign-in. The tap also unlocks audio playback in the browser.
export function Title({ onStart }: { onStart: () => void }) {
  const { ready } = useAssets()
  const { session, profile, error, signOut, reloadSession } = useGame()
  const [problem] = useState(takeLoginProblem)
  const [busy, setBusy] = useState(false)
  const [apiVersion, setApiVersion] = useState('…')
  const signedIn = !!session?.signedIn
  const loaded = ready && signedIn && (!!profile || !!error)

  useEffect(() => {
    const t = window.setInterval(() => fx.sparkle(200 + Math.random() * 880, 180 + Math.random() * 200, '#bfe9ff', 3, 40), 700)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    api.version().then(
      (v) => setApiVersion(v.version),
      () => setApiVersion('?'),
    )
  }, [])

  const devLogin = async (admin = false) => {
    setBusy(true)
    try {
      await auth.dev(admin)
      await reloadSession()
    } finally {
      setBusy(false)
    }
  }

  const start = () => {
    if (!loaded) return
    audio.unlock()
    audio.play('start')
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
          <span className="title-jp" data-text="蒼海戦記">
            <span>蒼海戦記</span>
          </span>
          <span className="title-en">
            <span data-text="BATTLE SHIP">
              <span>BATTLE SHIP</span>
            </span>
          </span>
        </h1>
        <p className="title-sub">見えざる艦隊を、撃滅せよ。</p>
      </div>
      {session && !signedIn ? (
        <div className="login-panel" onClick={(e) => e.stopPropagation()}>
          {session.google && (
            <button className="google-btn" disabled={busy} onClick={() => (setBusy(true), auth.google())}>
              <GoogleMark />
              Google でログイン
            </button>
          )}
          {session.dev && (
            <>
              <button className="pill-btn ghost" disabled={busy} onClick={() => void devLogin()}>
                開発用ログイン
              </button>
              <button className="pill-btn ghost" disabled={busy} onClick={() => void devLogin(true)}>
                開発用ログイン（管理者）
              </button>
            </>
          )}
          <p className="login-note">戦績と艦隊はアカウントに保存され、どの端末からでも続きを遊べます</p>
        </div>
      ) : (
        <p className={`tap-to-start ${loaded ? '' : 'loading'}`}>{loaded ? 'TAP TO START' : 'LOADING…'}</p>
      )}
      {(error || (!signedIn && problem)) && <p className="title-error">{error ?? problem}</p>}
      {signedIn && (
        <div className="title-account" onClick={(e) => e.stopPropagation()}>
          <span>{session?.email}</span>
          <button onClick={() => void signOut()}>ログアウト</button>
        </div>
      )}
      <footer className="title-foot">
        © battle_ship project ・{' '}
        <a href="/privacy.html" target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
          プライバシーポリシー
        </a>
        <span className="title-version">
          web {__APP_VERSION__} ・ api {apiVersion}
        </span>
      </footer>
    </div>
  )
}

// Google's "G" logo, as its sign-in branding guidelines ask for.
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
