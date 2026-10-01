#!/usr/bin/env bash
# Cuts the title logo's fonts (the key-visual look of scripts/kv.css) down to the
# glyphs the title screen uses, into frontend/src/fonts/. Rerun after changing the
# title copy in frontend/src/screens/Title.tsx. Both fonts are under the SIL OFL 1.1.
set -euo pipefail
cd "$(dirname "$0")/.."

# Every character the title logo draws in each font.
MINCHO_TEXT='蒼海戦記見えざる艦隊を、撃滅せよ。―'
CINZEL_TEXT='ABCDEFGHIJKLMNOPQRSTUVWXYZ ×'

SRC=https://raw.githubusercontent.com/google/fonts/main/ofl
OUT=frontend/src/fonts
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

curl -fsSL -o "$TMP/mincho-800.ttf" "$SRC/shipporiminchob1/ShipporiMinchoB1-ExtraBold.ttf"
curl -fsSL -o "$TMP/mincho-600.ttf" "$SRC/shipporiminchob1/ShipporiMinchoB1-SemiBold.ttf"
curl -fsSL -o "$TMP/cinzel-var.ttf" "$SRC/cinzel/Cinzel%5Bwght%5D.ttf"
curl -fsSL -o "$OUT/OFL-ShipporiMinchoB1.txt" "$SRC/shipporiminchob1/OFL.txt"
curl -fsSL -o "$OUT/OFL-Cinzel.txt" "$SRC/cinzel/OFL.txt"

ft() { uv run --quiet --no-project --with fonttools --with brotli fonttools "$@"; }
ft varLib.instancer "$TMP/cinzel-var.ttf" wght=700 -o "$TMP/cinzel-700.ttf"
subset() { ft subset "$1" --text="$2" --flavor=woff2 --layout-features='*' --output-file="$3"; }
subset "$TMP/mincho-800.ttf" "$MINCHO_TEXT" "$OUT/title-mincho-800.woff2"
subset "$TMP/mincho-600.ttf" "$MINCHO_TEXT" "$OUT/title-mincho-600.woff2"
subset "$TMP/cinzel-700.ttf" "$CINZEL_TEXT" "$OUT/title-cinzel-700.woff2"
ls -l "$OUT"
