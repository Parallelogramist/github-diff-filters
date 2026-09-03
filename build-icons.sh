#!/usr/bin/env bash
# Rasterise icon.svg to the PNG sizes Chrome's manifest asks for.
# Chrome's "icons" key takes raster images only, so the SVG is the source and
# these are build output.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/extension/icons"
mkdir -p "$OUT"
for size in 16 32 48 128; do
    rsvg-convert --width "$size" --height "$size" \
        --output "$OUT/icon-$size.png" "$HERE/icon.svg"
    printf "  icon-%s.png  %s\n" "$size" "$(sips -g pixelWidth -g pixelHeight "$OUT/icon-$size.png" | awk '/pixel/{printf "%s ", $2}')"
done
