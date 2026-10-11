#!/usr/bin/env bash
# F5.5 experiment in the emulator, with the probe app (no Stremio): plays t8_subs.mkv (subtitles
# 0 PGS, 1 SRT eng, 2 SRT por, 3 ASS spa) and turns the pipeline subtitles on through Luna
# (setSubtitleEnable + selectTrack type text) at each index, then tries the style calls, with a VM
# screenshot after each step (the pipeline draws the subtitles on the video plane, which CDP does not
# capture). Answers: does the pipeline draw embedded text subtitles, and does the Luna index count
# the bitmap track? SUBSCRIBE=1 also subscribes to com.webos.media to log the track info.
#   webos/tools/emu-run --timeout 15 -- webos/tests/subtitles/luna-probe.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: luna-probe.sh <output-dir>}"
FILE="${FILE:-t8_subs.mkv}"
MEDIA_DIR="${MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/suite}"
PROBE_IPK="$HOME/webos-tv-sdk/probe/out/io.github.gabrielsflores.webosprobe_1.0.0_all.ipk"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
EMU=("$ROOT/webos/tools/emulator-qemu.sh" -i "$EMU_INSTANCE")
cdp_eval() { "${CDP[@]}" eval "$1"; }
shot() { "${EMU[@]}" screenshot "$OUT/vm-$1.png" >/dev/null 2>&1 || true; }

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
    var s = window.__f55 = { log: [], subscribe: [] };
    var v = document.getElementById('v');
    v.style.display = 'block';
    v.style.position = 'fixed'; v.style.left = '0'; v.style.top = '0'; v.style.width = '100%'; v.style.height = '100%';
    s.call = function(method, parameters) {
        var entry = { t: Date.now(), method: method, parameters: parameters, result: null };
        s.log.push(entry);
        window.probeLuna('luna://com.webos.media/' + method, parameters, function(r) { entry.result = r; });
    };
    s.state = function() { return { t: Date.now(), currentTime: v.currentTime, readyState: v.readyState, paused: v.paused, mediaId: v.mediaId || null, textTracks: v.textTracks.length, audioTracks: v.audioTracks ? v.audioTracks.length : null }; };
    v.onloadedmetadata = function() {
        if ('${SUBSCRIBE:-0}' === '1' && v.mediaId) window.probeLuna('luna://com.webos.media/subscribe', { mediaId: v.mediaId }, function(r) { s.subscribe.push(r); });
    };
    v.src = '$URL';
    v.play();
    return 'playing';
})()"

started=''
for _ in $(seq 1 60); do
    sleep 1
    # With SUBSCRIBE=1 the currentTime stays at 0 (D3a): readyState only.
    if cdp_eval "(function(){ var v = document.getElementById('v'); return v.readyState >= 3 && (v.currentTime > 0.5 || '${SUBSCRIBE:-0}' === '1'); })()" | grep -q true; then started=1; break; fi
done
cdp_eval "JSON.stringify(window.__f55.state())" > "$OUT/state-start.json"
cdp_eval "JSON.stringify(window.__f55.subscribe)" > "$OUT/subscribe.json"
[[ -n "$started" ]] || { echo "error: the video did not start" | tee "$OUT/erro.txt"; exit 1; }
shot 0-sem-legenda

call() { cdp_eval "(function(){ var v = document.getElementById('v'); window.__f55.call('$1', Object.assign({ mediaId: v.mediaId }, $2)); return true; })()" >/dev/null; }

call setSubtitleEnable '{ enable: true }'
for index in 0 1 2 3; do
    call selectTrack "{ type: 'text', index: $index }"
    sleep 3
    shot "1-indice-$index-a"
    sleep 1
    shot "1-indice-$index-b"
done
# Style (the stremio-video WebOsVideo calls) on the text track at index 1.
call selectTrack "{ type: 'text', index: 1 }"
sleep 2
call setSubtitleCharacterColor "{ charColor: 'yellow' }"
call setSubtitleFontSize "{ fontSize: 4 }"
call setSubtitleBackgroundColor "{ bgColor: 'blue' }"
call setSubtitleBackgroundOpacity "{ bgOpacity: 255 }"
call setSubtitlePosition "{ position: 2 }"
sleep 3
shot 2-estilo-a
sleep 1
shot 2-estilo-b
call setSubtitleEnable '{ enable: false }'
sleep 3
shot 3-desligada
cdp_eval "JSON.stringify(window.__f55.state())" > "$OUT/state-end.json"
cdp_eval "JSON.stringify(window.__f55.log)" > "$OUT/luna.json"
cdp_eval "JSON.stringify(window.__f55.subscribe)" > "$OUT/subscribe.json"
echo done
