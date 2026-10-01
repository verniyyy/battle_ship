# 蒼海戦記 BATTLE SHIP

見えない敵艦隊を索敵して撃沈する海戦ゲームに、艦の収集・育成・キャンペーンを組み合わせたブラウザゲームです。

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `backend/` | Go (標準 `net/http` + `pgx`)。`game`: 戦闘ルールと CPU 思考、`meta`: 艦カード・ガチャ・海域・報酬・任務、`api`: REST API |
| `frontend/` | React + TypeScript + Vite。docker compose では nginx で配信し `/api` を backend へプロキシ |
| `edge/` | 本番用の Cloudflare Worker。frontend を配信し、`/api` を守りつつ Vercel 上の backend へ転送 |
| `docker-compose.yml` | PostgreSQL / backend / frontend |
| `flake.nix` / `justfile` | 開発シェル（`just`・デプロイ用 CLI を提供）とタスク定義 |

プレイヤーは Google アカウントでログインし（OpenID Connect）、署名付きのセッション Cookie で識別します。プロフィールと対局は PostgreSQL に JSONB で保存します（サーバーはステートレス）。決着の一手と報酬の支払いは同じトランザクションで確定します。マイグレーションは backend 起動時に自動適用されます。

## 起動

タスクは [just](https://github.com/casey/just) で管理しています。`just` は Nix flake の開発シェルに入っています（Docker は OS 側のものを使います）。

```sh
nix develop      # just が使えるシェルに入る
just up          # イメージをビルドしてバックグラウンドで起動（docker compose up -d --build）
just logs        # ログを追う（just logs backend のようにサービスも指定可）
just down        # 停止
just             # レシピ一覧
```

Nix を使わない場合は `docker compose up -d --build` でも同じです。

- アプリ: http://localhost:8080 （タイトル画面の「開発用ログイン」で入れます）
- API: http://localhost:8081 （例: `curl localhost:8081/api/catalog`）
- PostgreSQL: `localhost:5432`（user / password / db はすべて `battleship`）

画面の動作確認は Playwright の E2E テストで行います。`just up` で起動した状態で `nix develop -c just e2e` を実行します（ブラウザは flake が nixpkgs から用意します）。テストは開発用ログインで毎回新しい提督を作り、スクリーンショットを `frontend/e2e/results/shots/` に残します。

データを消して最初からやり直す場合は `docker compose down -v`。

ローカルでも Google ログインを試す場合は、下記「Google ログインの設定」で作った OAuth クライアントの承認済みリダイレクト URI に `http://localhost:8080/api/auth/google/callback` を追加し、リポジトリ直下の `.env`（git 管理外）に `GOOGLE_CLIENT_ID=...` と `GOOGLE_CLIENT_SECRET=...` を書いてから `just up` します。

効果音と BGM は Web Audio で合成しているので、素材なしでも音が鳴ります。キャラ絵がない艦カードは SVG で描いた艦影を表示します。

### 旧バージョンの素材を使う（任意）

旧バージョンの背景・BGM は git 履歴に残っており、次のスクリプトでローカルに復元できます。

```sh
./scripts/salvage-legacy-assets.sh                     # frontend/public/legacy/ に展開
./scripts/import-ui-assets.sh "/path/to/海戦ゲーム用"   # 母港背景などの UI 素材（ImageMagick 7 が必要）
```

復元先はいずれも `.gitignore` 済みです。第三者の素材を含むため **コミットしないでください**。キャラ絵は旧素材を使わず、初期 3 隻も含めて全艦を下記の手順で生成します。

### キャラ絵を生成する（任意・無料）

全 22 艦のキャラ絵（全身・背景透過）を AI で生成できます。生成した絵は艦カード・母港の秘書艦・建造・カットイン・マップ上の駒に使われ、カードや駒では検出した顔の位置に合わせてバストアップに、秘書艦や建造では全身で表示します。

絵はキャラクターデザインそのものに専念します。艤装（砲塔や機械）は崩れやすいので描かせず、艦種らしさは軍服・セーラー襟・錨の紋章などの衣装で表現し、武器や小物は剣・槍・傘・紙飛行機など形の崩れにくいものを 1 人 1 つだけ持たせます。エフェクト（雷・炎・キラキラ）や背景（月・空）も描かせず、描かれてしまった候補は自動で落とします。

GPU は [Google Colab](https://colab.research.google.com) の無料枠（T4）を使います。モデルはアニメ系 SDXL の [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0)（ライセンスは CreativeML Open RAIL++-M）。手元に必要なのは Go だけです。

1. キットを作る（`tools/portraitgen` の Python パッケージと、`backend/cmd/portraits/characters.go` のキャラ設定から組み立てたプロンプト）

   ```sh
   cd backend && go run ./cmd/portraits kit           # -> .cache/portraits/kit.zip
   ```

2. [`tools/portraitgen/colab.ipynb`](tools/portraitgen/colab.ipynb) を Colab で開き（ファイル → ノートブックをアップロード）、ランタイムを **T4 GPU** にして上から実行
   - ③ 探索: カードごとに下描きを何枚も描いて自動で選別。全身が枠からはみ出す・顔の大きさが全身絵でない・複数人・エフェクトや背景や艤装が描かれている（[WD タガー](https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3)で検出）・背景が無地でない・キャラから離れた物体がある候補は不採用。残りを「美観スコア＋デザイン通りか（髪色・武器）−黒つぶれの強いコントラスト」の順に表示
   - ④ 仕上げ: 採用した下描きを Real-ESRGAN で拡大して 1.5 倍で描き直し、キャラ全体をタイルに分けてさらに約 2 倍で描き直し（衣装・装飾・武器の細部）、顔と手を 1024px で描き直す。最後にエフェクトの混入を再検査し、背景から浮いた小さな破片を除いて切り抜く。気に入った候補は `PICKS` で指定（省略時はスコア最上位）
   - ⑤ `portraits.zip` をダウンロード
3. 取り込む（`frontend/public/portraits/` に WebP を置き、顔の位置を含む `manifest.json` を更新）

   ```sh
   cd backend && go run ./cmd/portraits import ~/Downloads/portraits.zip
   ```

T4 では探索が 1 枚約 30 秒、仕上げが 1 枚約 3 分です（全艦で合計 2 時間ほど。`SAVE_TO_DRIVE` で中断しても再開可能）。一部の艦だけ作り直すときは `-only bb_guren,ca_soyo` でキットを作るか、ノートブックの `ONLY` を使います。取り込みは艦ごとに上書きされ、他の艦の絵はそのまま残ります。

**演出つき一枚絵（SR 以上）**: ガチャや詳細画面向けに、仕上げた立ち絵へ背景とエフェクトを描き足した一枚絵を作れます。対象は `characters.go` で `Stage`（背景・エフェクトを英語の短い語句で）を書いたカードで、今は天照と須佐之男だけです。ノートブックの ⑥ で [FLUX.2 [klein] 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)（Apache-2.0）が指示どおりに絵全体を編集した背景を seed 違いで描き、⑦ で選んだ背景を拡大・周辺減光してから元の立ち絵を原寸で重ね直します（klein はキャラも描き直すため、使うのは背景とキャラに当たった光だけで、絵柄は変わりません）。一枚絵は `portraits.zip` の `staged/` に入り、同じ `import` で `frontend/public/portraits/staged/` と `manifest.json` の `staged` に取り込まれます。立ち絵だけを作り直して取り込むと、古くなった一枚絵は外れます。

キャラの見た目を変えたいときは `characters.go` のキャラ設定（Danbooru タグ）を編集してキットを作り直してください。冒頭のコメントにある設計ルール（艤装・エフェクトなし、武器は 1 つ、配色は 2〜3 色）はテストでも検査しています。`Check` にはタガーの語彙にあるタグだけを書けます。生成パイプラインのテストは CPU だけで動きます（`cd tools/portraitgen && uv run pytest`、極小のダミーモデルで SDXL の各工程を、本物の Real-ESRGAN の重みで拡大を通します）。生成物は `.gitignore` 済みです。

## ゲームの流れ

1. **母港** — 秘書艦、ログインボーナス（7 日周期）、通知バッジ、連勝数と艦隊戦力、アップデートのお知らせ（未読があれば母港に来たとき一度だけ表示。既読はブラウザごとに記録）。お知らせを出すときは `frontend/src/news.ts` の `NEWS` の先頭に新しい `id` で項目を足す
2. **出撃** — 4 海域 × 4 ステージのキャンペーン。各ステージに ★3 つ（勝利／規定ターン内／損失なし）。4-4 を突破すると無限海域（5 層ごとに旗艦）が解放
3. **出撃準備** — 編成した艦隊を海域に配置
4. **戦闘** — 下記ルール。カットインはタップでスキップ、演出速度 ×1〜×3、「中断」した戦闘は一つだけ保持され、再開時に「復帰」か「完全に撤退」（敗北扱い・報酬なし）を選ぶ。中断中は新たに出撃できない
5. **戦果報告** — 評価 S〜E、★、報酬の内訳（評価・連勝・コンボ・会心ボーナス）、提督と艦の経験値、ドロップ、3 つから 1 つ選ぶ宝箱
6. **建造** — 1 回 💎100 / 10 連 💎1000（SR 以上 1 枠確定、初回無料）。60 回以内に SSR 以上確定。同じ艦は限界突破
7. **艦隊 / 編成 / 任務** — 資金で強化、図鑑、デイリー任務と勲功（実績）
8. **フレンド** — 提督ごとの 8 文字のフレンドコード（提督 ID は公開しない）を教え合って申請し、承認で成立（最大 30 人。互いに申請していれば即成立）。フレンドには毎日（JST）1 回エールを送れ、受け取った側は 1 件 💰200 で回収する。フレンドの秘書艦・編成・戦績を閲覧できる
9. **ランキング** — 提督レベル（同レベルは経験値順）・艦隊戦力・勝利数・無限海域の最深層の 4 種。上位 100 名と自分の順位を表示し、同じ記録は同順位。名前を決めていない提督と記録が 0 の提督は載らない。ほかの提督は名前・ひとこと・秘書艦だけを表示する（提督 ID・フレンドコードは出さない）。順位付けに使う値はプロフィール保存時に `players` の列へ書き出し、それより前に保存された行は backend 起動時に補完する（`meta.ScoresVersion` を上げると全員分を計算し直す）
10. **対人戦（ベータ版・未公開）** — 機能フラグ `duels` で隠してあり、公開するまでは管理者にだけ見える（下記「機能フラグ」）。ほかの提督と 8×8 の海域で対戦。部屋を作って 6 文字の部屋番号を伝え、相手が入室すると開始。両提督とも現在の編成で、手前の 3 列に相手に見えないよう配置する（3 分で未配置ならおまかせ）。戦闘ルールは通常の海戦と同じで、毎ターン両者が同時に指示を出し、揃ったら解決する。持ち時間は 1 ターン 60 秒で、時間切れのターンは行動なし、3 回続くと敗北。30 ターンで決着しなければ残り耐久の割合で判定し、同率は引き分け。いつでも降伏できる。報酬はなく（勝敗の記録のみ）、ロビーに通算成績と直近 5 戦を表示する

   常時接続は使わず両者がポーリングする（相手待ちは 4 秒、自分の手番は 10 秒、部屋・配置中は 5 秒間隔。タブが裏にある間は止める。変化がなければ 204）。サーバーはステートレスなので、期限を過ぎた後に届いたどちらかのリクエストが対戦を進める（`meta.Duel.Tick`）。2 人目の提督（`SideCPU`）には盤面を上下反転し陣営を入れ替えたビューを返す（`game.State.ViewFor`）ので、どちらの提督も自軍が手前の同じ画面で遊べる。15 分の対戦 1 回で 2 人合わせて 300 回ほどのリクエストになり、Worker の 1 日の上限（30,000 回）を消費する点に注意（正式版では間隔の調整を検討）

## 戦闘ルール

- 両軍は同じ N×N（5〜7）の海域に潜む。海況（快晴・濃霧・時化・夜戦）は出撃ごとに変わる
- **毎ターン両軍が同時に 1 隻ずつ行動を決め、速力の高い艦から実行**（雷撃は必ず後攻、同速はランダム）。先に沈められた艦の行動は失われる
  - **砲撃**: 艦種ごとの射程（戦艦・巡洋艦・駆逐艦 2、空母 1）内の 1 マス。戦艦の主砲は十字に着弾し、外れても**水柱**で周りの水上艦を次のターンまで足止め。駆逐艦の砲撃は潜水艦に 2 倍
  - **雷撃**: 縦横に海の端まで直進し最初の水上艦に命中（潜水艦には当たらない）。雷跡で発射位置が露見する
  - **移動**: 縦横に艦種ごとの距離まで（戦艦・空母 1、巡洋艦・潜水艦 2、駆逐艦 3）。艦・方角・距離が相手に通知される（潜水艦は秘匿）
  - **スキル**（回数制）: 戦艦「一斉射」3×3 砲撃／巡洋艦「照明弾」3×3 の水上艦を発見／駆逐艦「ソナー」縦横一列の全艦を発見／潜水艦「扇状雷撃」3 列同時の魚雷／空母「航空攻撃」全域の 1 マスを爆撃
  - **全艦斉射**: 決戦ゲージ満タンで海域のどこへでも撃てる決戦技。3×3 と縦横 2 マス先（広い海域では 5×5）を中心ほど高威力で砲撃し、装甲貫通・回避不可。外れた弾は水柱で足止め
- ダメージは火力・雷装・航空の ±15%、装甲で軽減、会心で 2 倍。空母の爆撃は相手艦隊の対空合計で減衰する
- **特殊攻撃**（カットイン付き）: 同じ地点へ主砲を 2 連続で撃つ「着弾観測射撃」（必ず会心）／追跡中の敵への「精密爆撃」（対空・回避を無視）／2 マス以内への「肉薄雷撃」（必ず会心）
- 着弾は「命中（会心・回避あり）」「水しぶき（周囲に水上艦）」「外れ」で通知。一度見つけた水上艦は移動しても追跡され続ける。潜水艦はソナーでしか見つからず、潜航移動で追跡を振り切れる
- 全艦撃沈で決着。攻撃手段が尽きた側は戦略的撤退（敗北）、互いに攻撃手段がなければ判定。ターン制限では残り耐久の割合で判定（同率は防衛側の CPU 勝ち）

艦カード・敵・海域・報酬の数値は `backend/internal/meta/catalog.go` で調整できます。設計の意図と調整の目安は [`docs/game-design.md`](docs/game-design.md) にまとめています。数値を変えたら AI 同士の対戦シミュレーションで全ステージの勝率と決着ターンを確認できます。

```sh
cd backend && SIM=1 go test ./internal/meta -run Simulate -v
```

## API

`/api/catalog`・`/api/version`・`/api/auth/*` 以外はすべてログインが必要です（セッション Cookie がなければ 401）。`/api/admin/*` は管理者のみ（それ以外は 403。状態を変える操作は自サイトのページからのリクエストだけを受け付けます）。

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/version` | 動いている backend のバージョン `{"version":"cbee965"}` |
| GET | `/api/auth/session` | ログイン状態 `{"signedIn":true,"email":"...","admin":false,"google":true,"dev":false,"features":[]}`（`google` / `dev` は使えるログイン方法、`admin` は管理画面を開けるか、`features` は見える機能フラグ） |
| GET | `/api/auth/google/login?guest=<UUID>` | Google のログイン画面へリダイレクト。`guest` はログイン機能より前にこのブラウザで遊んでいたプレイヤー ID で、そのアカウントの初回ログイン時に進行状況を引き継ぐ |
| GET | `/api/auth/google/callback` | Google からの戻り先。セッション Cookie を発行して `/` へ（失敗時は `/?login=cancelled\|expired\|failed`） |
| POST | `/api/auth/logout` | ログアウト |
| POST | `/api/auth/dev` | 開発用ログイン `{"guest":"<UUID>","admin":false}`（`DEV_LOGIN=1` のときだけ存在。`admin` で管理者 `dev:admin` としてログイン） |
| GET | `/api/catalog` | 艦カード・敵・海域・ガチャ・任務などの静的データ |
| GET | `/api/profile` | プロフィール（初回アクセスで作成） |
| POST | `/api/profile/login` | ログインボーナス受取 |
| POST | `/api/profile/fleet` | 編成 `{"uids":["s1","s2"]}` |
| POST | `/api/profile/secretary` | 秘書艦 `{"uid":"s1"}` |
| POST | `/api/ships/{uid}/train` | 資金で 1 レベル強化 |
| POST | `/api/gacha` | 建造 `{"count":1\|10}` |
| POST | `/api/missions/{id}/claim` | デイリー任務の報酬受取 |
| POST | `/api/achievements/{id}/claim` | 勲功の報酬受取 |
| POST | `/api/games` | 出撃 `{"stageId":"1-1","placements":[{"row":0,"col":0}, ...]}`（添字 = 編成順）。中断中の戦闘があると 409 |
| GET | `/api/games/current` | 中断中の戦闘（なければ 404） |
| GET | `/api/games/{id}` | 対局状態（敵艦の位置は索敵済みのものだけ） |
| POST | `/api/games/{id}/actions` | 行動 `{"type":"attack"\|"torpedo"\|"move"\|"skill"\|"ultimate","shipId":0,"target":{"row":1,"col":1}}`。CPU の行動と合わせて 1 ターンを解決し、実行順の `results`、決着時は報酬も返る |
| POST | `/api/games/{id}/chest` | 宝箱を開ける `{"index":0}` |
| POST | `/api/games/{id}/abandon` | 中断中の戦闘から完全に撤退（敗北扱い・報酬なし） |
| GET | `/api/games?limit=20` | 終了した対局の一覧 |
| GET | `/api/gifts` | 受け取れる運営からの贈り物 |
| POST | `/api/gifts/claim` | 贈り物を受け取る `{"id":"<UUID>"}`（`id` を省くとすべて） |
| GET | `/api/friends` | フレンド画面（自分のフレンドコード・フレンド・届いた申請・送った申請・未回収のエール数）。以下の変更系はすべてこの内容を `friends` に入れて返す |
| GET | `/api/friends/{code}` | フレンド（または申請中の相手）の秘書艦・編成・戦績 |
| POST | `/api/friends/requests` | フレンド申請 `{"code":"K7QM-4XPA"}`（ハイフン・大小文字は不問）。相手からも申請が来ていれば即成立し `befriended: true` |
| POST | `/api/friends/requests/{code}/accept` \| `decline` \| `cancel` | 届いた申請の承認・拒否、送った申請の取り消し |
| POST | `/api/friends/{code}/remove` | フレンド解除 |
| POST | `/api/friends/{code}/cheer` | 今日のエールを送る（`/api/friends/cheer` で未送信の全員へ） |
| POST | `/api/friends/cheers/claim` | 届いたエールをまとめてコインで受け取る |
| GET | `/api/rankings/{board}` | ランキング（`level` \| `power` \| `wins` \| `endless`）。上位 100 名・掲載人数・自分の順位（載っていなければ `rank: 0`） |
| GET | `/api/duels` | 対人戦ロビー（参加中の対戦 `id` / `duel`、なければ `null`。対戦成績 `record`） |
| POST | `/api/duels` | 対人戦の部屋を作る（現在の編成で参加）。参加中の対戦があると 409 |
| POST | `/api/duels/join` | 部屋に入る `{"code":"ABC-DEF"}`（ハイフン・大小文字は不問） |
| GET | `/api/duels/{id}?rev=N` | 対戦の状態（自分側から見たもの）。`rev` が最新と同じなら 204（ポーリング用）。期限切れの処理もここで進む |
| POST | `/api/duels/{id}/placement` | 配置 `{"placements":[{"row":7,"col":0}, ...]}`（自分から見た座標。手前 3 列のみ） |
| POST | `/api/duels/{id}/actions` | 行動 `{"type":"move","shipId":0,"target":{...},"turn":0}`。両者が揃うとターンを解決。`turn` が古いと 409 |
| POST | `/api/duels/{id}/leave` | 対戦前なら部屋を閉じる、対戦中なら降伏 |
| GET | `/api/admin/gifts` | 【管理】配布の一覧（受取人数・受取件数つき） |
| POST | `/api/admin/gifts` | 【管理】配布を作成 `{"gift":{"title":"...","message":"...","gems":300,"coins":0,"cards":[],"startsAt":"...","endsAt":"...","everyone":true,"joinedBefore":"..."},"recipients":["<UUID>"]}` |
| POST | `/api/admin/gifts/{id}/revoke` | 【管理】配布を停止（受け取り済みの分はそのまま） |
| GET | `/api/admin/players?q=...` | 【管理】提督を ID・名前・メールアドレスで検索 |
| GET | `/api/admin/audit` | 【管理】操作ログ |

### 運営からの配布（管理画面）

不具合のお詫びや記念の配布は、管理者アカウントでログインして母港の「🛠 管理」から行います。デプロイは不要です。

- **配布先**: 全員（「この日時より前に着任した提督のみ」で、障害のあとに作ったアカウントを対象外にできます）か、指定した提督（名前・メールアドレス・提督 ID で検索。提督 ID はプロフィールに表示され、問い合わせのときに伝えてもらえます）
- **内容**: ジェム・コイン・艦カード（重複は建造と同じく限界突破）。誤入力を防ぐため、1 件あたりジェム 10,000・コイン 1,000,000・艦カード 5 枚・受取人 500 人・期間 180 日が上限です
- 提督は期間中に母港の「贈り物」から受け取ります。受け取りはプロフィールの更新と同じトランザクションで確定し、二重には受け取れません
- 作成後に内容は変えられませんが、停止はできます。作成と停止はすべて `admin_audit` テーブル（管理画面の「操作ログ」）に残ります

## デプロイ

公開 URL: https://battleship.verniyyy.workers.dev

すべて**支払い方法を登録していない無料プラン**で動かしています。悪意あるアクセスがあっても課金は発生せず、起こりうるのは無料枠を使い切ったあとの一時停止だけです。**どのサービスにもクレジットカードを登録しない・有料プランにアップグレードしない**でください。

```
ブラウザ ─► Cloudflare Workers (Free)          edge/
             ├─ 静的ファイル: frontend/dist（無料・無制限。Worker は実行されない）
             └─ /api/*: IP ごとのレート制限（120 回/分）→ 1 日の上限（30,000 回, UTC 0 時リセット）
                        → 共有シークレットを付けて転送
                          ▼
            Vercel Hobby: backend/ の Go サーバー（東京 hnd1）
              WAF: シークレットの無いリクエストは拒否（Hobby の使用量に数えられない）
                          ▼
            Supabase Free: PostgreSQL（東京、Session pooler 経由）
```

- 1 日の上限は Vercel Hobby の月 100 万回を超えないための値です。Vercel は上限超過で最大 30 日止まりますが、この上限のおかげで止まるのは最悪でも翌日 9:00（JST）までです。
- Worker の Cron が毎日 `/readyz` を叩いて DB に触れるので、Supabase の無料プロジェクトが 7 日間の無操作で一時停止されることはありません。
- 旧素材（`public/legacy/`）は第三者の素材なので `frontend/public/.assetsignore` で配信対象から外しています。キャラ絵（`public/portraits/`）は git 管理外なので、デプロイは手元から行います。

### 更新のデプロイ

```sh
nix develop          # just / bun / node / wrangler が入ったシェル
just deploy          # backend を Vercel へ、frontend + Worker を Cloudflare へ
just deploy-api      # backend だけ
just deploy-web      # frontend と Worker だけ
```

どちらも `git describe --always --dirty` の値（例: `cbee965`、未コミットの変更があれば `cbee965-dirty`）をバージョンとして埋め込みます。デプロイ中のバージョンはタイトル画面の最下部（`web … ・ api …`）か、次のコマンドで確認できます。

```sh
just versions        # 手元・公開中の frontend（/version.json）・backend（/api/version）のバージョン
```

初回だけ `npx vercel login` と `wrangler login` が必要です。backend のリンク情報は `backend/.vercel/`（git 管理外）にあります。

### 設定の置き場所

| 設定 | 場所 |
| --- | --- |
| `DATABASE_URL`（Supabase Session pooler の URI + `?sslmode=require&pool_max_conns=3`） | Vercel の環境変数（Production, Secret） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（Google OAuth クライアント） | Vercel の環境変数（Production, Secret） |
| `SESSION_SECRET`（セッション Cookie の署名鍵。32 文字以上のランダム値） | Vercel の環境変数（Production, Secret） |
| `PUBLIC_URL`（`https://battleship.verniyyy.workers.dev`。Google からの戻り先と Cookie の `Secure` 判定に使う） | Vercel の環境変数（Production） |
| `ADMIN_SUBJECTS`（管理者のアカウント。カンマ区切りの `google:<sub>`） | Vercel の環境変数（Production） |
| `FEATURES`（公開する機能フラグ。カンマ区切り、例: `duels`） | Vercel の環境変数（Production） |
| `ORIGIN_SECRET`（Worker と Vercel の共有シークレット） | Vercel の環境変数、Cloudflare の Worker シークレット、Vercel WAF のカスタムルール「Only via edge proxy」の 3 か所 |
| 転送先 URL・1 日の上限・レート制限 | `edge/wrangler.jsonc` |

`SESSION_SECRET` を入れ替えると全員がログアウトされます（進行状況は消えません）。

`ORIGIN_SECRET` を入れ替えるときは 3 か所すべてを同じ値に更新します（`vercel env add ORIGIN_SECRET production --force`、`wrangler secret put ORIGIN_SECRET`、`vercel firewall rules` でルールを作り直して `vercel firewall publish`）。その後 `just deploy-api` で Vercel に反映します。

### Google ログインの設定

初回だけ [Google Cloud Console](https://console.cloud.google.com/) で OAuth クライアントを作ります（無料。請求先アカウントは不要）。

1. プロジェクトを作成し、「Google Auth Platform」→「ブランディング」でアプリ名・サポートメールを設定（対象は「外部」）。スコープは既定の `openid` / `email` だけなので審査は不要です。「対象」でアプリを「本番環境」に公開すると、テストユーザー以外もログインできます
2. 「クライアント」→「クライアントを作成」→ 種類「ウェブ アプリケーション」
   - 承認済みの JavaScript 生成元: `https://battleship.verniyyy.workers.dev`
   - 承認済みのリダイレクト URI: `https://battleship.verniyyy.workers.dev/api/auth/google/callback`（ローカルでも試すなら `http://localhost:8080/api/auth/google/callback` も）
3. 表示されたクライアント ID とシークレット、新しい `SESSION_SECRET` を Vercel に登録して反映

   ```sh
   cd backend
   vercel env add GOOGLE_CLIENT_ID production
   vercel env add GOOGLE_CLIENT_SECRET production --sensitive
   openssl rand -base64 48 | vercel env add SESSION_SECRET production --sensitive
   echo https://battleship.verniyyy.workers.dev | vercel env add PUBLIC_URL production
   cd .. && just deploy
   ```

#### 管理者を登録する

管理者は Google アカウントの `sub`（変わらない ID）で指定します。メールアドレスは使いません。

1. `sub` を調べる。`sub` はアプリによらずアカウントで共通なので、[OAuth 2.0 Playground](https://developers.google.com/oauthplayground) で取れます
   - Step 1 にスコープ `openid email` を入れて「Authorize APIs」を押し、管理者にしたいアカウントでログイン
   - Step 2 で「Exchange authorization code for tokens」
   - Step 3 の Request URI に `https://openidconnect.googleapis.com/v1/userinfo` を入れて送信すると、返ってきた JSON に `sub` がある
2. `google:` を付けて登録し、反映する（複数人ならカンマ区切り）

   ```sh
   cd backend
   echo google:123456789012345678901 | vercel env add ADMIN_SUBJECTS production
   cd .. && just deploy-api
   ```

3. 管理者はログインし直す（それ以前のセッションには `sub` が入っていないため）

外すときは `ADMIN_SUBJECTS` から消して `just deploy-api` します。リストは毎リクエスト確認するので、反映した時点で管理画面に入れなくなります。ローカルの docker compose では、タイトル画面の「開発用ログイン（管理者）」で管理者 `dev:admin` として入れます。

### 機能フラグ

まだ公開しない機能は機能フラグで隠します（今は対人戦の `duels` だけ）。フラグが立っていない機能は、母港の入口とお知らせが表示されず、API も 404 を返します。管理者には常にすべて見えるので、本番で公開前に試せます。どの機能が見えるかは `GET /api/auth/session` の `features` で返ります。

公開するときは `FEATURES` に名前を足して API をデプロイし直します（フロントエンドの再デプロイは不要です。お知らせは公開した時点で未読として表示されます）。

```sh
cd backend
echo duels | vercel env add FEATURES production
cd .. && just deploy-api
```

ローカルの docker compose ではすべて公開済み（`FEATURES=duels`）で起動します。公開前の見え方を確かめるときは `FEATURES= just up` で起動します。

ログインの仕組み: Authorization Code フロー（PKCE・state・nonce 付き）で Google から ID トークンを受け取り、Google の公開鍵で検証して `sub` をアカウントのキーにします（`accounts` テーブル）。セッションは DB を使わない HMAC 署名付き Cookie（30 日、使っていれば自動延長）です。Google アカウントの初回ログインでは、ログイン機能より前にそのブラウザで遊んでいた進行状況を引き継ぎます（ほかのアカウントに引き継がれていない場合のみ）。

## ローカル開発

```sh
# DB だけ起動
docker compose up -d db

# backend
cd backend
DATABASE_URL='postgres://battleship:battleship@localhost:5432/battleship?sslmode=disable' \
  SESSION_SECRET=local-dev-session-secret-not-for-production DEV_LOGIN=1 go run ./cmd/server
go test ./...
# ストアの結合テストは使い捨ての DB を指定したときだけ動く
TEST_DATABASE_URL='postgres://...' go test ./internal/store

# frontend (/api は localhost:8080 の backend にプロキシ。API_URL で変更可)
cd frontend
npm install
npm run dev
```

### CI

GitHub Actions（`.github/workflows/`）が push と PR で、変更のあったディレクトリだけを検査します。

| ワークフロー | 対象 | 内容 |
| --- | --- | --- |
| `backend` | `backend/` | gofmt・`go vet`・`go test -race`（使い捨ての PostgreSQL でストアの結合テストも実行）・Docker イメージのビルド |
| `web` | `frontend/` `edge/` | frontend の型チェックとビルド・Worker の型チェック・Docker イメージのビルド |
| `portraitgen` | `tools/portraitgen/` | CPU での pytest |

デプロイは CI では行いません。キャラ絵（`public/portraits/`）が git 管理外で、Actions からは配信物を組み立てられないためです。
