# battle_ship

海戦ゲーム（潜水艦ゲーム）をモチーフにしたブラウザゲームです。5×5 の海域に自艦隊 3 隻を配置し、CPU の艦隊を索敵・撃沈します。

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `backend/` | Go (標準 `net/http` + `pgx`)。ゲームロジック・CPU 思考・REST API |
| `frontend/` | React + TypeScript + Vite。本番は nginx で配信し `/api` を backend へプロキシ |
| `docker-compose.yml` | PostgreSQL / backend / frontend |

ゲーム状態は PostgreSQL の `games` テーブルに JSONB で保存されます（サーバーはステートレス）。マイグレーションは backend 起動時に自動適用されます。

## 起動

```sh
docker compose up --build
```

- アプリ: http://localhost:8080
- API: http://localhost:8081 （例: `curl localhost:8081/api/stats`）
- PostgreSQL: `localhost:5432`（user / password / db はすべて `battleship`）

データを消して最初からやり直す場合は `docker compose down -v`。

### 旧バージョンの素材を使う（任意）

旧バージョンで使っていた画像・BGM・SE は git 履歴に残っており、次のスクリプトでローカルに復元できます。

```sh
./scripts/salvage-legacy-assets.sh   # frontend/public/legacy/ に展開
docker compose up --build
```

さらに母港背景・戦闘カットイン・メッセージ帯などの UI 素材を手元のフォルダから取り込めます（ImageMagick 7 の `magick` が必要。NixOS なら `nix shell nixpkgs#imagemagick`）。

```sh
./scripts/import-ui-assets.sh "/path/to/海戦ゲーム用"   # frontend/public/legacy/ui/ に展開
```

復元先・取り込み先はいずれも `.gitignore` 済みです。第三者の素材を含むため **コミットしないでください**。素材が無い場合は、それぞれ CSS で描いた代替表示で動作します。

## 画面構成

画面は 1280×720 の固定ステージを、ウィンドウに合わせて拡大縮小して表示します。

1. **タイトル** — タップで開始（ブラウザの音声再生もここで許可されます）
2. **母港** — 秘書艦（タップで台詞）、戦績・作戦要綱・秘書艦変更、出撃／再開
3. **出撃準備** — 艦を選んで海域に配置（おまかせ配置あり）
4. **戦闘** — 艦を選び「砲撃／移動」→ マスを選んで決定（同じマスをもう一度タップでも決定）。カットイン演出はタップでスキップ、右上で 2 倍速、「撤退」で母港へ戻っても対局は再開できます
5. **戦果報告** — S〜E の戦闘評価と MVP

## ルール

- 各艦は毎ターン「攻撃」（周囲 8 マスのいずれかを砲撃・主砲 1 消費）か「移動」（縦横に任意マス）のどちらかを行う
- 砲撃結果は「命中」「水しぶき（着弾点の周囲 8 マスに敵艦あり）」「外れ」で通知される
- 移動は「艦・方角・距離」が相手に通知される
- 全艦が撃沈または弾切れになった側の負け

艦のステータスは `backend/internal/game/game.go` の `Fleet` で調整できます。

## API

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/fleet` | 盤面サイズと艦のステータス |
| POST | `/api/games` | 新規対局 `{"placements":[{"row":0,"col":0}, ...]}`（添字 = 艦 ID） |
| GET | `/api/games/{id}` | 対局状態（対局中は敵艦の位置を隠す） |
| POST | `/api/games/{id}/actions` | 行動 `{"type":"attack"\|"move","shipId":0,"target":{"row":1,"col":1}}`。CPU の応手も返る |
| GET | `/api/games?limit=20` | 終了した対局の一覧 |
| GET | `/api/stats` | 勝敗集計 |

## ローカル開発

```sh
# DB だけ起動
docker compose up -d db

# backend
cd backend
DATABASE_URL='postgres://battleship:battleship@localhost:5432/battleship?sslmode=disable' go run ./cmd/server
go test ./...

# frontend (/api は localhost:8080 の backend にプロキシ)
cd frontend
npm install
npm run dev
```

旧バージョン（Spring Boot + JRuby）のデモ動画: `demo.mp4`
