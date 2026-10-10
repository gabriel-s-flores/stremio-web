// In-page helpers for webos/tests/player/emulator.sh (F5.1). Evaluated once through cdp.mjs in the
// packaged app; ES2015 only (Chromium 53: no async/await). Everything lands on window.__f51.

(function() {
    if (window.__f51) return 'already installed';
    var state = { console: [], luna: [], errors: [] };
    window.__f51 = state;

    var describe = function(value) {
        if (value instanceof Error) return String(value.stack || value);
        if (typeof value === 'object') {
            try { return JSON.stringify(value); } catch (_e) { return String(value); }
        }
        return String(value);
    };
    ['log', 'info', 'warn', 'error'].forEach(function(level) {
        var original = console[level];
        console[level] = function() {
            var args = Array.prototype.slice.call(arguments);
            state.console.push({ t: Date.now(), level: level, text: args.map(describe).join(' ').slice(0, 2000) });
            return original.apply(console, arguments);
        };
    });
    window.addEventListener('error', function(event) {
        state.errors.push({ t: Date.now(), message: String(event.message), source: String(event.filename) + ':' + event.lineno });
    });

    // Every Luna request the app makes from now on (the platform read of F3.1 happened at boot).
    var service = window.webOS && window.webOS.service;
    if (service && typeof service.request === 'function') {
        var request = service.request.bind(service);
        service.request = function(uri, params) {
            state.luna.push({
                t: Date.now(),
                uri: String(uri),
                method: params && params.method,
                // webOSTV.js takes `subscribe` next to `method`; some services also read it from the parameters.
                subscribe: !!(params && (params.subscribe || (params.parameters && params.parameters.subscribe))),
                parameters: params && params.parameters,
            });
            return request(uri, params);
        };
    }

    var text = function(element) {
        return element ? element.textContent : null;
    };
    state.sample = function() {
        var video = document.querySelector('video');
        var labels = Array.prototype.map.call(document.querySelectorAll('[class*="seek-bar-container"] [class^="label-"]'), text);
        var buttons = document.querySelectorAll('[class*="control-bar-container"] [class^="control-bar-button-"]');
        return {
            t: Date.now(),
            hash: location.hash.slice(0, 40),
            video: video ? {
                currentTime: video.currentTime,
                duration: video.duration,
                paused: video.paused,
                ended: video.ended,
                readyState: video.readyState,
                networkState: video.networkState,
                mediaId: video.mediaId || null,
                playbackRate: video.playbackRate,
                error: video.error ? video.error.code : null,
                src: video.currentSrc,
            } : null,
            seekBarLabels: labels,
            controlBarButtons: buttons.length,
            playButtonTitle: buttons.length ? buttons[0].getAttribute('title') : null,
        };
    };
    return 'installed';
})()
