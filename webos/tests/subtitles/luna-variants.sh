#!/usr/bin/env bash
# F5.5 experiment in the emulator, after luna-probe.sh drew nothing: other orders of the Luna calls
# (selectTrack before setSubtitleEnable, a seek and a pause/play after turning them on), VM
# screenshots after each, and a look (SSH) for subtitle components in the emulator's media stack.
#   webos/tools/emu-run --timeout 15 -- webos/tests/subtitles/luna-variants.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: luna-variants.sh <output-dir>}"
FILE="${FILE:-t8_subs.mkv}"
MEDIA_DIR="${MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/suite}"
PROBE_IPK="$HOME/webos-tv-sdk/probe/out/io.github.gabrielsflores.webosprobe_1.0.0_all.ipk"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
EMU=("$ROOT/webos/tools/emulator-qemu.sh" -i "$EMU_INSTANCE")
SSH=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o HostKeyAlgorithms=+ssh-rsa
    -o PubkeyAcceptedAlgorithms=+ssh-rsa -i "$HOME/webos-tv-sdk/run/ares_webos_emul" -p "$EMU_SSH_PORT" developer@127.0.0.1)
cdp_eval() { "${CDP[@]}" eval "$1"; }
shot() { "${EMU[@]}" screenshot "$OUT/vm-$1.png" >/dev/null 2>&1 || true; }

"${SSH[@]}" 'ps w 2>/dev/null | grep -i -E "starfish|media|ums|subtit" | grep -v grep; echo ===; ls /usr/lib /usr/lib/gstreamer-1.0 2>/dev/null | grep -i -E "sub|caption|ttml|smi" ; echo ===; find / -xdev \( -iname "*subtitle*" -o -iname "*caption*" \) 2>/dev/null | head -50' > "$OUT/sistema.txt" 2>&1 || true

PORT="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
node "$ROOT/webos/tools/media-server.mjs" "$MEDIA_DIR" "$PORT" > "$OUT/media-server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
URL="http://10.0.2.2:$PORT/redirect/$FILE"

ares-install -d "$EMU_DEVICE" "$PROBE_IPK" >/dev/null
ares-launch -d "$EMU_DEVICE" io.github.gabrielsflores.webosprobe >/dev/null
for _ in $(seq 1 30); do
    sleep 2
    cdp_eval "typeof window.probeLuna" 2>/dev/null | grep -q function && break
done
cdp_eval "(function(){
    var s = window.__f55 = { log: [] };
    var v = document.getElementById('v');
    v.style.display = 'block';
    v.style.position = 'fixed'; v.style.left = '0'; v.style.top = '0'; v.style.width = '100%'; v.style.height = '100%';
    s.call = function(method, parameters) {
        var entry = { t: Date.now(), method: method, parameters: parameters, result: null };
        s.log.push(entry);
        window.probeLuna('luna://com.webos.media/' + method, parameters, function(r) { entry.result = r; });
    };
    v.src = '$URL';
    v.play();
    return 'playing';
})()"
for _ in $(seq 1 60); do
    sleep 1
    cdp_eval "(function(){ var v = document.getElementById('v'); return v.readyState >= 3 && v.currentTime > 0.5; })()" | grep -q true && break
done
call() { cdp_eval "(function(){ var v = document.getElementById('v'); window.__f55.call('$1', Object.assign({ mediaId: v.mediaId }, $2)); return true; })()" >/dev/null; }

call selectTrack "{ type: 'text', index: 1 }"
sleep 1
call setSubtitleEnable '{ enable: true }'
sleep 2; shot 1-select-depois-enable-a; sleep 1; shot 1-select-depois-enable-b
cdp_eval "document.getElementById('v').currentTime = 3" >/dev/null
sleep 3; shot 2-depois-do-seek-a; sleep 1; shot 2-depois-do-seek-b
cdp_eval "document.getElementById('v').pause()" >/dev/null; sleep 1
cdp_eval "document.getElementById('v').play()" >/dev/null
sleep 2; shot 3-pause-play-a; sleep 1; shot 3-pause-play-b
call selectTrack "{ type: 'text', index: 0 }"
sleep 2; shot 4-indice-0-a; sleep 1; shot 4-indice-0-b
cdp_eval "JSON.stringify(window.__f55.log)" > "$OUT/luna.json"
cdp_eval "JSON.stringify({ currentTime: document.getElementById('v').currentTime, textTracks: document.getElementById('v').textTracks.length })" > "$OUT/state-end.json"
echo done
