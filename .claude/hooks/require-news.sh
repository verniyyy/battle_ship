#!/usr/bin/env bash
# PreToolUse hook for Bash: blocks `gh pr create` when the branch changes
# player-facing code but leaves frontend/src/news.ts alone. Write
# [no-news] in the PR body (or title) when the change isn't worth a notice.
set -euo pipefail

cmd=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))')
[[ $cmd == *"gh pr create"* ]] || exit 0
[[ $cmd == *"[no-news]"* ]] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}"
base=$(git merge-base origin/main HEAD 2>/dev/null) || exit 0
changed=$(git diff --name-only "$base")

grep -qx 'frontend/src/news.ts' <<<"$changed" && exit 0
player=$(grep -E '^(frontend/src/|frontend/public/|frontend/index\.html|backend/internal/(game|meta|api)/)' <<<"$changed" | grep -vE '_test\.go$' || true)
[[ -z $player ]] && exit 0

cat >&2 <<MSG
プレイヤー向けのコードが変わっていますが、frontend/src/news.ts にお知らせが追加されていません。
変更されたファイル:
$(sed 's/^/  - /' <<<"$player")
プレイヤーが気づく変更なら、CLAUDE.md のルールに沿って NEWS の先頭に項目を足し、コミットしてから PR を作り直してください。
お知らせが不要な変更（リファクタリング・テスト・内部の修正だけなど）なら、PR 本文に [no-news] と理由を書いて作り直してください。
MSG
exit 2
