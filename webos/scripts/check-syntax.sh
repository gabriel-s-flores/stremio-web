#!/usr/bin/env bash
# Syntax gate of the webOS build (pnpm webos:check-syntax): every .js in build-webos/ (page,
# worker, lazy chunks, webOSTV.js) must parse as ES2016, the syntax Chromium 53 runs.
# es-check runs on a copy of the .js files without the .map files: on an error, es-check 9 maps
# the position through `<file>.map`, and its parser takes minutes on the one-line main.js.map.
# Positions in the output are those of build-webos/ (same relative paths).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$ROOT/build-webos"

[[ -d "$BUILD_DIR" ]] || { echo "error: $BUILD_DIR not found, run pnpm webos:build" >&2; exit 1; }
COPY="$(mktemp -d)"
trap 'rm -rf "$COPY"' EXIT
(cd "$BUILD_DIR" && find . -name '*.js' -exec cp --parents {} "$COPY" \;)

cd "$COPY"
"$ROOT/node_modules/.bin/es-check" es2016 './**/*.js' "$@"
