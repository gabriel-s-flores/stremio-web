#!/usr/bin/env bash
# SCRIPT-ONLY (bytes NAO versionados): trecho de filme comercial (Final Fantasy VII Advent Children), TrueHD 5.1 em MKV
# Baixa os primeiros 2097152 bytes (Range: bytes=0-2097151) de:
#   https://samples.ffmpeg.org/A-codecs/TrueHD/TrueHD%20Sample%201%20(Final%20Fantasy%20VII%20Advent%20Children).mkv
# e confere o sha256 do recorte. Dados nao confiaveis: nao execute o arquivo.
# Uso: fetch-truehd-5.1-ffvii-advent-children.sh [OUTDIR]   (padrao: mktemp -d)
set -euo pipefail
OUT="${1:-$(mktemp -d /tmp/f010-scriptonly.XXXXXX)}"
mkdir -p "$OUT"
URL='https://samples.ffmpeg.org/A-codecs/TrueHD/TrueHD%20Sample%201%20(Final%20Fantasy%20VII%20Advent%20Children).mkv'
curl -fsS --proto '=https' --max-time 300 -H 'Range: bytes=0-2097151' "$URL" -o "$OUT/truehd-5.1-ffvii-advent-children-head2m.mkv"
GOT="$(sha256sum "$OUT/truehd-5.1-ffvii-advent-children-head2m.mkv" | cut -d' ' -f1)"
echo "$GOT  $OUT/truehd-5.1-ffvii-advent-children-head2m.mkv"
if [ "$GOT" = "d58f488627c14b0742e1182f7b2dba4ad78cb672b5b0be00cb7277451735b999" ]; then echo OK; else echo "FAIL: esperado d58f488627c14b0742e1182f7b2dba4ad78cb672b5b0be00cb7277451735b999" >&2; exit 1; fi
