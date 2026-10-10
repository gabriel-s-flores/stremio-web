#!/usr/bin/env bash
# Packages, installs and launches the webOS build (pnpm webos:package | webos:install | webos:launch).
#   ares.sh package    build-webos/ + the tlsproxy service (webos/tlsproxy/service/) ->
#                      dist-webos/<id>_<version>_all.ipk (as built: no re-minify, source maps left out)
#   ares.sh install    installs that IPK on the device
#   ares.sh launch     opens the app on the device
# Device: $WEBOS_DEVICE, else $EMU_DEVICE (set by webos/tools/emu-run). There is no default:
# "emulator" is instance 0 of the pool and may be reserved by someone else.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$ROOT/build-webos"
SERVICE_DIR="$ROOT/webos/tlsproxy/service"
DIST_DIR="$ROOT/dist-webos"
DEVICE="${WEBOS_DEVICE:-${EMU_DEVICE:-}}"

[[ -f "$BUILD_DIR/appinfo.json" ]] || { echo "error: $BUILD_DIR/appinfo.json not found, run pnpm webos:build" >&2; exit 1; }
appinfo() { node -p "require('$BUILD_DIR/appinfo.json').$1"; }
APP_ID="$(appinfo id)"
IPK="$DIST_DIR/${APP_ID}_$(appinfo version)_all.ipk"
require_device() {
    [[ -n "$DEVICE" ]] || { echo "error: no device, run inside webos/tools/emu-run or set WEBOS_DEVICE" >&2; exit 1; }
}

case "${1:-}" in
    package)
        rm -rf "$DIST_DIR"
        # The service runs as is on Node 0.12 (no Babel): ES5, ca.js from certs/, id prefixed by the app id.
        node "$ROOT/webos/scripts/check-service.js"
        # --no-minify: ares-package runs terser on every .js by default; the bundle is already
        # minified by webpack and must match build-webos/ (source maps, syntax checks, webOSTV.js).
        ares-package --no-minify --app-exclude '*.map' --outdir "$DIST_DIR" "$BUILD_DIR" "$SERVICE_DIR"
        ls -l "$IPK"
        ;;
    install)
        require_device
        [[ -f "$IPK" ]] || { echo "error: $IPK not found, run pnpm webos:package" >&2; exit 1; }
        ares-install --device "$DEVICE" "$IPK"
        ;;
    launch)
        require_device
        ares-launch --device "$DEVICE" "$APP_ID"
        ;;
    *)
        echo "usage: ares.sh package|install|launch" >&2
        exit 1
        ;;
esac
