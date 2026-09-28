#!/usr/bin/env bash
# Restores the legacy (pre-rewrite) game assets from git history into
# frontend/public/legacy/. That directory is git-ignored on purpose: the
# assets are third-party material and must not be committed again.
# The frontend detects them at runtime and falls back to built-in visuals when absent.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
OUT=frontend/public/legacy
OLD=src/main/resources/static

# "old path in history" -> "path under $OUT"
ASSETS=(
  "images/titleImage2.png:img/title.png"
  "images/standBy.jpg:img/standby.jpg"
  "images/battle.jpg:img/battle.jpg"
  "images/result.jpg:img/result.jpg"
  "images/message/battle_start.png:img/battle_start.png"
  "images/char/gekitin.png:img/sunk.png"
  "images/effect/explosion.png:img/explosion.png"
  "images/char/kirishima.png:img/ship/battleship.png"
  "images/char/kirishima_b.png:img/ship/battleship_b.png"
  "images/char/kirishima_c.png:img/ship/battleship_c.png"
  "images/char/kirishima_d.png:img/ship/battleship_d.png"
  "images/char/bep.png:img/ship/destroyer.png"
  "images/char/bep_b.png:img/ship/destroyer_b.png"
  "images/char/bep_c.png:img/ship/destroyer_c.png"
  "images/char/bep_d.png:img/ship/destroyer_d.png"
  "images/char/i168.png:img/ship/submarine.png"
  "images/char/i168_b.png:img/ship/submarine_b.png"
  "images/char/i168_c.png:img/ship/submarine_c.png"
  "images/char/i168_d.png:img/ship/submarine_d.png"
  "images/char/1501_b.png:img/ship/enemy_b.png"
  "images/char/1501_c.png:img/ship/enemy_c.png"
  "music/title.mp3:bgm/title.mp3"
  "music/battleBGM1.mp3:bgm/battle.mp3"
  "music/bep_t1.mp3:voice/1.mp3"
  "music/bep_t2.mp3:voice/2.mp3"
  "music/bep_t3.mp3:voice/3.mp3"
  "SE/click1.mp3:se/click.mp3"
  "SE/shu.mp3:se/launch.mp3"
  "SE/bu-n.mp3:se/move.mp3"
  "SE/explosion1.mp3:se/explosion1.mp3"
  "SE/explosion2.mp3:se/explosion2.mp3"
  "SE/explosion3.mp3:se/explosion3.mp3"
)

restored=0
for entry in "${ASSETS[@]}"; do
  src="$OLD/${entry%%:*}"
  dst="$OUT/${entry#*:}"
  # Last commit that touched the file; if it deleted the file, read it from the parent.
  rev=$(git rev-list -1 HEAD -- "$src")
  if [[ -z "$rev" ]]; then
    echo "skip: $src not found in history" >&2
    continue
  fi
  git cat-file -e "$rev:$src" 2>/dev/null || rev="$rev^"
  mkdir -p "$(dirname "$dst")"
  git show "$rev:$src" > "$dst"
  restored=$((restored + 1))
done

# The frontend looks for this file to decide whether to use the legacy theme.
printf '{"version":1}\n' > "$OUT/manifest.json"
echo "restored $restored/${#ASSETS[@]} assets into $OUT"
