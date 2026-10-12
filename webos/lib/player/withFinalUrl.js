// Decorator of stremio-video's WebOsVideo (F8.1): the pipeline gets the final URL of a debrid link
// instead of the resolver's. On the C8 a <video> whose src answers 302 (Torrentio's /resolve/… → the
// Real-Debrid file host) takes 1.5 to 3 min to start, or never starts; with the final link it starts
// in about 6 s, resuming in the middle of a film too. Wired in between withC8Tracks and the pipeline
// guard by webos/lib/tracks/WebOsVideo.js. Measurements and reasons: README.md, "Link final".
//
// A load asks webos/lib/final-url for the final URL (known already when the stream list's or the
// Player's probe followed the redirect; otherwise one `Range: bytes=0-0` request, at most
// RESOLVE_TIMEOUT_MS, the original link if it fails) and passes the load on with that URL. What is
// dispatched meanwhile waits and goes after it, in order; an unload, a destroy or another load drops
// the load still waiting (and what waited for it). The unload the Player sends before each load goes
// through at once, so the pipeline guard's quiet release of the previous stream runs during the
// request. The rest of the app sees the original link: the `stream` prop and the stream of the
// errors carry the URL the Player loaded (the error layer of F6.3, the probe cache and the core's
// stream state are keyed on it). A critical error forgets the final URL, so the next load of the
// stream asks the resolver again (the link may have expired).
// The final URL has a token and the resolver's the debrid key: only the host goes to the log.
// localStorage key (read once, when the app starts): webos.player.finalUrl = "off" loads the
// resolver's link, as before.

const { hostOf } = require('../debrid-link');

const FINAL_URL_KEY = 'webos.player.finalUrl';

const isCommand = (action, commandName) => action !== null && typeof action === 'object' &&
    action.type === 'command' && action.commandName === commandName;
const urlOfLoad = (action) => {
    const args = action.commandArgs;
    return args && args.stream && typeof args.stream.url === 'string' ? args.stream.url : null;
};

// deps: finalUrls ({ resolve(url) -> Promise<{ url, source, ms, host }>, peek(url), forget(url) }),
// log (console-like, optional).
const withFinalUrl = (Video, deps) => {
    const finalUrls = deps.finalUrls;
    const log = deps.log || null;

    function VideoWithFinalUrl(options) {
        const video = new Video(options);
        let destroyed = false;
        // The load waiting for its final URL: { action, queue }, or null.
        let pending = null;
        // The URLs of the last load passed on: { original, final }.
        let current = null;
        // The last stream mapped back to the original URL, so the `stream` prop keeps its identity.
        let mappedFrom = null;
        let mappedTo = null;

        const info = (message) => {
            if (log) log.info('[webos] player: ' + message);
        };

        // A stream of the inner video with the final URL -> the same stream with the original one.
        const mapStream = (stream) => {
            if (stream === null || typeof stream !== 'object' || current === null || current.final === current.original || stream.url !== current.final) return stream;
            if (stream !== mappedFrom) {
                mappedFrom = stream;
                mappedTo = Object.assign({}, stream, { url: current.original });
            }
            return mappedTo;
        };

        video.on('error', (error) => {
            if (error && error.critical && current !== null) finalUrls.forget(current.original);
        });

        const pass = (load, finalUrl) => {
            const url = urlOfLoad(load);
            current = { original: url, final: finalUrl };
            if (finalUrl === url) {
                video.dispatch(load);
                return;
            }
            const args = load.commandArgs;
            video.dispatch(Object.assign({}, load, { commandArgs: Object.assign({}, args, { stream: Object.assign({}, args.stream, { url: finalUrl }) }) }));
        };

        const startLoad = (load) => {
            const url = urlOfLoad(load);
            const known = finalUrls.peek(url);
            if (known !== null) {
                info('final URL known' + (hostOf(known) ? ' (' + hostOf(known) + ')' : ''));
                pass(load, known);
                return;
            }
            const entry = { action: load, queue: [] };
            pending = entry;
            finalUrls.resolve(url).then((resolved) => {
                if (destroyed || pending !== entry) return;
                pending = null;
                info('final URL ' + resolved.source + ' in ' + resolved.ms + ' ms' + (resolved.host ? ' (' + resolved.host + ')' : ''));
                pass(load, resolved.url);
                entry.queue.forEach((action) => video.dispatch(action));
            }).catch((error) => {
                if (log) log.warn('[webos] player: load after the final URL failed: ' + ((error && error.message) || error));
            });
        };

        this.on = function(eventName, listener) {
            if (destroyed) throw new Error('Video is destroyed');
            if (eventName === 'propValue' || eventName === 'propChanged') {
                video.on(eventName, (propName, propValue) => listener(propName, propName === 'stream' ? mapStream(propValue) : propValue));
                return;
            }
            if (eventName === 'error') {
                video.on(eventName, (error) => listener(error && error.stream ? Object.assign({}, error, { stream: mapStream(error.stream) }) : error));
                return;
            }
            video.on(eventName, listener);
        };

        this.dispatch = function(action) {
            if (destroyed) throw new Error('Video is destroyed');
            if (isCommand(action, 'load') || isCommand(action, 'unload') || isCommand(action, 'destroy')) {
                pending = null;
                if (isCommand(action, 'destroy')) destroyed = true;
                if (isCommand(action, 'load') && urlOfLoad(action) !== null) {
                    startLoad(action);
                    return;
                }
                video.dispatch(action);
                return;
            }
            if (pending !== null && !(action && action.type === 'observeProp')) {
                pending.queue.push(action);
                return;
            }
            video.dispatch(action);
        };
    }

    VideoWithFinalUrl.canPlayStream = Video.canPlayStream;
    VideoWithFinalUrl.manifest = Video.manifest;

    return VideoWithFinalUrl;
};

// Whether the localStorage key leaves the feature on. storage: localStorage-like, or null.
const readFinalUrlSetting = (storage) => {
    try {
        return !storage || storage.getItem(FINAL_URL_KEY) !== 'off';
    } catch (_error) {
        return true;
    }
};

module.exports = {
    withFinalUrl,
    readFinalUrlSetting,
    FINAL_URL_KEY,
};
