#!/usr/bin/env bash
# SCRIPT-ONLY (bytes NAO versionados): demo musical Dolby Atmos (TrueHD+Atmos em Matroska), conteudo Dolby
# Baixa os primeiros 2097152 bytes (Range: bytes=0-2097151) de:
#   https://samples.ffmpeg.org/ffmpeg-bugs/trac/ticket7988/Dolby%20Atmos%20Music%20Demo.mka
# e confere o sha256 do recorte. Dados nao confiaveis: nao execute o arquivo.
# Uso: fetch-truehd-atmos-dolby-music-demo.sh [OUTDIR]   (padrao: mktemp -d)
set -euo pipefail
OUT="${1:-$(mktemp -d /tmp/f010-scriptonly.XXXXXX)}"
mkdir -p "$OUT"
URL='https://samples.ffmpeg.org/ffmpeg-bugs/trac/ticket7988/Dolby%20Atmos%20Music%20Demo.mka'
curl -fsS --proto '=https' --max-time 300 -H 'Range: bytes=0-2097151' "$URL" -o "$OUT/truehd-atmos-dolby-music-demo-head2m.mka"
GOT="$(sha256sum "$OUT/truehd-atmos-dolby-music-demo-head2m.mka" | cut -d' ' -f1)"
echo "$GOT  $OUT/truehd-atmos-dolby-music-demo-head2m.mka"
if [ "$GOT" = "755e593a0d42fc72a9d1e9d8bb8e47980fe6b6d91c54feeadb82919706e108eb" ]; then echo OK; else echo "FAIL: esperado 755e593a0d42fc72a9d1e9d8bb8e47980fe6b6d91c54feeadb82919706e108eb" >&2; exit 1; fi
