#!/usr/bin/env bash
# What the console filter of F3.7b costs per call on the emulator (profile c8 for the TV's CPU quota):
# the same console.debug call through the page console (filtered) and through the console of a fresh
# iframe (unfiltered, the browser's own), for a string, a small object and the failed subtitle error
# (which holds the proxy URL, so the filter copies that branch). Nothing is attached to the console
# (no Console.enable), so the browser does not serialize the messages: the difference is the filter.
#   webos/tools/emu-run --timeout 15 --profile c8 -- webos/tests/redact/console-cost.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: console-cost.sh <output-dir>}"
mkdir -p "$OUT"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
( cd "$ROOT" && pnpm webos:install && pnpm webos:launch )
for _ in $(seq 1 60); do
    sleep 2
    "${CDP[@]}" eval "!!window.__webosTlsProxy" 2>/dev/null | grep -q true && break
done
sleep 10
"${CDP[@]}" eval "(function() {
    var frame = document.createElement('iframe');
    frame.style.display = 'none';
    document.body.appendChild(frame);
    var raw = frame.contentWindow.console;
    var url = 'http://127.0.0.1:47443/proxy?t=0123456789abcdef0123456789abcdef&url=https%3A%2F%2Fdebrid-link.com%2Fsubs%2Fpt.srt';
    var cases = {
        string: ['[webos] tracks: probe mp4, 1 audio, 0 subtitles, 662 ms'],
        smallObject: ['Player', { code: 2, message: 'Video is not supported', critical: true }],
        subtitleError: ['Player', { code: 70, message: 'Failed to load external subtitles', error: new Error('404 (Not Found)'), track: { id: 'addon-eng', url: url, fallbackUrl: url, lang: 'eng' }, critical: false }],
    };
    var N = 5000;
    var time = function(target, args) {
        var start = performance.now();
        for (var i = 0; i < N; i++) target.debug.apply(target, args);
        return (performance.now() - start) * 1000 / N;
    };
    var result = { calls: N, microsecondsPerCall: {}, filtered: console.__webosRedactInstalled === true, unfilteredIframe: raw.__webosRedactInstalled !== true };
    Object.keys(cases).forEach(function(name) {
        time(console, cases[name]); time(raw, cases[name]);
        var filteredUs = time(console, cases[name]);
        var rawUs = time(raw, cases[name]);
        result.microsecondsPerCall[name] = { page: Math.round(filteredUs * 10) / 10, rawBrowser: Math.round(rawUs * 10) / 10, filter: Math.round((filteredUs - rawUs) * 10) / 10 };
    });
    document.body.removeChild(frame);
    return JSON.stringify(result, null, 2);
})()" | tee "$OUT/console-cost.json"
