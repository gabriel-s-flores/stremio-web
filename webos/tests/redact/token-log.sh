#!/usr/bin/env bash
# F3.7b in the emulator, with the packaged app (after `pnpm webos:package` and
# webos/tests/subtitles/make-media.sh): an add-on subtitle on a Let's Encrypt host that FAILS through
# the certificate proxy (F3.7, F5.5). Neither the console nor the screen nor the diagnostics report
# may show the proxy token.
#   webos/tools/emu-run --timeout 15 -- webos/tests/redact/token-log.sh <output-dir>
# APP_ROOT=<other checkout> runs it on that checkout's package (the checks are then expected to fail
# where the filter is missing: that is the "before" of the F3.7b evidence).
# What it does: starts the DevTools recorder (cdp-log.mjs: every console call with its arguments, the
# browser's own log entries and the exceptions), plays t1_h264_aac.mp4 with a subtitle on
# debrid-link.com that answers 404, picks it in the menu, opens its context menu and presses
# "Download subtitles", opens the diagnostics screen and saves its report. Then token-check.mjs looks
# for the token in everything it wrote. The token itself is never written to <output-dir>.
# A control logs the proxy URL through the unfiltered console of an iframe: the recorder must see
# the token there, or its silence would prove nothing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: token-log.sh <output-dir>}"
MEDIA_DIR="${MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/suite}"
MISSING_SUBTITLE_URL="${MISSING_SUBTITLE_URL:-https://debrid-link.com/zz-f37b-missing-subtitle.srt}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
cdp_eval() { "${CDP[@]}" eval "$1"; }
log() { echo "$*" | tee -a "$OUT/actions.log"; }
FILE=t1_h264_aac.mp4
[[ -f "$MEDIA_DIR/$FILE" ]] || { echo "error: $MEDIA_DIR/$FILE not found (webos/tests/subtitles/make-media.sh)" >&2; exit 1; }

PORT="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
node "$ROOT/webos/tools/media-server.mjs" "$MEDIA_DIR" "$PORT" > "$OUT/media-server.log" 2>&1 &
SERVER_PID=$!
RECORDER_PID=''
cleanup() {
    kill "$SERVER_PID" 2>/dev/null || true
    [[ -z "$RECORDER_PID" ]] || kill "$RECORDER_PID" 2>/dev/null || true
}
trap cleanup EXIT
BASE="http://10.0.2.2:$PORT"
SUBTITLES_JSON="[{\"id\":\"addon-eng-missing\",\"url\":\"$MISSING_SUBTITLE_URL\",\"lang\":\"eng\"}]"
echo "$SUBTITLES_JSON" > "$OUT/stream-subtitles.json"
SUBTITLES_ICON="$(node -e "
const s = require('fs').readFileSync(require.resolve('@stremio/stremio-icons/react', { paths: ['$ROOT'] }), 'utf8');
const m = / subtitles: \{ viewBox: \"[^\"]*\", paths: \[\{ d: \"([^\"]+)\"/.exec(s);
console.log(m ? m[1] : '');
")"
[[ -n "$SUBTITLES_ICON" ]] || { echo "error: subtitles icon not found" >&2; exit 1; }

# APP_ROOT: another checkout whose package to install (to run the scenario on a build without the fix).
( cd "${APP_ROOT:-$ROOT}" && pnpm webos:install && pnpm webos:launch )

encoded=''
for _ in $(seq 1 90); do
    sleep 2
    encoded="$(cdp_eval "window.core ? window.core.encodeStream({ name: 'F3.7b', description: '$FILE', url: '$BASE/redirect/$FILE', subtitles: $SUBTITLES_JSON }) : ''" 2>/dev/null || true)"
    if [[ -n "$encoded" && "$encoded" != 'null' && "$encoded" != *'erro'* ]]; then break; fi
    encoded=''
done
[[ -n "$encoded" ]] || { echo "error: the core did not answer encodeStream" >&2; exit 1; }

# The proxy token, from the page; kept in a variable, never in a file of $OUT.
TOKEN=''
for _ in $(seq 1 60); do
    TOKEN="$(cdp_eval "window.__webosTlsProxy.config().then(function(c) { return c.mode === 'proxy' && c.ready ? c.token : ''; })" 2>/dev/null | tr -d '"' || true)"
    [[ -z "$TOKEN" || "$TOKEN" == 'null' ]] || break
    TOKEN=''
    sleep 2
done
cdp_eval "window.__webosTlsProxy.config().then(function(c) { return JSON.stringify({ mode: c.mode, ready: c.ready, port: c.port, hosts: c.hosts.length, tokenLength: (c.token || '').length }); })" > "$OUT/proxy-state.json"
[[ -n "$TOKEN" ]] || { echo "error: the certificate proxy is not up in the emulator (mode in $OUT/proxy-state.json)" >&2; exit 1; }
[[ "$TOKEN" =~ ^[0-9a-f]{32}$ ]] || { echo "error: unexpected token shape" >&2; exit 1; }
cdp_eval "window.__webosTlsProxy.config().then(function(c) { return 'http://127.0.0.1:' + c.port + '/proxy?t=' + c.token + '&url=' + encodeURIComponent('$MISSING_SUBTITLE_URL'); })" | tr -d '"' > /tmp/f37b-proxy-url.$$
trap 'rm -f /tmp/f37b-proxy-url.$$ "${CONTROL_FILE:-}"; cleanup' EXIT

# The inspector takes one client at a time: from here on the recorder does the evaluations and the
# screenshots too (cdp-log.mjs HTTP control).
CONTROL_FILE="$(mktemp)"
TOKEN="$TOKEN" node "$ROOT/webos/tests/redact/cdp-log.mjs" --port "$EMU_CDP_PORT" --out "$OUT/devtools-log.jsonl" --control-file "$CONTROL_FILE" --seconds 600 &
RECORDER_PID=$!
for _ in $(seq 1 40); do [[ -s "$CONTROL_FILE" ]] && break; sleep 0.5; done
[[ -s "$CONTROL_FILE" ]] || { echo "error: the DevTools recorder did not start" >&2; exit 1; }
REC_URL="http://127.0.0.1:$(cat "$CONTROL_FILE")"
recorder_call() { # <endpoint> <body>: prints the answer; a failure is written to recorder-errors.log
    local body="$OUT/.recorder-body" code
    code="$(curl -s --max-time 120 -o "$body" -w '%{http_code}' --data-binary "$2" "$REC_URL/$1")" || { echo "recorder unreachable ($1)" >> "$OUT/recorder-errors.log"; return 7; }
    if [[ "$code" == 200 ]]; then cat "$body"; rm -f "$body"; return 0; fi
    echo "$1 failed ($code): $(head -c 300 "$body")" >> "$OUT/recorder-errors.log"
    rm -f "$body"
    return 22
}
cdp_eval() { recorder_call eval "$1"; }
shot() { recorder_call screenshot "$1" > /dev/null; }

# Control: the console of a fresh iframe is not filtered. The recorder has to see the token.
cdp_eval "(function() {
    var frame = document.createElement('iframe');
    frame.style.display = 'none';
    document.body.appendChild(frame);
    frame.contentWindow.console.error('F37B-CONTROL', '$(cat /tmp/f37b-proxy-url.$$)');
    document.body.removeChild(frame);
    return 'logged';
})()" > /dev/null
# The same call through the page console (filtered).
cdp_eval "(function() { console.error('F37B-FILTERED', '$(cat /tmp/f37b-proxy-url.$$)'); return 'logged'; })()" > /dev/null

cdp_eval "location.hash = '#/player/' + encodeURIComponent('$encoded')" > /dev/null
start="$(date +%s)"

menu_open() { cdp_eval "!!document.querySelector('[class*=\"subtitles-menu-container\"]')" | grep -q true; }
toggle_subtitles_menu() {
    cdp_eval "(function(){ var c = document.querySelector('[class*=\"player-container\"]'); if (c) { c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 960, clientY: 900 })); } return !!c; })()" > /dev/null || true
    cdp_eval "(function(){
        var path = Array.prototype.filter.call(document.querySelectorAll('[class*=\"control-bar-container\"] svg path'), function(p) { return p.getAttribute('d') === '$SUBTITLES_ICON'; })[0];
        var button = path ? path.closest('[class*=\"control-bar-button\"]') : null;
        if (button) button.click();
        return button ? button.className : null;
    })()"
}
for _ in $(seq 1 120); do
    sleep 1
    if cdp_eval "(function(){ var v = document.querySelector('video'); return !!v && v.readyState >= 3 && v.currentTime > 0 && !v.paused; })()" 2>/dev/null | grep -q true; then
        echo "{\"secondsToPlayback\":$(( $(date +%s) - start ))}" > "$OUT/startup.json"
        break
    fi
done
# The clip is 20 s: looping keeps the Player from ending (and going back a screen) before the steps below are done.
cdp_eval "(function(){ var v = document.querySelector('video'); if (v) v.loop = true; return !!v; })()" > /dev/null || true
sleep 3

# Choose the English subtitles: the fetch goes through the proxy, answers 404, and the Player logs the error.
menu_open || log "open subtitles menu: $(toggle_subtitles_menu)"
sleep 1
log "choose language eng: $(cdp_eval "(function(){ var b = document.querySelector('[class*=\"subtitles-menu-container\"] [data-lang=\"eng\"]'); if (b) b.click(); return !!b; })()")"
sleep 4
shot "$OUT/tela-legenda-falhou.png" || true
cdp_eval "JSON.stringify(Array.prototype.map.call(document.querySelectorAll('[class*=\"toast\"]'), function(e) { return e.textContent; }))" > "$OUT/toasts.json" || true

# The context menu of the add-on subtitle: "Download subtitles" must not show the link (F3.4).
log "context menu: $(cdp_eval "(function(){ var b = document.querySelector('[class*=\"subtitles-menu-container\"] [class*=\"variant-option\"]'); if (!b) return null; b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400 })); return b.getAttribute('title'); })()")"
sleep 1
shot "$OUT/tela-menu-contexto.png" || true
cdp_eval "JSON.stringify(Array.prototype.map.call(document.querySelectorAll('[class*=\"context-menu-option\"]'), function(e) { return { title: e.getAttribute('title'), tag: e.tagName, text: e.textContent }; }))" > "$OUT/context-menu.json" || true
log "press Download subtitles: $(cdp_eval "(function(){ var b = Array.prototype.filter.call(document.querySelectorAll('[class*=\"context-menu-option\"]'), function(e) { return /ownload/.test(e.getAttribute('title') || ''); })[0]; if (b) b.click(); return !!b; })()")"
sleep 2
shot "$OUT/tela-apos-download.png" || true
cdp_eval "JSON.stringify({ externalLinkDialog: !!document.querySelector('[role=dialog]'), qr: !!document.querySelector('[role=img][aria-label]'), url: location.hash.length > 0 })" > "$OUT/external-link-dialog.json" || true

# What the page shows, and where the token could still be: the text on screen, every attribute, the storage.
cdp_eval "(function(){
    var token = '$TOKEN';
    var attributes = 0;
    Array.prototype.forEach.call(document.querySelectorAll('*'), function(e) {
        Array.prototype.forEach.call(e.attributes, function(a) { if (a.value.indexOf(token) !== -1) attributes += 1; });
    });
    var storage = [];
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if ((localStorage.getItem(k) || '').indexOf(token) !== -1) storage.push(k); }
    return JSON.stringify({ clipboard: typeof navigator.clipboard, visibleText: document.body.innerText.length, tokenInVisibleText: document.body.innerText.indexOf(token) !== -1, attributesWithToken: attributes, localStorageKeysWithToken: storage });
})()" > "$OUT/page-audit-player.json"

# The diagnostics screen (F3.6): shown report, then Save (localStorage + console.info). Opened from the
# Board: from the Player, with the media still playing, the page stopped answering in 3 of 5 runs of the
# emulator, on this build and on the one without the F3.7b changes alike.
cdp_eval "location.hash = '#/'" > /dev/null
sleep 5
cdp_eval "location.hash = '#/webos-diagnostics'" > /dev/null
ready=false
for _ in $(seq 1 30); do
    sleep 1
    if cdp_eval "(function(){ var b = document.querySelector('pre'); return !!b && b.textContent.indexOf('Stremio webOS diagnostics') === 0; })()" 2>/dev/null | grep -q true; then ready=true; break; fi
done
log "diagnostics screen ready: $ready ($(cdp_eval "location.hash" 2>&1 || true))"
sleep 2
shot "$OUT/tela-diagnostico.png" || true
log "save report: $(cdp_eval "(function(){ var b = Array.prototype.filter.call(document.querySelectorAll('button, [class*=\"action\"]'), function(e) { return e.getAttribute('title') === 'Save report'; })[0]; if (b) b.click(); return !!b; })()" 2>&1 || true)"
sleep 1
cdp_eval "(document.querySelector('pre') || {}).textContent || ''" > "$OUT/diagnostics-text.txt" || true
cdp_eval "localStorage.getItem('webos.diagnostics.report') || ''" > "$OUT/diagnostics-saved.txt" || true
cdp_eval "(function(){
    var token = '$TOKEN';
    var block = document.querySelector('pre');
    var report = window.__webos && window.__webos.diagnostics;
    return JSON.stringify({ reportBlockChars: block ? block.textContent.length : null, tokenInReportBlock: block ? block.textContent.indexOf(token) !== -1 : null, tokenInBodyText: document.body.innerText.indexOf(token) !== -1,
        tokenInReportObject: report ? JSON.stringify(report).indexOf(token) !== -1 : null, tokenInSavedReport: (localStorage.getItem('webos.diagnostics.report') || '').indexOf(token) !== -1 });
})()" > "$OUT/page-audit-diagnostics.json" || true

sleep 1
kill "$RECORDER_PID" 2>/dev/null || true
wait "$RECORDER_PID" 2>/dev/null || true
RECORDER_PID=''
TOKEN="$TOKEN" MISSING_SUBTITLE_URL="$MISSING_SUBTITLE_URL" node "$ROOT/webos/tests/redact/token-check.mjs" "$OUT" | tee "$OUT/resultado.json"
