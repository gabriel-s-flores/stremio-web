#!/usr/bin/env bash
# Packages, installs and launches the webOS build (pnpm webos:package | webos:install | webos:launch).
#   ares.sh package    build-webos/ -> dist-webos/<id>_<version>_all.ipk (source maps left out)
#   ares.sh install    installs that IPK on the device
#   ares.sh launch     opens the app on the device
# Device: $WEBOS_DEVICE, else $EMU_DEVICE (set by webos/tools/emu-run), else "emulator".
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$ROOT/build-webos"
DIST_DIR="$ROOT/dist-webos"
DEVICE="${WEBOS_DEVICE:-${EMU_DEVICE:-emulator}}"

[[ -f "$BUILD_DIR/appinfo.json" ]] || { echo "error: $BUILD_DIR/appinfo.json not found, run pnpm webos:build" >&2; exit 1; }
appinfo() { node -p "require('$BUILD_DIR/appinfo.json').$1"; }
APP_ID="$(appinfo id)"
IPK="$DIST_DIR/${APP_ID}_$(appinfo version)_all.ipk"

case "${1:-}" in
    package)
        rm -rf "$DIST_DIR"
        ares-package --app-exclude '*.map' --outdir "$DIST_DIR" "$BUILD_DIR"
        ls -l "$IPK"
        ;;
    install)
        [[ -f "$IPK" ]] || { echo "error: $IPK not found, run pnpm webos:package" >&2; exit 1; }
        ares-install --device "$DEVICE" "$IPK"
        ;;
    launch)
        ares-launch --device "$DEVICE" "$APP_ID"
        ;;
    *)
        echo "usage: ares.sh package|install|launch" >&2
        exit 1
        ;;
esac
