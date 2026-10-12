// In-page probes for webos/tests/final-url/emulator.sh (F8.1). Evaluated once through cdp.mjs in the
// packaged app before the Player opens; ES2015 only (Chromium 53). Everything lands on window.__f81:
// every `src` given to a <video> (the URL the pipeline got) and the media events of the <video>
// elements, with the time, readyState and networkState. The media server of the test is local: its
// URLs have no token, so they are kept whole here.

(function() {
    if (window.__f81) return 'already installed';
    var state = { events: [], marks: [] };
    window.__f81 = state;
    state.mark = function(name) {
        state.marks.push({ t: Date.now(), name: name });
        return true;
    };

    var descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set: function(value) {
            state.events.push({ t: Date.now(), event: 'src', url: String(value) });
            descriptor.set.call(this, value);
        },
    });

    // Media events do not bubble: a capturing listener on the document sees them all.
    ['loadstart', 'progress', 'stalled', 'suspend', 'durationchange', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'error', 'emptied'].forEach(function(name) {
        document.addEventListener(name, function(event) {
            var target = event.target;
            if (!target || target.tagName !== 'VIDEO') return;
            state.events.push({
                t: Date.now(),
                event: name,
                readyState: target.readyState,
                networkState: target.networkState,
                currentTime: target.currentTime,
                error: target.error ? target.error.code : null,
            });
        }, true);
    });

    // PROBE=off: the Player's header probe gets no answer (its reads are refused at once), so only
    // the pipeline and the first-byte request of the final URL use the network. For the A/B of
    // "does the concurrent probe delay the start?".
    state.blockProbe = function() {
        var original = window.fetch;
        window.fetch = function(input, init) {
            var range = init && init.headers && init.headers.Range;
            if (range && range !== 'bytes=0-0') {
                state.events.push({ t: Date.now(), event: 'probe-blocked', range: range });
                return Promise.reject(new TypeError('blocked by the F8.1 test'));
            }
            return original.apply(this, arguments);
        };
        return true;
    };

    return 'installed';
// cdp.mjs evaluates an expression: a trailing semicolon is a syntax error there.
// eslint-disable-next-line @stylistic/semi
})()
