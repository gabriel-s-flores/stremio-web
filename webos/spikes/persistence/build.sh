#!/usr/bin/env bash
# Empacota a sonda de persistência.
#   build.sh <versão> <id-do-app> <pasta-de-saída> [probe|mirror]
# Ex.: build.sh 1.0.0 io.github.gabrielsflores.persistprobe /tmp/out
# O IPK sai como <id>_<versão>_all.ipk. Só a versão, o id e o modo mudam entre as variantes
# (modo mirror: a página não roda a sonda e deixa o localStorage limpo para o teste do mirror.js).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="${1:?versão}"; APP_ID="${2:?id do app}"; OUT="${3:?pasta de saída}"; MODE="${4:-probe}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -r "$HERE/app/." "$STAGE/"
sed -i "s/__APP_ID__/$APP_ID/g; s/__VERSION__/$VERSION/g" "$STAGE/appinfo.json"
printf 'window.PERSIST_VERSION = "%s";\nwindow.PERSIST_APP_ID = "%s";\nwindow.PERSIST_MODE = "%s";\n' "$VERSION" "$APP_ID" "$MODE" > "$STAGE/version.js"
mkdir -p "$OUT"
ares-package "$STAGE" -o "$OUT" >/dev/null
ls "$OUT"/"${APP_ID}_${VERSION}"_*.ipk
