#!/usr/bin/env bash
# Imports the extra UI pack (home-port background, battle cut-in sprites,
# message bands) from a local folder into frontend/public/legacy/ui/.
# Like the legacy assets, the output is git-ignored and must not be committed.
#
#   ./scripts/import-ui-assets.sh "/mnt/truenas/Picture/海戦ゲーム用"
#
# Requires ImageMagick 7 (`magick`). On NixOS: nix shell nixpkgs#imagemagick
set -euo pipefail

SRC=${1:?usage: $0 <asset folder>}
cd "$(git rev-parse --show-toplevel)"
OUT=frontend/public/legacy/ui
mkdir -p "$OUT/fx"

command -v magick >/dev/null || { echo "magick (ImageMagick 7) is required" >&2; exit 1; }

# Backgrounds: downscale the large photos so the page stays light.
magick "$SRC/母港.jpg" -resize '1920x>' -quality 82 "$OUT/home.jpg"
magick "$SRC/battle.jpg" -resize '1920x>' -quality 85 "$OUT/battle.jpg"

# Message bands (already transparent PNGs).
cp "$SRC/mes2_f_hbg.png" "$OUT/band_green.png"
cp "$SRC/mes2_e_hbg.png" "$OUT/band_red.png"
cp "$SRC/mes_bg_f.png" "$OUT/strip_green.png"
cp "$SRC/mes_e_hbg.png" "$OUT/band_red_diag.png"

# Cut-in sprites from battle_main.png: "name WxH+X+Y" (bounding boxes found
# with ImageMagick connected-components; padded below to keep the glow).
SPRITES=(
  "search 430x155+380+244"      # 索敵開始！
  "found 529x160+812+815"       # 敵艦隊発見！
  "sighted 562x160+1558+450"    # 敵艦隊 見ゆ！
  "observe 561x123+1235+258"    # 弾着観測射撃！
  "reticle 137x137+2252+1463"
  "ring 366x366+21+1031"
  "column 181x254+675+1920"     # water column
  "burst 172x126+2049+241"      # small fireball
)
PAD=22
for s in "${SPRITES[@]}"; do
  read -r name geo <<<"$s"
  if [[ $geo =~ ^([0-9]+)x([0-9]+)\+([0-9]+)\+([0-9]+)$ ]]; then
    w=$((BASH_REMATCH[1] + PAD * 2)) h=$((BASH_REMATCH[2] + PAD * 2))
    x=$((BASH_REMATCH[3] - PAD)) y=$((BASH_REMATCH[4] - PAD))
    ((x < 0)) && x=0
    ((y < 0)) && y=0
    # Feather the edges so the glow fades out instead of ending in a hard
    # rectangle, which also hides fragments of neighbouring sprites.
    magick "$SRC/battle_main.png" -crop "${w}x${h}+${x}+${y}" +repage \
      \( -size "${w}x${h}" xc:black -fill white \
         -draw "rectangle 14,14 $((w - 15)),$((h - 15))" -blur 0x6 -alpha copy \) \
      -compose DstIn -composite "$OUT/fx/$name.png"
  fi
done

# The frontend looks for this file to enable the UI pack.
printf '{"version":1}\n' >"$OUT/manifest.json"
echo "imported UI pack into $OUT"
