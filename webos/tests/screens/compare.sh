#!/usr/bin/env bash
# Side by side captures of webos/tests/screens/run, one image per scene, labeled by folder:
#   webos/tests/screens/compare.sh <output folder> <label>=<capture folder> [<label>=<capture folder>...]
# e.g. compare.sh evidencias/comparacao antes=out/antes depois=out/depois desktop=out/desktop
# Each capture is scaled to 960x540; a scene missing in a folder is left blank. Needs ImageMagick 7.
set -euo pipefail
OUT="$(realpath -m "${1:?usage: compare.sh <output folder> <label>=<folder>...}")"
shift
(( $# >= 2 )) || { echo "usage: compare.sh <output folder> <label>=<folder> <label>=<folder>..." >&2; exit 2; }
mkdir -p "$OUT"
BLANK="$(mktemp --suffix=.png)"
trap 'rm -f "$BLANK"' EXIT
magick -size 1920x1080 'xc:#202020' "$BLANK"
scenes="$(for pair in "$@"; do ls "${pair#*=}"/*.png 2>/dev/null | xargs -rn1 basename; done | sort -u)"
for scene in $scenes; do
    tiles=()
    for pair in "$@"; do
        file="${pair#*=}/$scene"
        [[ -f "$file" ]] || file="$BLANK"
        tiles+=(-label "${pair%%=*}: ${scene%.png}" "$file")
    done
    magick montage "${tiles[@]}" -tile "$#x1" -geometry 960x540+6+6 -background '#101010' -fill white \
        -pointsize 22 "$OUT/$scene"
    echo "$OUT/$scene"
done
