#!/usr/bin/env bash
# F5.4 check in the emulator: the Player's audio menu lists the tracks of t2_multi.mkv (AAC eng,
# AAC por, AC-3 5.1 eng) from the header probe with their language, the initial track follows the
# C8 rules, and a menu choice switches the audio (audioTracks[i].enabled) with the video still
# playing. One media scenario per boot. Run inside a pool reservation, after `pnpm webos:package`:
#   webos/tools/emu-run --timeout 15 -- webos/tests/player/tracks.sh <output-dir> [file] [switch-to]
# <file> (default t2_multi.mkv) is served from $MEDIA_DIR through /redirect/<file> (302, like a
# debrid link); <switch-to> is the menu entry chosen after the start (default EMBEDDED_1, Portuguese).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: tracks.sh <output-dir> [file] [switch-to]}"
FILE="${2:-t2_multi.mkv}"
SWITCH_TO="${3:-EMBEDDED_1}"
MEDIA_DIR="${MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/suite}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
EMU=("$ROOT/webos/tools/emulator-qemu.sh" -i "$EMU_INSTANCE")
SSH=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o HostKeyAlgorithms=+ssh-rsa
    -o PubkeyAcceptedAlgorithms=+ssh-rsa -i "$HOME/webos-tv-sdk/run/ares_webos_emul" -p "$EMU_SSH_PORT" developer@127.0.0.1)
cdp_eval() { "${CDP[@]}" eval "$1"; }

[[ -f "$MEDIA_DIR/$FILE" ]] || { echo "error: $MEDIA_DIR/$FILE not found (webos/tools/gen-media.sh)" >&2; exit 1; }
PORT="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
node "$ROOT/webos/tools/media-server.mjs" "$MEDIA_DIR" "$PORT" > "$OUT/media-server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
STREAM_URL="http://10.0.2.2:$PORT/redirect/$FILE"
ffprobe -v error -show_entries stream=index,codec_type,codec_name,channels:stream_tags=language,title -of json "$MEDIA_DIR/$FILE" > "$OUT/ffprobe.json"
AUDIO_ICON="$(node -e "
const s = require('fs').readFileSync(require.resolve('@stremio/stremio-icons/react', { paths: ['$ROOT'] }), 'utf8');
const m = /'audio-tracks': \{ viewBox: \"[^\"]*\", paths: \[\{ d: \"([^\"]+)\"/.exec(s) || /\"audio-tracks\": \{ viewBox: \"[^\"]*\", paths: \[\{ d: \"([^\"]+)\"/.exec(s);
console.log(m ? m[1] : '');
")"
SUBTITLES_ICON="$(node -e "
const s = require('fs').readFileSync(require.resolve('@stremio/stremio-icons/react', { paths: ['$ROOT'] }), 'utf8');
const m = / subtitles: \{ viewBox: \"[^\"]*\", paths: \[\{ d: \"([^\"]+)\"/.exec(s);
console.log(m ? m[1] : '');
")"
[[ -n "$AUDIO_ICON" && -n "$SUBTITLES_ICON" ]] || { echo "error: audio-tracks/subtitles icon not found" >&2; exit 1; }

# Pipeline logs: /var/log is /tmp/var/log on the emulator; every log file written during the run is
# kept (the marker separates them from the boot).
"${SSH[@]}" 'touch /tmp/f54-marker; ls -laR /tmp/var/log 2>&1' > "$OUT/pipeline-log-before.txt" 2>&1 || true

cd "$ROOT"
pnpm webos:install
pnpm webos:launch

encoded=''
for _ in $(seq 1 90); do
    sleep 2
    encoded="$(cdp_eval "window.core ? window.core.encodeStream({ name: 'F5.4', description: '$FILE', url: '$STREAM_URL' }) : ''" 2>/dev/null || true)"
    if [[ -n "$encoded" && "$encoded" != 'null' && "$encoded" != *'erro'* ]]; then break; fi
    encoded=''
done
[[ -n "$encoded" ]] || { echo "error: the core did not answer encodeStream" >&2; exit 1; }
cdp_eval "$(cat "$ROOT/webos/tests/player/page.js")"
cdp_eval "window.core.getState('ctx').then(function(ctx) { var s = ctx.profile.settings; return JSON.stringify({ audioLanguage: s.audioLanguage, secondaryAudioLanguage: s.secondaryAudioLanguage, subtitlesLanguage: s.subtitlesLanguage }); })" > "$OUT/settings.json" || true

cdp_eval "location.hash = '#/player/' + encodeURIComponent('$encoded')"
start="$(date +%s)"

# Element tracks, video clock and the audio menu as rendered.
sample() { # <phase>
    local s
    s="$(cdp_eval "JSON.stringify((function(){
        var v = document.querySelector('video');
        var list = v && v.audioTracks;
        var tracks = [];
        for (var i = 0; list && i < list.length; i++) tracks.push({ language: list[i].language, label: list[i].label, enabled: list[i].enabled });
        var menu = Array.prototype.map.call(document.querySelectorAll('[class*=\"audio-menu\"] [data-id]'), function(b) {
            return { id: b.getAttribute('data-id'), lang: (b.querySelector('[class*=\"lang\"]') || {}).textContent, label: (b.querySelector('[class*=\"label\"]') || {}).textContent, selected: /(^| )selected( |$)/.test(b.className) };
        });
        return { t: Date.now(), video: v ? { currentTime: v.currentTime, paused: v.paused, ended: v.ended, readyState: v.readyState, error: v.error ? v.error.code : null, mediaId: v.mediaId || null } : null, audioTracks: tracks, menu: menu };
    })())" 2>/dev/null || echo null)"
    echo "{\"phase\":\"$1\",\"elapsed\":$(( $(date +%s) - start )),\"sample\":$s}" >> "$OUT/samples.jsonl"
}
show_controls() {
    cdp_eval "(function(){ var c = document.querySelector('[class*=\"player-container\"]'); if (c) { c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 960, clientY: 900 })); } return !!c; })()" > /dev/null || true
}
click_control() { # <icon path>
    show_controls
    cdp_eval "(function(){
        var path = Array.prototype.filter.call(document.querySelectorAll('[class*=\"control-bar-container\"] svg path'), function(p) { return p.getAttribute('d') === '$1'; })[0];
        var button = path ? path.closest('[class*=\"control-bar-button\"]') : null;
        if (button) button.click();
        return button ? button.className : null;
    })()"
}
toggle_audio_menu() { click_control "$AUDIO_ICON"; }

: > "$OUT/samples.jsonl"
started=''
for _ in $(seq 1 120); do
    sleep 1
    sample loading
    if cdp_eval "(function(){ var v = document.querySelector('video'); return !!v && v.readyState >= 3 && v.currentTime > 0 && !v.paused; })()" 2>/dev/null | grep -q true; then
        started="$(( $(date +%s) - start ))"
        break
    fi
done
echo "{\"secondsToPlayback\":${started:-null}}" > "$OUT/startup.json"
for _ in $(seq 1 3); do sleep 1; sample initial; done
# The video plane only shows in the VM screen (CDP captures the page): its burned-in clock shows
# whether the picture keeps moving around the switch.
"${EMU[@]}" screenshot "$OUT/tela-vm-1-inicial.png" || true

echo "open menu: $(toggle_audio_menu)" | tee -a "$OUT/actions.log"
sleep 1
sample menu-initial
"${CDP[@]}" screenshot "$OUT/tela-menu-audio-inicial.png" || true

echo "choose $SWITCH_TO: $(cdp_eval "(function(){ var b = document.querySelector('[class*=\"audio-menu\"] [data-id=\"$SWITCH_TO\"]'); if (b) b.click(); return !!b; })()")" | tee -a "$OUT/actions.log"
"${EMU[@]}" screenshot "$OUT/tela-vm-2-antes-da-troca.png" || true
for i in $(seq 1 4); do
    sleep 1
    sample switched
    [[ $i != 2 && $i != 4 ]] || "${EMU[@]}" screenshot "$OUT/tela-vm-3-depois-da-troca-${i}s.png" || true
done
if ! cdp_eval "!!document.querySelector('[class*=\"audio-menu\"]')" | grep -q true; then
    echo "reopen menu: $(toggle_audio_menu)" | tee -a "$OUT/actions.log"
    sleep 1
fi
sample menu-switched
"${CDP[@]}" screenshot "$OUT/tela-menu-audio-trocado.png" || true
"${EMU[@]}" screenshot "$OUT/tela-vm-menu-audio-trocado.png" || true

# Embedded subtitles: listed (by language) in the subtitles menu once the video plays; the Player's
# own choice (subtitles language of the settings) is dropped by the decorator until F5.5.
echo "open subtitles menu: $(click_control "$SUBTITLES_ICON")" | tee -a "$OUT/actions.log"
sleep 1
cdp_eval "JSON.stringify(Array.prototype.map.call(document.querySelectorAll('[class*=\"subtitles-menu-container\"] [class*=\"language-option\"]'), function(b) { return { lang: b.getAttribute('data-lang'), title: b.getAttribute('title'), selected: /(^| )selected( |$)/.test(b.className) }; }))" > "$OUT/subtitles-menu.json" || true
"${CDP[@]}" screenshot "$OUT/tela-menu-legendas.png" || true
# Choosing an embedded subtitle by hand: listed only until F5.5, so nothing reaches Luna.
echo "choose embedded subtitles eng: $(cdp_eval "(function(){ var b = document.querySelector('[class*=\"subtitles-menu-container\"] [data-lang=\"eng\"]'); if (b) b.click(); return !!b; })()")" | tee -a "$OUT/actions.log"
sleep 2
cdp_eval "JSON.stringify(Array.prototype.map.call(document.querySelectorAll('[class*=\"subtitles-menu-container\"] [class*=\"language-option\"]'), function(b) { return { lang: b.getAttribute('data-lang'), title: b.getAttribute('title'), selected: /(^| )selected( |$)/.test(b.className) }; }))" > "$OUT/subtitles-menu-after-choice.json" || true
"${CDP[@]}" screenshot "$OUT/tela-menu-legendas-depois-da-escolha.png" || true

cdp_eval "JSON.stringify({ luna: window.__f51.luna, errors: window.__f51.errors })" > "$OUT/luna.json"
cdp_eval "JSON.stringify(window.__f51.console)" > "$OUT/console.json"
cdp_eval "JSON.stringify(performance.getEntriesByType('resource').map(function(e) { return e.name; }).filter(function(n) { return !/^file:/.test(n); }))" > "$OUT/requests.json"
"${SSH[@]}" 'for f in $(find /tmp/var/log /tmp -maxdepth 3 -type f -newer /tmp/f54-marker 2>/dev/null); do echo "=== $f"; tail -n 3000 "$f"; done; echo "=== ps"; ps w 2>/dev/null | grep -i -E "starfish|media|ums|pmlog" | grep -v grep' > "$OUT/pipeline.log" 2>&1 || true
grep -i -E 'audio|track|select|lang' "$OUT/pipeline.log" > "$OUT/pipeline-audio.log" || true

node "$ROOT/webos/tests/player/tracks-evaluate.mjs" "$OUT" "$SWITCH_TO" | tee "$OUT/resultado.json"
