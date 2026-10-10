#!/usr/bin/env bash
# F3.1 check in the emulator: the packaged app resolves Platform.name = 'webOS' and reads the TV
# capabilities through Luna. Run inside a pool reservation, after `pnpm webos:package`:
#   webos/tools/emu-run --timeout 15 -- webos/tests/platform/emulator.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: emulator.sh <output-dir>}"
mkdir -p "$OUT"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")

cd "$ROOT"
pnpm webos:install
pnpm webos:launch

state=''
for _ in $(seq 1 60); do
    sleep 2
    state="$("${CDP[@]}" eval 'JSON.stringify(window.__webos || null)' 2>/dev/null || true)"
    # capabilities are set once the Luna reads settle
    if [[ "$state" == *'"available"'* ]]; then break; fi
done
echo "$state" > "$OUT/webos-state.json"
"${CDP[@]}" eval 'JSON.stringify({ userAgent: navigator.userAgent, hasWebOS: typeof window.webOS, libVersion: window.webOS && window.webOS.libVersion, webOSPlatform: window.webOS && window.webOS.platform, title: document.title })' > "$OUT/page.json"
"${CDP[@]}" screenshot "$OUT/tela.png" || true
cat "$OUT/webos-state.json" "$OUT/page.json"
[[ "$state" == *'"platform":"webOS"'* && "$state" == *'"available":true'* ]]
