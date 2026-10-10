#!/usr/bin/env bash
# Syntax gate of the webOS build (pnpm webos:check-syntax): every .js in build-webos/ (page,
# worker, lazy chunks, webOSTV.js, the wasm2js core) must parse as ES2016, the syntax Chromium 53
# runs. First, webos/scripts/check-core.js checks that the core files next to worker.js are the
# vendored ones, byte for byte, and that the wasm2js keeps its eager factory parentheses.
# es-check runs on a copy of the .js files without the .map files: on an error, es-check 9 maps
# the position through `<file>.map`, and its parser takes minutes on the one-line main.js.map.
# Positions in the output are those of build-webos/ (same relative paths).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$ROOT/build-webos"

[[ -d "$BUILD_DIR" ]] || { echo "error: $BUILD_DIR not found, run pnpm webos:build" >&2; exit 1; }
node "$ROOT/webos/scripts/check-core.js" "$BUILD_DIR"

COPY="$(mktemp -d)"
trap 'rm -rf "$COPY"' EXIT
(cd "$BUILD_DIR" && find . -name '*.js' -exec cp --parents {} "$COPY" \;)

cd "$COPY"
"$ROOT/node_modules/.bin/es-check" es2016 './**/*.js' "$@"
