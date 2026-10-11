// Decorator of stremio-video's WebOsVideo (F5.6): stream switches that do not wedge the media
// pipeline, one pipeline per load, and a load that never starts turns into an error instead of an
// endless spinner. Wired in under withC8Tracks by webos/lib/tracks/WebOsVideo.js. Measurements and
// reasons: README.md, "Trocas de stream".
//
// 1. Quiet release. WebOsVideo releases the pipeline (removeAttribute('src') + load()) while the
//    video plays: on unload, on destroy and when a load replaces a stream. In the emulator, tearing
//    down a pipeline that is rendering wedges the next one for the rest of the boot. The guard
//    pauses the element first and releases it RELEASE_SETTLE_MS later (at once if the video was
//    already paused or ended that long ago); actions dispatched meanwhile wait and run in order.
//    A load starts only after the releases in progress of every guarded video of the page (a stream
//    switch remounts the Player: the new <video> loads while the old one is still settling) and no
//    sooner than LOAD_GAP_MS after the last one, so two pipelines never overlap.
// 2. One pipeline per load. WebOsVideo sets `src` (which already starts the load) and, when the
//    mediaId shows up 0.3 to 1.5 s later, calls videoElement.load() again, which tears down the
//    pipeline that is starting and creates another one (a second GET to the stream). load() while
//    the element has a `src` is that call only (WebOsVideo's unload removes the `src` before its
//    load()), so it is dropped.
// 3. Start watchdog. No `loadedmetadata` START_TIMEOUT_MS after a load: one controlled reload of the
//    same stream (quiet release, `src` set again; WebOsVideo keeps the stream and the start time),
//    and after START_RETRIES of them a critical STREAM_FAILED_TO_LOAD error, which the Player shows
//    like any other stream error. A pipeline already wedged in the emulator does not recover (the
//    state outlives the app); the reload is for a start that hangs once, which only the TV can show.
// The localStorage key `webos.pipelineGuard` = "off" leaves WebOsVideo as it is (A/B in the emulator,
// and a way out if the TV disagrees in Phase 8); read once, when the app starts.

const ERROR = require('@stremio/stremio-video/src/error');

const RELEASE_SETTLE_MS = 1000;
const LOAD_GAP_MS = 0;
const START_TIMEOUT_MS = 20000;
const START_RETRIES = 1;

const GUARD_KEY = 'webos.pipelineGuard';

// A load waiting for another video's release checks again this often.
const WAIT_STEP_MS = 50;
// A release counted as in progress for longer than this past its due time is dropped from the count.
const STALE_RELEASE_MS = 5000;

const PIPELINE_COMMANDS = ['load', 'unload', 'destroy'];
const UNLOAD = Object.freeze({ type: 'command', commandName: 'unload' });

// deps (all optional): log (console-like), now, setTimeout, clearTimeout, shared (state shared by the guarded videos),
// releaseSettleMs, loadGapMs, startTimeoutMs, startRetries.
const withPipelineGuard = (Video, deps) => {
    deps = deps || {};
    const log = deps.log || null;
    const now = deps.now || Date.now;
    const schedule = deps.setTimeout || setTimeout;
    const cancel = deps.clearTimeout || clearTimeout;
    const option = (name, fallback) => typeof deps[name] === 'number' ? deps[name] : fallback;
    const releaseSettleMs = option('releaseSettleMs', RELEASE_SETTLE_MS);
    const loadGapMs = option('loadGapMs', LOAD_GAP_MS);
    const startTimeoutMs = option('startTimeoutMs', START_TIMEOUT_MS);
    const startRetries = option('startRetries', START_RETRIES);
    // Every guarded video of the page: releases in progress, when they are due, and when the last
    // pipeline was released.
    const shared = deps.shared || { releasing: 0, releasingUntil: -Infinity, releasedAt: -Infinity };

    // How long a load has to wait for the other videos' releases (0: it can start).
    const loadWait = () => {
        if (shared.releasing > 0 && now() > shared.releasingUntil + STALE_RELEASE_MS) shared.releasing = 0;
        if (shared.releasing > 0) return Math.max(shared.releasingUntil - now(), 0) + WAIT_STEP_MS;
        return Math.max(shared.releasedAt + loadGapMs - now(), 0);
    };

    function VideoWithPipelineGuard(options) {
        const video = new Video(options);
        const videoElements = options.containerElement.querySelectorAll('video');
        const videoElement = videoElements.length ? videoElements[videoElements.length - 1] : null;
        const errorListeners = [];
        // The outer API is destroyed at once; the inner video may still be waiting for its release.
        let destroyed = false;
        let innerDestroyed = false;
        // Actions waiting for a release in progress, or null.
        let held = null;
        let holdTimer = null;
        // This video counts in shared.releasing until its release runs.
        let releasing = false;
        // Since when the video is paused or ended (null while it plays).
        let quietSince = null;
        let stream = null;
        let loadedAt = 0;
        let retries = 0;
        let watchdog = null;
        let droppedLoads = 0;

        const info = (message) => {
            if (log) log.info('[webos] player: ' + message);
        };
        const warn = (message) => {
            if (log) log.warn('[webos] player: ' + message);
        };

        const hasPipeline = () => videoElement !== null && videoElement.hasAttribute('src');
        const nativeLoad = videoElement ? videoElement.load : null;
        if (videoElement) {
            videoElement.load = function() {
                if (this.hasAttribute('src')) {
                    droppedLoads++;
                    return;
                }
                return nativeLoad.apply(this, arguments);
            };
        }
        const play = () => {
            const playing = videoElement.play();
            // Chromium 53 returns a promise, rejected when the load is replaced in turn.
            if (playing && typeof playing.catch === 'function') playing.catch(() => { /* superseded */ });
        };

        const clearWatchdog = () => {
            if (watchdog !== null) cancel(watchdog);
            watchdog = null;
        };
        const armWatchdog = () => {
            clearWatchdog();
            watchdog = schedule(onStartTimeout, startTimeoutMs);
        };

        // Pauses the element and says how long to wait before the pipeline can go.
        const settle = () => {
            if (!videoElement.paused) videoElement.pause();
            if (quietSince === null) quietSince = now();
            return Math.max(0, quietSince + releaseSettleMs - now());
        };

        const hold = (entries, delay) => {
            held = entries.concat(held || []);
            if (holdTimer !== null) cancel(holdTimer);
            holdTimer = schedule(flush, delay);
        };
        function flush() {
            holdTimer = null;
            const pending = held || [];
            held = null;
            for (let i = 0; i < pending.length; i++) {
                if (held !== null) {
                    // An entry started another wait: the rest goes after it.
                    held = held.concat(pending.slice(i));
                    return;
                }
                run(pending[i].action, pending[i].quiet);
            }
        }

        function onStartTimeout() {
            watchdog = null;
            if (innerDestroyed || stream === null || videoElement === null) return;
            const seconds = Math.round((now() - loadedAt) / 1000);
            if (retries >= startRetries) {
                warn('no loadedmetadata ' + seconds + ' s after the load, after ' + retries + ' reload(s): stream failed to load');
                const failed = stream;
                stream = null;
                const error = Object.assign({}, ERROR.STREAM_FAILED_TO_LOAD, { critical: true, stream: failed });
                errorListeners.slice().forEach((listener) => listener(error));
                if (!destroyed) dispatch(UNLOAD);
                return;
            }
            retries++;
            warn('no loadedmetadata ' + seconds + ' s after the load (readyState ' + videoElement.readyState + ', networkState ' +
                videoElement.networkState + '): reloading the stream (' + retries + '/' + startRetries + ')');
            const retried = stream;
            const reload = () => {
                if (innerDestroyed || stream !== retried) return;
                videoElement.removeAttribute('src');
                nativeLoad.call(videoElement);
                shared.releasedAt = now();
                const start = () => {
                    if (innerDestroyed || stream !== retried) return;
                    videoElement.src = retried.url;
                    play();
                    armWatchdog();
                };
                if (loadGapMs > 0) schedule(start, loadGapMs);
                else start();
            };
            const delay = settle();
            if (delay > 0) schedule(reload, delay);
            else reload();
        }

        const onStarted = () => {
            if (stream === null || watchdog === null) return;
            clearWatchdog();
            info('loadedmetadata ' + (now() - loadedAt) + ' ms after the load' +
                (retries ? ', after ' + retries + ' reload(s)' : '') + '; repeated load() calls dropped: ' + droppedLoads);
        };
        const onQuiet = () => {
            if (quietSince === null) quietSince = now();
        };
        const onPlay = () => {
            quietSince = null;
        };
        const onElementError = () => {
            clearWatchdog();
        };
        const ELEMENT_LISTENERS = [
            ['loadedmetadata', onStarted],
            ['pause', onQuiet],
            ['ended', onQuiet],
            ['play', onPlay],
            ['playing', onPlay],
            ['error', onElementError],
        ];
        if (videoElement) {
            ELEMENT_LISTENERS.forEach(([eventName, listener]) => videoElement.addEventListener(eventName, listener));
        }

        // quiet: the pipeline was already paused long enough (or this is the release itself).
        function run(action, quiet) {
            const command = action && action.type === 'command' ? action.commandName : null;
            if (PIPELINE_COMMANDS.indexOf(command) !== -1) {
                clearWatchdog();
                stream = null;
                if (hasPipeline() && !quiet) {
                    const delay = settle();
                    if (delay > 0) {
                        const entries = command === 'load' ? [{ action: UNLOAD, quiet: true }] : [];
                        if (!releasing) {
                            releasing = true;
                            shared.releasing++;
                        }
                        shared.releasingUntil = Math.max(shared.releasingUntil, now() + delay);
                        hold(entries.concat({ action, quiet: true }), delay);
                        return;
                    }
                }
                if (command === 'load' && hasPipeline()) {
                    // A load over a stream: release it first, like the Player's own unload.
                    run(UNLOAD, true);
                }
                if (command !== 'load' && hasPipeline()) shared.releasedAt = now();
                if (command !== 'load' && releasing) {
                    releasing = false;
                    shared.releasing = Math.max(0, shared.releasing - 1);
                }
                const wait = command === 'load' ? loadWait() : 0;
                if (wait > 0) {
                    hold([{ action, quiet: true }], wait);
                    return;
                }
            }
            if (command === 'destroy') {
                innerDestroyed = true;
                if (holdTimer !== null) cancel(holdTimer);
                holdTimer = null;
                held = null;
                if (videoElement) {
                    ELEMENT_LISTENERS.forEach(([eventName, listener]) => videoElement.removeEventListener(eventName, listener));
                }
            }
            video.dispatch(action);
            if (command === 'destroy' && videoElement) {
                // The element is out of the page now; give it its own load() back.
                delete videoElement.load;
            }
            const args = command === 'load' ? action.commandArgs || {} : null;
            if (args && args.stream && typeof args.stream.url === 'string' && hasPipeline()) {
                stream = args.stream;
                loadedAt = now();
                retries = 0;
                droppedLoads = 0;
                quietSince = null;
                armWatchdog();
            }
        }

        function dispatch(action) {
            if (held !== null) {
                held.push({ action, quiet: false });
                return;
            }
            run(action, false);
        }

        this.on = function(eventName, listener) {
            if (destroyed) throw new Error('Video is destroyed');
            if (eventName === 'error') errorListeners.push(listener);
            video.on(eventName, listener);
        };

        this.dispatch = function(action) {
            if (destroyed) throw new Error('Video is destroyed');
            if (action && action.type === 'command' && action.commandName === 'destroy') destroyed = true;
            dispatch(action);
        };
    }

    VideoWithPipelineGuard.canPlayStream = Video.canPlayStream;
    VideoWithPipelineGuard.manifest = Video.manifest;

    return VideoWithPipelineGuard;
};

// storage: localStorage-like, or null.
const pipelineGuardEnabled = (storage) => {
    try {
        return !storage || storage.getItem(GUARD_KEY) !== 'off';
    } catch (_error) {
        return true;
    }
};

module.exports = { withPipelineGuard, pipelineGuardEnabled, GUARD_KEY, RELEASE_SETTLE_MS, LOAD_GAP_MS, START_TIMEOUT_MS, START_RETRIES };
