#!/usr/bin/env bash
# Grava as fixtures que só existem na suíte FATE do FFmpeg (DV Profile 7). A FATE não tem licença
# de redistribuição, então os bytes ficam fora do git (__fixtures__/.gitignore). O script baixa cada
# amostra, confere o sha256 do arquivo original e grava a fixture com tools/probe.mjs --record.
# Sem estas fixtures, os testes correspondentes são pulados com aviso.
#   webos/lib/header-probe/tools/fetch-fate-fixtures.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

record() {
    local id="$1" url="$2" sha="$3" block="$4" file="$TMP/${2##*/}"
    curl -sSf -o "$file" "$url"
    if ! echo "$sha  $file" | sha256sum -c --quiet; then
        echo "erro: sha256 diferente para $url" >&2
        exit 1
    fi
    node "$HERE/probe.mjs" "$file" --record "$id" --block-size "$block" --source "$url" > /dev/null
}

# DV Profile 7 em MKV: faixa única com BL + EL (dvcC + hvcE no BlockAdditionMapping).
record fate-dv-p7-mkv https://fate-suite.ffmpeg.org/mkv/dovi-p7-hvce.mkv \
    3287bac8deade11e1c57bd65b9c7c8750a1e38e286666cbb4fa39eac264875df 32768
# DV Profile 7 em MP4 dual-track: BL e EL em faixas separadas, moov no fim.
record fate-dv-p7-dual-mp4 https://fate-suite.ffmpeg.org/mov/dovi-p7.mp4 \
    7e4b69c90f8b1ec8a284d2610ab465fded5751f34a50e56129bcf152d8943c79 32768
