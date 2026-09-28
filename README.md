# 蒼海戦記 BATTLE SHIP

見えない敵艦隊を索敵して撃沈する海戦ゲームに、艦の収集・育成・キャンペーンを組み合わせたブラウザゲームです。

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `backend/` | Go (標準 `net/http` + `pgx`)。`game`: 戦闘ルールと CPU 思考、`meta`: 艦カード・ガチャ・海域・報酬・任務、`api`: REST API |
| `frontend/` | React + TypeScript + Vite。本番は nginx で配信し `/api` を backend へプロキシ |
| `docker-compose.yml` | PostgreSQL / backend / frontend |

プレイヤーはブラウザが生成した UUID（`X-Player-Id` ヘッダ）で識別し、プロフィールと対局を PostgreSQL に JSONB で保存します（サーバーはステートレス）。決着の一手と報酬の支払いは同じトランザクションで確定します。マイグレーションは backend 起動時に自動適用されます。

## 起動

```sh
docker compose up --build
```

- アプリ: http://localhost:8080
- API: http://localhost:8081 （例: `curl localhost:8081/api/catalog`）
- PostgreSQL: `localhost:5432`（user / password / db はすべて `battleship`）

データを消して最初からやり直す場合は `docker compose down -v`。

効果音と BGM は Web Audio で合成しているので、素材なしでも音が鳴ります。艦カードのアートも SVG で生成しています。

### 旧バージョンの素材を使う（任意）

旧バージョンの画像・BGM は git 履歴に残っており、次のスクリプトでローカルに復元できます。復元すると初期艦 3 隻の立ち絵、背景、録音済み BGM が使われます。

```sh
./scripts/salvage-legacy-assets.sh                     # frontend/public/legacy/ に展開
./scripts/import-ui-assets.sh "/path/to/海戦ゲーム用"   # 母港背景などの UI 素材（ImageMagick 7 が必要）
```

復元先はいずれも `.gitignore` 済みです。第三者の素材を含むため **コミットしないでください**。

### キャラ絵を生成する（任意・無料）

立ち絵のない艦カードに、AI で生成したキャラ絵を補充できます。生成した絵は艦カード・母港の秘書艦・カットイン・マップ上の駒に使われます（旧素材がある初期 3 隻はそちらを優先）。

GPU は [Google Colab](https://colab.research.google.com) の無料枠（T4）を使い、Hugging Face のアニメ系 SDXL モデル（既定: [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0)）で生成します。手元に必要なのは Go だけです。

1. プロンプトを書き出す（カタログの艦種・レアリティ・カード色と、`backend/cmd/portraits/main.go` の `cardMotif` から Danbooru タグ形式で組み立て）

   ```sh
   cd backend && go run ./cmd/portraits prompts        # -> .cache/portraits/prompts.json
   ```

2. [`scripts/portraits_colab.ipynb`](scripts/portraits_colab.ipynb) を Colab で開き（ファイル → ノートブックをアップロード）、ランタイムを **T4 GPU** にして上から実行。`prompts.json` をアップロードすると、カードごとに候補を数枚生成して並べて表示します
3. 気に入った候補を `PICKS` で選んで最後のセルを実行すると、背景を切り抜いた（rembg `isnet-anime`）`portraits.zip` がダウンロードされる
4. 取り込む（`frontend/public/portraits/` に展開し、フロントが自動検出する `manifest.json` を更新）

   ```sh
   cd backend && go run ./cmd/portraits import ~/Downloads/portraits.zip
   ```

T4 では 1 枚およそ 40 秒です。気に入らないカードはノートブックの `ONLY` / `SEED_OFFSET` で引き直せます。モデルは `MODEL_ID` で他の SDXL 系（Illustrious 系など）に差し替え可能です。生成物は `.gitignore` 済みです。自作の絵を `frontend/public/portraits/<カード ID>.png`（背景透過）に置いた場合は、`go run ./cmd/portraits import`（zip なし）で manifest だけ更新できます。

## ゲームの流れ

1. **母港** — 秘書艦、ログインボーナス（7 日周期）、通知バッジ、連勝数と艦隊戦力
2. **出撃** — 4 海域 × 4 ステージのキャンペーン。各ステージに ★3 つ（勝利／規定ターン内／損失なし）。4-4 を突破すると無限海域（5 層ごとに旗艦）が解放
3. **出撃準備** — 編成した艦隊を海域に配置
4. **戦闘** — 下記ルール。カットインはタップでスキップ、演出速度 ×1〜×3、「撤退」しても母港から再開可能
5. **戦果報告** — 評価 S〜E、★、報酬の内訳（評価・連勝・コンボ・会心ボーナス）、提督と艦の経験値、ドロップ、3 つから 1 つ選ぶ宝箱
6. **建造** — 1 回 💎100 / 10 連 💎1000（SR 以上 1 枠確定、初回無料）。60 回以内に SSR 以上確定。同じ艦は限界突破
7. **艦隊 / 編成 / 任務** — 資金で強化、図鑑、デイリー任務と勲功（実績）

## 戦闘ルール

- 両軍は同じ N×N（5〜7）の海域に潜む。毎ターン 1 隻を選び、次のいずれかを行う
  - **砲撃**: 周囲 8 マスのどこか（主砲 1 消費）
  - **移動**: 縦横に何マスでも。艦・方角・距離が相手に通知される（潜水艦は潜航して秘匿）
  - **スキル**（回数制）: 戦艦「一斉射」十字 5 マス／巡洋艦「照明弾」3×3 の水上艦を発見／駆逐艦「ソナー」縦横一列の全艦を発見／潜水艦「魚雷」直進して 2 ダメージ／空母「航空攻撃」全域の 1 マス
  - **全艦斉射**: 決戦ゲージ満タンで 3×3 を砲撃
- 着弾は「命中（会心・回避あり）」「水しぶき（周囲に水上艦）」「外れ」で通知。命中・発見した敵は以後の移動も追跡される
- 命中を続けるとコンボでゲージが加速。被弾でもゲージが溜まる
- 全艦撃沈、または攻撃手段が尽きた側の負け。ターン制限では残り耐久の割合で判定（同率は防衛側の CPU 勝ち）

艦カード・敵・海域・報酬の数値は `backend/internal/meta/catalog.go` で調整できます。

## API

`/api/catalog` 以外はすべて `X-Player-Id: <UUID>` ヘッダが必要です。

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/catalog` | 艦カード・敵・海域・ガチャ・任務などの静的データ |
| GET | `/api/profile` | プロフィール（初回アクセスで作成） |
| POST | `/api/profile/login` | ログインボーナス受取 |
| POST | `/api/profile/fleet` | 編成 `{"uids":["s1","s2"]}` |
| POST | `/api/profile/secretary` | 秘書艦 `{"uid":"s1"}` |
| POST | `/api/ships/{uid}/train` | 資金で 1 レベル強化 |
| POST | `/api/gacha` | 建造 `{"count":1\|10}` |
| POST | `/api/missions/{id}/claim` | デイリー任務の報酬受取 |
| POST | `/api/achievements/{id}/claim` | 勲功の報酬受取 |
| POST | `/api/games` | 出撃 `{"stageId":"1-1","placements":[{"row":0,"col":0}, ...]}`（添字 = 編成順） |
| GET | `/api/games/{id}` | 対局状態（敵艦の位置は索敵済みのものだけ） |
| POST | `/api/games/{id}/actions` | 行動 `{"type":"attack"\|"move"\|"skill"\|"ultimate","shipId":0,"target":{"row":1,"col":1}}`。CPU の応手、決着時は報酬も返る |
| POST | `/api/games/{id}/chest` | 宝箱を開ける `{"index":0}` |
| GET | `/api/games?limit=20` | 終了した対局の一覧 |

## ローカル開発

```sh
# DB だけ起動
docker compose up -d db

# backend
cd backend
DATABASE_URL='postgres://battleship:battleship@localhost:5432/battleship?sslmode=disable' go run ./cmd/server
go test ./...
# ストアの結合テストは使い捨ての DB を指定したときだけ動く
TEST_DATABASE_URL='postgres://...' go test ./internal/store

# frontend (/api は localhost:8080 の backend にプロキシ。API_URL で変更可)
cd frontend
npm install
npm run dev
```

旧バージョン（Spring Boot + JRuby）のデモ動画: `demo.mp4`
