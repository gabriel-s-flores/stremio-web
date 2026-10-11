// In-page helpers for webos/tests/player/switches.sh (F5.6). Evaluated once through cdp.mjs in the
// packaged app; ES2015 only (Chromium 53: no async/await). Everything lands on window.__f56: every
// <video> the app creates (numbered in order), its media events with the mediaId, the console
// lines of the pipeline guard, and a sample of the current Player.

(function() {
    if (window.__f56) return 'already installed';
    var t0 = Date.now();
    var state = { videos: [], events: [], console: [], errors: [] };
    window.__f56 = state;

    var EVENTS = ['loadstart', 'loadedmetadata', 'playing', 'pause', 'ended', 'emptied', 'abort', 'error'];
    var watch = function() {
        Array.prototype.forEach.call(document.querySelectorAll('video'), function(video) {
            if (video.__f56 !== undefined) return;
            video.__f56 = state.videos.length;
            state.videos.push({ n: video.__f56, seenAt: Date.now() - t0 });
            EVENTS.forEach(function(name) {
                video.addEventListener(name, function() {
                    state.events.push({
                        t: Date.now() - t0,
                        video: video.__f56,
                        event: name,
                        mediaId: video.mediaId || null,
                        src: (video.getAttribute('src') || '').split('/').pop(),
                        error: name === 'error' && video.error ? video.error.code : null,
                    });
                });
            });
        });
    };
    watch();
    setInterval(watch, 100);

    ['log', 'info', 'warn', 'error'].forEach(function(level) {
        var original = console[level];
        console[level] = function() {
            var text = Array.prototype.map.call(arguments, function(value) {
                if (value instanceof Error) return String(value.stack || value);
                if (typeof value === 'object') {
                    try { return JSON.stringify(value); } catch (_e) { return String(value); }
                }
                return String(value);
            }).join(' ');
            if (/\[webos\] player|Player|Video/.test(text)) state.console.push({ t: Date.now() - t0, level: level, text: text.slice(0, 600) });
            return original.apply(console, arguments);
        };
    });
    window.addEventListener('error', function(event) {
        state.errors.push({ t: Date.now() - t0, message: String(event.message), source: String(event.filename) + ':' + event.lineno });
    });

    state.sample = function() {
        var video = document.querySelector('video');
        return {
            t: Date.now() - t0,
            hash: location.hash.slice(0, 12),
            videos: document.querySelectorAll('video').length,
            video: video ? {
                n: video.__f56,
                src: (video.getAttribute('src') || '').split('/').pop(),
                readyState: video.readyState,
                networkState: video.networkState,
                currentTime: Math.round(video.currentTime * 10) / 10,
                paused: video.paused,
                mediaId: video.mediaId || null,
                error: video.error ? video.error.code : null,
            } : null,
            errorLayer: !!document.querySelector('[class*="error-layer"]'),
        };
    };
    return 'installed';
})()
