/**
 * Release notes shown in the harbour's news dialog, newest first. Add an
 * entry at the top with a new, never-reused id when shipping something
 * players should hear about; admirals who have not seen it get the dialog
 * on their next visit to the harbour.
 *
 * - Add one in the same PR as any change players will notice: features,
 *   rule or balance changes, visible fixes. Skip refactors, CI and tests.
 * - Never change an existing id; read state is keyed on it. A new id like
 *   `2026-10-01-scout` works; an unreleased entry of the same day can take
 *   more items instead.
 * - Write in Japanese for players: what they can now do or what changed.
 */
export type NewsItem = {
  id: string
  date: string
  title: string
  items: string[]
}

export const NEWS: NewsItem[] = [
  {
    id: '2026-10-01-rematch-win',
    date: '2026-10-01',
    title: '勝利後にも再戦できるように',
    items: ['海域で勝利したあとも「再戦」ボタンから、同じ海域に同じ配置のまま再出撃できるようになりました。周回にどうぞ。'],
  },
  {
    id: '2026-10-01-wreck',
    date: '2026-10-01',
    title: '海図の表示を修正',
    items: ['撃沈した敵艦のいるマスに移動すると、海図上の艦の表示がずれる不具合を修正しました。'],
  },
  {
    id: '2026-10-01-news',
    date: '2026-10-01',
    title: 'お知らせ機能を追加',
    items: ['母港に「お知らせ」を追加しました。アップデートの内容はここでお知らせします。'],
  },
  {
    id: '2026-10-01-scout',
    date: '2026-10-01',
    title: '索敵スキル強化・育成の便利機能',
    items: [
      '索敵スキルの範囲を広げ、見つけた敵艦をロックオンするようにしました。広い海域ほど効果が大きくなります。',
      '艦の育成に「最大まで強化」ボタンを追加しました。',
      '編成画面の艦一覧をマウスのドラッグでスクロールできるようにしました。',
      '艦をたくさん持っていても編成・艦隊一覧が重くならないよう改善しました。',
    ],
  },
  {
    id: '2026-09-30-battle',
    date: '2026-09-30',
    title: '中断した戦闘の再開・再戦',
    items: [
      '撤退した戦闘をサーバーから再開できるようになりました（別の端末からでも続きを遊べます）。',
      '敗北後に同じ配置のまま再戦できるようになりました。',
      '提督名とひとことを提督プロフィールから編集できるようになりました。',
      'BGM と効果音の音量をスピーカーボタンから調整できるようになりました。',
    ],
  },
]

const SEEN_KEY = 'newsSeen'

/** The id of the newest entry this browser has shown, if any. */
function seenId(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

/** Entries newer than the last one seen; all of them on a first visit. */
export function unreadNews(): NewsItem[] {
  const seen = seenId()
  const i = NEWS.findIndex((n) => n.id === seen)
  return i < 0 ? NEWS : NEWS.slice(0, i)
}

export function markNewsSeen() {
  try {
    if (NEWS.length) localStorage.setItem(SEEN_KEY, NEWS[0].id)
  } catch {
    // Private mode or blocked storage: the dialog just shows again next time.
  }
}
