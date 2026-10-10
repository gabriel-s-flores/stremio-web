#!/usr/bin/env bash
# SCRIPT-ONLY (bytes NAO versionados): trailer demo LG Dolby Vision (extensao .mkv, mas e MPEG-TS; dv_profile 4 + E-AC-3)
# Baixa os primeiros 2097152 bytes (Range: bytes=0-2097151) de:
#   https://samples.ffmpeg.org/ffmpeg-bugs/trac/ticket5688/LG%20Demo%20DolbyVision%20Trailer.mkv
# e confere o sha256 do recorte. Dados nao confiaveis: nao execute o arquivo.
# Uso: fetch-dv-p4-lg-demo-trailer.sh [OUTDIR]   (padrao: mktemp -d)
set -euo pipefail
OUT="${1:-$(mktemp -d /tmp/f010-scriptonly.XXXXXX)}"
mkdir -p "$OUT"
URL='https://samples.ffmpeg.org/ffmpeg-bugs/trac/ticket5688/LG%20Demo%20DolbyVision%20Trailer.mkv'
curl -fsS --proto '=https' --max-time 300 -H 'Range: bytes=0-2097151' "$URL" -o "$OUT/dv-p4-lg-demo-trailer-head2m.ts"
GOT="$(sha256sum "$OUT/dv-p4-lg-demo-trailer-head2m.ts" | cut -d' ' -f1)"
echo "$GOT  $OUT/dv-p4-lg-demo-trailer-head2m.ts"
if [ "$GOT" = "55e17c4a0c42abb52f955261e7e11bff48756d3eb8ac447595be3b41d22b72ca" ]; then echo OK; else echo "FAIL: esperado 55e17c4a0c42abb52f955261e7e11bff48756d3eb8ac447595be3b41d22b72ca" >&2; exit 1; fi
