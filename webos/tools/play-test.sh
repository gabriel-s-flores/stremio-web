#!/usr/bin/env bash
# Teste padronizado de reprodução no app-sonda (emulador ou TV via --port do inspector).
#   play-test.sh <url> [segundos] [seek-em-segundos]
#   LUNA=1 play-test.sh ...   também assina luna://com.webos.media/subscribe (no emulador isso
#                             congela o currentTime do <video>)
# Mostra eventos do <video>, faixas (audioTracks/textTracks), progresso, seek e mensagens do
# luna://com.webos.media/subscribe (sourceInfo etc.).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
URL="${1:?informe a url}"
SECS="${2:-8}"
SEEK="${3:-}"
JS=$(cat <<EOF
new Promise(function (res) {
    var v = document.getElementById('v');
    v.style.display = 'block';
    var out = { url: '$URL', events: [], luna: [], timeupdates: 0 };
    var t0 = Date.now();
    var evs = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting', 'stalled', 'seeking', 'seeked', 'ended', 'error'];
    var handlers = {};
    evs.forEach(function (n) {
        handlers[n] = function () { out.events.push(n + '@' + (Date.now() - t0) + 'ms' + (n === 'error' && v.error ? '(code ' + v.error.code + ')' : '')); };
        v.addEventListener(n, handlers[n]);
    });
    var onTime = function () { out.timeupdates++; };
    v.addEventListener('timeupdate', onTime);
    var subscribed = '${LUNA:-0}' !== '1';
    v.addEventListener('loadedmetadata', function () {
        if (subscribed || !v.mediaId || v.mediaId === '<invalid mediaId>') return;
        subscribed = true;
        window.probeLuna('luna://com.webos.media/subscribe', { mediaId: v.mediaId }, function (m) { out.luna.push(m); });
    });
    // Libera o pipeline anterior (o webOS tem recursos de mídia limitados, como na TV),
    // mas só se algo foi carregado: load() sem src deixa o pipeline do emulador preso.
    var go = function () { v.src = '$URL'; v.play(); };
    if (v.currentSrc) {
        v.pause();
        v.removeAttribute('src');
        v.load();
        setTimeout(go, 1500);
    } else {
        go();
    }
    var seekAt = '$SEEK';
    if (seekAt) setTimeout(function () { out.seekFrom = v.currentTime; v.currentTime = Number(seekAt); }, Math.floor($SECS * 1000 / 2));
    setTimeout(function () {
        var tracks = function (list) {
            if (!list) return null;
            var r = [];
            for (var i = 0; i < list.length; i++) r.push({ id: list[i].id, kind: list[i].kind, label: list[i].label, language: list[i].language, enabled: list[i].enabled, mode: list[i].mode });
            return r;
        };
        out.mediaId = v.mediaId;
        out.size = v.videoWidth + 'x' + v.videoHeight;
        out.duration = v.duration;
        out.currentTime = v.currentTime;
        out.paused = v.paused;
        out.error = v.error && v.error.code;
        out.audioTracks = tracks(v.audioTracks);
        out.videoTracks = tracks(v.videoTracks);
        out.textTracks = tracks(v.textTracks);
        evs.forEach(function (n) { v.removeEventListener(n, handlers[n]); });
        v.removeEventListener('timeupdate', onTime);
        res(out);
    }, $SECS * 1000);
})
EOF
)
node "$HERE/cdp.mjs" --target webosprobe --timeout $(( (SECS + 20) * 1000 )) eval "$JS"
