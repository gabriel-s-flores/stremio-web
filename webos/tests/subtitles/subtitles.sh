#!/usr/bin/env bash
# F5.5 check in the emulator, with the packaged app (after `pnpm webos:package`). One media scenario
# per boot; run each inside its own pool reservation:
#   webos/tools/emu-run --timeout 15 -- webos/tests/subtitles/subtitles.sh <output-dir> <scenario>
# Media from webos/tests/subtitles/make-media.sh in $MEDIA_DIR (default ~/webos-tv-sdk/media-tests/suite).
# Scenarios (the guest settings have the subtitles language `eng`):
#   embedded  t8_subs.mkv (subtitles: 0 PGS eng, 1 SRT eng, 2 SRT por, 3 ASS spa). The Player turns on
#             the English text track by itself (EMBEDDED_1, Luna index 0: the PGS is hidden and not
#             counted), then Portuguese is chosen in the menu (EMBEDDED_2, Luna index 1).
#   addon     t1_h264_aac.mp4 (no embedded subtitles) with add-on subtitles in the stream (eng SRT,
#             por SRT, spa ASS): the English one shows by itself in the HTML overlay, then the ASS one
#             is chosen (plain text, no libass error). Then the Player settings: no ASS option.
#   mixed     t8_subs.mkv with add-on subtitles too (eng, por): which one the Player turns on by itself
#             (the B5 rule), then the add-on English one is chosen in the menu (pipeline subtitles off).
#   le        t1_h264_aac.mp4 with an add-on subtitle on a Let's Encrypt host (needs internet): the page
#             fetch goes through the tlsproxy (F3.7); a direct fetch of the same URL fails.
# The pipeline draws embedded subtitles on the video plane (not in the page): in the emulator it draws
# nothing (webos/tests/subtitles/luna-probe.sh), so the embedded check is the Luna calls and the menu.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: subtitles.sh <output-dir> <embedded|addon|mixed>}"
SCENARIO="${2:?usage: subtitles.sh <output-dir> <embedded|addon|mixed>}"
MEDIA_DIR="${MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/suite}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
EMU=("$ROOT/webos/tools/emulator-qemu.sh" -i "$EMU_INSTANCE")
cdp_eval() { "${CDP[@]}" eval "$1"; }
log() { echo "$*" | tee -a "$OUT/actions.log"; }

case "$SCENARIO" in
    embedded) FILE=t8_subs.mkv; SUBS='' ;;
    addon) FILE=t1_h264_aac.mp4; SUBS='eng:addon_eng.srt por:addon_por.srt spa:addon_eng.ass' ;;
    mixed) FILE=t8_subs.mkv; SUBS='eng:addon_eng.srt por:addon_por.srt' ;;
    le) FILE=t1_h264_aac.mp4; SUBS="eng:${LE_SUBTITLE_URL:-https://debrid-link.com/robots.txt}" ;;
    *) echo "error: unknown scenario $SCENARIO" >&2; exit 1 ;;
esac
for f in "$FILE" addon_eng.srt addon_por.srt addon_eng.ass; do
    [[ -f "$MEDIA_DIR/$f" ]] || { echo "error: $MEDIA_DIR/$f not found (webos/tests/subtitles/make-media.sh)" >&2; exit 1; }
done
PORT="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
node "$ROOT/webos/tools/media-server.mjs" "$MEDIA_DIR" "$PORT" > "$OUT/media-server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
BASE="http://10.0.2.2:$PORT"
SUBTITLES_JSON="$(for entry in $SUBS; do file="${entry#*:}"; [[ "$file" == https://* ]] || file="$BASE/$file"; printf '{"id":"addon-%s","url":"%s","lang":"%s"},' "${entry%%:*}" "$file" "${entry%%:*}"; done)"
SUBTITLES_JSON="[${SUBTITLES_JSON%,}]"
echo "$SUBTITLES_JSON" > "$OUT/stream-subtitles.json"
SUBTITLES_ICON="$(node -e "
const s = require('fs').readFileSync(require.resolve('@stremio/stremio-icons/react', { paths: ['$ROOT'] }), 'utf8');
const m = / subtitles: \{ viewBox: \"[^\"]*\", paths: \[\{ d: \"([^\"]+)\"/.exec(s);
console.log(m ? m[1] : '');
")"
[[ -n "$SUBTITLES_ICON" ]] || { echo "error: subtitles icon not found" >&2; exit 1; }

cd "$ROOT"
pnpm webos:install
pnpm webos:launch

encoded=''
for _ in $(seq 1 90); do
    sleep 2
    encoded="$(cdp_eval "window.core ? window.core.encodeStream({ name: 'F5.5', description: '$FILE', url: '$BASE/redirect/$FILE', subtitles: $SUBTITLES_JSON }) : ''" 2>/dev/null || true)"
    if [[ -n "$encoded" && "$encoded" != 'null' && "$encoded" != *'erro'* ]]; then break; fi
    encoded=''
done
[[ -n "$encoded" ]] || { echo "error: the core did not answer encodeStream" >&2; exit 1; }
cdp_eval "$(cat "$ROOT/webos/tests/player/page.js")"
cdp_eval "window.core.getState('ctx').then(function(ctx) { var s = ctx.profile.settings; return JSON.stringify({ subtitlesLanguage: s.subtitlesLanguage, assSubtitlesStyling: s.assSubtitlesStyling, subtitlesSize: s.subtitlesSize, subtitlesTextColor: s.subtitlesTextColor, subtitlesBackgroundColor: s.subtitlesBackgroundColor }); })" > "$OUT/settings.json" || true

cdp_eval "location.hash = '#/player/' + encodeURIComponent('$encoded')"
start="$(date +%s)"

# Video clock, the add-on subtitles overlay of withHTMLSubtitles (the centered div next to the
# <video>) and how many subtitle Luna calls the app made.
sample() { # <phase>
    local s
    s="$(cdp_eval "JSON.stringify((function(){
        var v = document.querySelector('video');
        var overlay = null;
        if (v && v.parentElement) Array.prototype.forEach.call(v.parentElement.children, function(c) { if (c.tagName === 'DIV' && c.style.textAlign === 'center') overlay = c; });
        var luna = window.__f51.luna.filter(function(l) { return /ubtitle|selectTrack/.test(l.method || ''); });
        return { t: Date.now(), video: v ? { currentTime: v.currentTime, paused: v.paused, readyState: v.readyState, mediaId: v.mediaId || null } : null,
            overlay: overlay ? { text: overlay.textContent, display: overlay.style.display, html: overlay.innerHTML.slice(0, 400) } : null,
            subtitleLunaCalls: luna.length };
    })())" 2>/dev/null || echo null)"
    echo "{\"phase\":\"$1\",\"elapsed\":$(( $(date +%s) - start )),\"sample\":$s}" >> "$OUT/samples.jsonl"
}
show_controls() {
    cdp_eval "(function(){ var c = document.querySelector('[class*=\"player-container\"]'); if (c) { c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 960, clientY: 900 })); } return !!c; })()" > /dev/null || true
}
toggle_subtitles_menu() {
    show_controls
    cdp_eval "(function(){
        var path = Array.prototype.filter.call(document.querySelectorAll('[class*=\"control-bar-container\"] svg path'), function(p) { return p.getAttribute('d') === '$SUBTITLES_ICON'; })[0];
        var button = path ? path.closest('[class*=\"control-bar-button\"]') : null;
        if (button) button.click();
        return button ? button.className : null;
    })()"
}
menu_open() { cdp_eval "!!document.querySelector('[class*=\"subtitles-menu-container\"]')" | grep -q true; }
open_menu() { menu_open || log "open subtitles menu: $(toggle_subtitles_menu)"; sleep 1; }
close_menu() { ! menu_open || log "close subtitles menu: $(toggle_subtitles_menu)"; sleep 1; }
dump_menu() { # <name>
    cdp_eval "JSON.stringify({
        languages: Array.prototype.map.call(document.querySelectorAll('[class*=\"subtitles-menu-container\"] [class*=\"language-option\"]'), function(b) { return { lang: b.getAttribute('data-lang'), title: b.getAttribute('title'), selected: /(^| )selected( |$)/.test(b.className) }; }),
        variants: Array.prototype.map.call(document.querySelectorAll('[class*=\"subtitles-menu-container\"] [class*=\"variant-option\"]'), function(b) { return { title: b.getAttribute('title'), origin: (b.querySelector('[class*=\"variant-origin\"]') || {}).textContent, selected: /(^| )selected( |$)/.test(b.className) }; })
    })" > "$OUT/menu-$1.json" || true
    "${CDP[@]}" screenshot "$OUT/tela-menu-$1.png" || true
}
click_language() { # <lang>
    log "choose language $1: $(cdp_eval "(function(){ var b = document.querySelector('[class*=\"subtitles-menu-container\"] [data-lang=\"$1\"]'); if (b) b.click(); return !!b; })()")"
}
click_variant() { # <origin text regexp>
    log "choose variant /$1/: $(cdp_eval "(function(){ var b = Array.prototype.filter.call(document.querySelectorAll('[class*=\"subtitles-menu-container\"] [class*=\"variant-option\"]'), function(o) { return /$1/.test((o.querySelector('[class*=\"variant-origin\"]') || {}).textContent || ''); })[0]; if (b) b.click(); return b ? b.getAttribute('title') : null; })()")"
}
screens() { # <name>
    "${CDP[@]}" screenshot "$OUT/tela-$1.png" || true
    "${EMU[@]}" screenshot "$OUT/tela-vm-$1.png" || true
}

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
for _ in $(seq 1 5); do sleep 1; sample initial; done
screens inicial
open_menu
dump_menu inicial

case "$SCENARIO" in
    embedded)
        click_language por
        for _ in $(seq 1 3); do sleep 1; sample switched; done
        dump_menu trocado
        ;;
    addon)
        click_language spa
        for _ in $(seq 1 3); do sleep 1; sample switched; done
        dump_menu trocado
        close_menu
        sample switched-closed
        screens ass
        ;;
    mixed)
        click_variant 'EXCLUSIVE|xclusiv'
        for _ in $(seq 1 3); do sleep 1; sample switched; done
        dump_menu trocado
        close_menu
        sample switched-closed
        screens addon
        ;;
esac

if [[ "$SCENARIO" == le ]]; then
    # The Player's requests, before the manual fetches below add their own.
    cdp_eval "JSON.stringify(performance.getEntriesByType('resource').map(function(e) { return e.name; }).filter(function(n) { return !/^file:/.test(n); }))" > "$OUT/requests-player.json"
    # The same URL directly (the page does not trust Let's Encrypt) and through the proxy.
    LE_URL="${LE_SUBTITLE_URL:-https://debrid-link.com/robots.txt}"
    cdp_eval "(function(){
        var url = '$LE_URL';
        var bridge = window.__webosTlsProxy;
        return Promise.all([
            fetch(url, { credentials: 'omit' }).then(function(r) { return 'status ' + r.status; }, function(e) { return 'error ' + e; }),
            bridge.config().then(function(c) {
                if (c.mode !== 'proxy' || !c.ready) return 'mode ' + c.mode + ' ready ' + c.ready;
                return fetch('http://127.0.0.1:' + c.port + '/proxy?t=' + c.token + '&url=' + encodeURIComponent(url), { credentials: 'omit' })
                    .then(function(r) { return 'status ' + r.status + ', issuer ' + r.headers.get('X-Proxy-Issuer-O'); }, function(e) { return 'error ' + e; });
            }),
        ]).then(function(results) { return JSON.stringify({ url: url, direct: results[0], proxy: results[1], status: bridge.status() }); });
    })()" > "$OUT/le-fetch.json" || true
fi
cdp_eval "JSON.stringify({ luna: window.__f51.luna, errors: window.__f51.errors })" > "$OUT/luna.json"
cdp_eval "JSON.stringify(window.__f51.console)" > "$OUT/console.json"
cdp_eval "JSON.stringify(performance.getEntriesByType('resource').map(function(e) { return e.name; }).filter(function(n) { return !/^file:/.test(n); }))" > "$OUT/requests.json"
cdp_eval "JSON.stringify(Array.prototype.map.call(document.querySelectorAll('[class*=\"toast\"]'), function(e) { return e.textContent; }))" > "$OUT/toasts.json" || true

if [[ "$SCENARIO" == addon ]]; then
    # Player settings: the ASS styling option is gone, the other subtitle options stay.
    cdp_eval "location.hash = '#/settings'" > /dev/null
    sleep 4
    cdp_eval "(function(){ var label = Array.prototype.filter.call(document.querySelectorAll('div'), function(e) { return e.children.length === 0 && e.textContent === 'Default Subtitles Language'; })[0]; if (label) label.scrollIntoView(true); return !!label; })()" > /dev/null || true
    sleep 2
    cdp_eval "JSON.stringify(Array.prototype.map.call(document.querySelectorAll('[class*=\"option-container\"], [class*=\"option\"] [class*=\"label\"]'), function(e) { return e.textContent; }).filter(function(t, i, all) { return t && all.indexOf(t) === i; }))" > "$OUT/settings-options.json" || true
    "${CDP[@]}" screenshot "$OUT/tela-configuracoes-player.png" || true
fi
node "$ROOT/webos/tests/subtitles/evaluate.mjs" "$OUT" "$SCENARIO" | tee "$OUT/resultado.json"
