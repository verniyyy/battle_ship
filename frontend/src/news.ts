import { hasFeature, type AuthSession, type Feature } from './types'

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
 * - News of a hidden feature names it in `feature`, so it stays hidden until
 *   the feature is released and then pops up as unread.
 */
export type NewsItem = {
  id: string
  date: string
  title: string
  items: string[]
  feature?: Feature
}

export const NEWS: NewsItem[] = [
  {
    id: '2026-10-01-gunfire',
    date: '2026-10-01',
    title: '砲撃と爆発の音をリアルに',
    items: [
      '砲撃・命中・誘爆・総攻撃の爆発音を作り直しました。実際の砲声の録音を手本に、衝撃波・火球の轟き・海面の反射・水平線から返ってくる残響まで再現しています。',
      '戦艦は重く長く、駆逐艦は短く鋭く響きます。敵の砲声は遠くからくぐもって届き、命中弾では破片が甲板や海面に降り注ぎます。',
    ],
  },
  {
    id: '2026-10-01-bgm',
    date: '2026-10-01',
    title: '戦闘BGMを一新',
    items: [
      '通常戦闘とボス戦のBGMを新曲に差し替えました。通常戦闘では 2 曲のうちどちらかが戦闘ごとにランダムで流れます。',
      '戦闘中ずっと鳴っていた波の音をなくしました。カモメや雷などの音はときどき聞こえます。',
    ],
  },
  {
    id: '2026-10-01-duel-beta',
    feature: 'duels',
    date: '2026-10-02',
    title: '対人戦（ベータ版）を追加',
    items: [
      '母港の「対人戦」から、ほかの提督と 8×8 の海域で対戦できるようになりました。部屋を作って部屋番号を伝えるか、相手の部屋番号を入力して入室します。',
      '自分の艦隊は手前の 3 列に、相手に見えないように配置します。毎ターン両提督が同時に指示し、揃ったら行動します。1 ターンの持ち時間は 60 秒です。',
      'ベータ版のため報酬はありません。ルールは今後調整していきます。遊んでみた感想をぜひお聞かせください。',
    ],
  },
  {
    id: '2026-10-01-ranking',
    date: '2026-10-01',
    title: 'ランキングを追加',
    items: [
      '母港の「ランキング」から、提督レベル・艦隊戦力・勝利数・無限海域の 4 つのランキングを見られるようになりました。上位 100 名と、あなたの順位を表示します。',
      'ランキングにはあなたの提督名・ひとこと・秘書艦が表示されます。フレンドには目印が付きます。',
    ],
  },
  {
    id: '2026-10-01-fixes',
    date: '2026-10-01',
    title: '建造画面の改善と不具合の修正',
    items: [
      '建造画面で大きく紹介されている艦を、左右の矢印・下の丸ボタン・スワイプで自由に切り替えられるようになりました。',
      '照明弾やソナーで捕捉した敵に全艦斉射を撃つと、カットインが「照準射撃」になっていた不具合を修正しました。捕捉した敵への会心はそのままです。',
      '複数の端末で同じ戦闘を開いているとき、ほかの端末で戦況が進んでいたら最新の状態に更新してからの行動になるようにしました。ほかの端末で使った勲章やコインも、画面に戻ったときに反映されます。',
    ],
  },
  {
    id: '2026-10-01-ultimate',
    date: '2026-10-01',
    title: '決戦技「全艦斉射」を大幅強化',
    items: [
      '範囲を 3×3 から「3×3 ＋ 縦横 2 マス先」の 13 マスに拡大しました（7×7 以上の広い海域では 5×5）。中心ほど威力が高く、中心は 150%、外縁は 60% です。',
      '装甲を半分として扱う装甲貫通弾になり、外れた弾は戦艦の主砲と同じく水柱で周りの敵艦を足止めします。回避不可はそのままです。',
      '演出を一新しました。全艦のカットインから一斉発砲、着弾の連鎖、最後の大爆発まで、決戦技にふさわしい迫力でお届けします。敵艦隊の全艦斉射も同じく強化されているのでご注意を。',
    ],
  },
  {
    id: '2026-10-01-friends',
    date: '2026-10-01',
    title: '「フレンド」機能を追加',
    items: [
      '母港の「フレンド」から、ほかの提督とフレンドになれるようになりました。提督ごとのフレンドコードを教え合って申請し、相手が承認すると成立します（最大 30 人）。',
      'フレンドには毎日 1 回「エール」を送れます。届いたエールは 1 件につき 💰200 として受け取れます。',
      'フレンドの提督名をタップすると、秘書艦・艦隊編成・戦績を見られます。',
    ],
  },
  {
    id: '2026-10-01-stage-fit',
    date: '2026-10-01',
    title: '小さいウィンドウでの表示を修正',
    items: ['ブラウザのウィンドウ幅が狭いと、ゲーム画面が小さく右下にずれて見切れていた不具合を修正しました。どのサイズでも画面いっぱいに収まります。'],
  },
  {
    id: '2026-10-01-gifts',
    date: '2026-10-01',
    title: '運営からの「贈り物」を追加',
    items: [
      '不具合のお詫びや記念のときに、運営からジェムや艦をお届けできるようになりました。届いているときは母港に「贈り物」が表示されるので、期限までに受け取ってください。',
      '提督プロフィールに「提督 ID」を表示しました。お問い合わせのときにお伝えいただくと、スムーズに確認できます。',
    ],
  },
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

/** The entries this admiral may read: those of hidden features stay hidden. */
export function newsFor(session: AuthSession | null): NewsItem[] {
  return NEWS.filter((n) => !n.feature || hasFeature(session, n.feature))
}

/** Of news, the entries newer than the last one seen; all of them on a first visit. */
export function unreadNews(news: NewsItem[]): NewsItem[] {
  const seen = seenId()
  const i = NEWS.findIndex((n) => n.id === seen)
  return i < 0 ? news : news.filter((n) => NEWS.indexOf(n) < i)
}

export function markNewsSeen(news: NewsItem[]) {
  try {
    if (news.length) localStorage.setItem(SEEN_KEY, news[0].id)
  } catch {
    // Private mode or blocked storage: the dialog just shows again next time.
  }
}
