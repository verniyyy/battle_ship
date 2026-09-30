import { useState } from 'react'
import { api } from '../api'
import { audio } from '../audio'
import { PortraitImg } from '../components/ShipArt'
import { Backdrop } from '../components/ui'
import { fx } from '../fx'
import { lookOfCard } from '../game'
import { useGame } from '../state'
import { portraitOf, useAssets } from '../theme'
import { chars, NAME_MAX } from './Home'

// A new admiral's first stop: register a name before reaching the harbour.
export function Enlist({ onDone }: { onDone: () => void }) {
  const { profile, card, setProfile, notify } = useGame()
  const packs = useAssets()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const sec = profile?.ships.find((s) => s.uid === profile.secretary)
  const secCard = sec ? card(sec.card) : undefined
  const portrait = secCard ? portraitOf(lookOfCard(secCard), packs) : undefined
  const n = chars(name.trim())
  const ok = n > 0 && n <= NAME_MAX

  const submit = async () => {
    if (!ok || busy) return
    setBusy(true)
    try {
      const r = await api.rename(name, '')
      setProfile(r.profile)
      audio.play('stamp')
      fx.flash('#fff', 400, 0.6)
      notify(`${r.profile.name}提督、着任を歓迎します！`, 'good')
      onDone()
    } catch (e) {
      notify((e as Error).message, 'error')
      setBusy(false)
    }
  }

  return (
    <div className="screen enlist-screen">
      <Backdrop scene="title" dim={0.5} />
      <form
        className="modal enlist-card"
        role="dialog"
        aria-label="着任手続き"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <header className="modal-head">
          <h2>着任手続き</h2>
        </header>
        <div className="modal-body">
          <div className="profile-head">
            <div className="profile-face">{portrait ? <PortraitImg portrait={portrait} frame="bust" /> : '⚓'}</div>
            <div className="profile-fields">
              <p className="enlist-greet">
                {secCard ? <b>{secCard.name}</b> : '秘書艦'}「はじめまして。提督のお名前を教えてください」
              </p>
              <label>
                <span>
                  提督名 <small>{n}/{NAME_MAX}</small>
                </span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={NAME_MAX * 2}
                  placeholder="例：蒼海の提督"
                  className={n <= NAME_MAX ? '' : 'bad'}
                />
              </label>
              <p className="enlist-note">あとから母港の提督プレートでいつでも変更できます</p>
            </div>
          </div>
          <div className="modal-actions">
            <button type="submit" className="pill-btn gold" disabled={!ok || busy}>
              着任する
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
