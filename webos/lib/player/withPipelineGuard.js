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
//    An embedded subtitle selection makes WebOsVideo call Luna selectTrack 500 ms later with the
//    element's mediaId of that moment: the release also waits SUBTITLE_SELECT_SETTLE_MS after the
//    last selection, so that call reaches the pipeline it was meant for, never the next one.
//    The Player unmounts on a stream switch, and React takes its nodes out of the page before the
//    destroy arrives (a passive effect): a <video> leaving the document (or moved in it) has its
//    pipeline torn down at once, paused or not, unless it was paused for about a second. So
//    holdVideosInPlace(), called by useVideo.webos.js in a layout effect cleanup (it runs before
//    React removes the nodes), pauses the guarded <video> and makes the removal of the node that
//    holds it wait: that node stays where it is, hidden, until LEAVE_DELAY_MS later, after the
//    guard released the pipeline in place.
//    A load starts only after the releases in progress of every guarded video of the page (a stream
//    switch remounts the Player: the new <video> loads while the old one is still settling) and no
//    sooner than LOAD_GAP_MS after the last one, so two pipelines never overlap.
// 2. One pipeline per load. WebOsVideo sets `src` (which already starts the load) and, when the
//    mediaId shows up 0.3 to 1.5 s later, calls videoElement.load() again, which tears down the
//    pipeline that is starting and creates another one (a second GET to the stream). load() while
//    the element has a `src` is that call only (WebOsVideo's unload removes the `src` before its
//    load()), so it is dropped.
// 3. Start watchdog. A load that shows no sign of life for START_TIMEOUT_MS (no loadstart, progress
//    or durationchange, and no loadedmetadata) becomes a critical STREAM_FAILED_TO_LOAD error, which
//    the Player shows like any other stream error (the F6.3 error layer adds the link diagnosis).
//    Every sign of progress restarts the time, the time stops while the app is hidden, and nothing is
//    aborted before the error: a slow link (a debrid resolve answering the 302 late) keeps its request.
//    A wedged pipeline in the emulator does not recover anyway (the state outlives the app).
// 4. Display window (F5.6b). In the emulator, a load after the first one of the page can play with a
//    black screen: the pipeline decodes (the clock moves) but the video plane never gets the place of
//    the <video> on the screen, which goes to the pipeline only when the element's geometry changes,
//    and the new <video> takes exactly the place of the previous one. What sets it off depends on the
//    flow: leaving the Player for another stream, it is the quiet release of 1 above (without it the
//    picture shows); on an immediate route switch, it happens without the guard too. At the first
//    `playing` of each load the guard narrows the element by DISPLAY_NUDGE_PX for DISPLAY_NUDGE_MS and
//    puts it back, which sends the place again to the pipeline that is playing (both flows).
// localStorage keys (read once, when the app starts; A/B in the emulator and a way out in Phase 8):
//   webos.pipelineGuard = "off"            WebOsVideo as it is (all of the above off)
//   webos.pipelineGuard.extraLoad = "keep" keep WebOsVideo's second load() (2 above)
//   webos.pipelineGuard.watchdog = "off"   no start watchdog (3 above)
//   webos.pipelineGuard.quietRelease = "off"  release at once, as WebOsVideo does (1 above, F5.6b A/B)
//   webos.pipelineGuard.holdInPlace = "off"   the Player's nodes leave at once (holdVideosInPlace, F5.6b A/B)
//   webos.pipelineGuard.displayNudge = "off"  no geometry change at the start of a load (4 above)

const ERROR = require('@stremio/stremio-video/src/error');

const RELEASE_SETTLE_MS = 1000;
const LOAD_GAP_MS = 0;
// WebOsVideo's selectTrack delay (500 ms) and a margin.
const SUBTITLE_SELECT_SETTLE_MS = 600;
// Without any sign of progress for this long, a load is a failed one.
const START_TIMEOUT_MS = 60000;
// The element events that show a load is alive.
const PROGRESS_EVENTS = ['loadstart', 'progress', 'durationchange'];

const GUARD_KEY = 'webos.pipelineGuard';
const EXTRA_LOAD_KEY = 'webos.pipelineGuard.extraLoad';
const WATCHDOG_KEY = 'webos.pipelineGuard.watchdog';
const QUIET_RELEASE_KEY = 'webos.pipelineGuard.quietRelease';
const HOLD_KEY = 'webos.pipelineGuard.holdInPlace';
const DISPLAY_NUDGE_KEY = 'webos.pipelineGuard.displayNudge';

// The geometry change that sends the <video>'s place to its pipeline again (4 above).
const DISPLAY_NUDGE_PX = 2;
const DISPLAY_NUDGE_MS = 250;

// A load waiting for another video's release checks again this often.
const WAIT_STEP_MS = 50;
// A release counted as in progress for longer than this past its due time is dropped from the count.
const STALE_RELEASE_MS = 5000;

// The node React removes when the Player goes away stays in place (hidden) this long: the guard
// releases the pipeline RELEASE_SETTLE_MS after the pause, in place, and only then it leaves.
const LEAVE_DELAY_MS = RELEASE_SETTLE_MS + 500;

// The <video> elements of guarded videos, with their container.
const guardedElements = new WeakMap();

// Pauses the guarded <video> elements of `containerElement` that still have a pipeline, and delays
// the removal of whichever ancestor React removes next (the Player's nodes, on unmount): it is
// hidden at once and taken out LEAVE_DELAY_MS later. The interception is one-off per ancestor and
// undone after LEAVE_DELAY_MS if React removes nothing. deps (tests): setTimeout.
const holdVideosInPlace = (containerElement, deps) => {
    const schedule = (deps && deps.setTimeout) || setTimeout;
    if (!containerElement) return 0;
    const videos = Array.prototype.slice.call(containerElement.querySelectorAll('video'))
        .filter((element) => guardedElements.get(element) === containerElement && element.hasAttribute('src'));
    if (videos.length === 0) return 0;
    videos.forEach((element) => {
        if (!element.paused) element.pause();
    });
    const patched = [];
    const restore = () => {
        patched.splice(0).forEach((parent) => {
            delete parent.removeChild;
        });
    };
    for (let node = containerElement; node && node.parentNode; node = node.parentNode) {
        const parent = node.parentNode;
        if (Object.prototype.hasOwnProperty.call(parent, 'removeChild')) continue;
        const held = node;
        parent.removeChild = function(child) {
            if (child !== held) return Object.getPrototypeOf(parent).removeChild.call(parent, child);
            restore();
            child.style.display = 'none';
            schedule(() => {
                if (child.parentNode === parent) Object.getPrototypeOf(parent).removeChild.call(parent, child);
            }, LEAVE_DELAY_MS);
            return child;
        };
        patched.push(parent);
    }
    schedule(restore, LEAVE_DELAY_MS);
    return videos.length;
};

const PIPELINE_COMMANDS = ['load', 'unload', 'destroy'];
const UNLOAD = Object.freeze({ type: 'command', commandName: 'unload' });

// deps (all optional): log (console-like), now, setTimeout, clearTimeout, document (visibility),
// shared (state shared by the guarded videos), releaseSettleMs, loadGapMs, startTimeoutMs,
// dropExtraLoad (default true), watchdog (default true), holdInPlace (default true: holdVideosInPlace
// holds this video's nodes), displayNudge (default true).
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
    const dropExtraLoad = deps.dropExtraLoad !== false;
    const useWatchdog = deps.watchdog !== false;
    const holdInPlace = deps.holdInPlace !== false;
    const displayNudge = deps.displayNudge !== false;
    const doc = deps.document || (typeof document !== 'undefined' ? document : null);
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
        // When the last subtitle selection went to WebOsVideo.
        let subtitlesSelectedAt = -Infinity;
        let stream = null;
        let loadedAt = 0;
        // Between a load and its loadedmetadata.
        let starting = false;
        let watchdog = null;
        let droppedLoads = 0;
        // A load whose first `playing` still has to send the element's place to the pipeline.
        let nudgePending = false;
        let nudgeTimer = null;

        const info = (message) => {
            if (log) log.info('[webos] player: ' + message);
        };
        const warn = (message) => {
            if (log) log.warn('[webos] player: ' + message);
        };

        const hasPipeline = () => videoElement !== null && videoElement.hasAttribute('src');
        const nativeLoad = videoElement ? videoElement.load : null;
        if (videoElement) {
            if (holdInPlace) guardedElements.set(videoElement, options.containerElement);
            videoElement.load = function() {
                if (dropExtraLoad && this.hasAttribute('src')) {
                    droppedLoads++;
                    return;
                }
                return nativeLoad.apply(this, arguments);
            };
        }
        const clearWatchdog = () => {
            if (watchdog !== null) cancel(watchdog);
            watchdog = null;
        };
        const armWatchdog = () => {
            clearWatchdog();
            if (!useWatchdog || !starting || (doc && doc.hidden)) return;
            watchdog = schedule(onStartTimeout, startTimeoutMs);
        };

        // Pauses the element and says how long to wait before the pipeline can go. With releaseSettleMs
        // 0 (the A/B key) the element is not paused: only a subtitle selection is waited for.
        const settle = () => {
            if (releaseSettleMs > 0 && !videoElement.paused) videoElement.pause();
            if (quietSince === null) quietSince = now();
            return Math.max(0, quietSince + releaseSettleMs - now(), subtitlesSelectedAt + SUBTITLE_SELECT_SETTLE_MS - now());
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
            if (innerDestroyed || stream === null || videoElement === null || !starting) return;
            warn('no sign of the load for ' + Math.round(startTimeoutMs / 1000) + ' s (readyState ' + videoElement.readyState +
                ', networkState ' + videoElement.networkState + ', ' + Math.round((now() - loadedAt) / 1000) +
                ' s after the load): stream failed to load');
            const failed = stream;
            stream = null;
            starting = false;
            const error = Object.assign({}, ERROR.STREAM_FAILED_TO_LOAD, { critical: true, stream: failed });
            errorListeners.slice().forEach((listener) => listener(error));
            if (!destroyed) dispatch(UNLOAD);
        }

        const onStarted = () => {
            if (stream === null || !starting) return;
            starting = false;
            clearWatchdog();
            info('loadedmetadata ' + (now() - loadedAt) + ' ms after the load; repeated load() calls dropped: ' + droppedLoads);
        };
        // A sign of life: the time starts again.
        const onProgress = () => {
            if (starting && watchdog !== null) armWatchdog();
        };
        const onVisibility = () => {
            if (!starting) return;
            if (doc.hidden) clearWatchdog();
            else armWatchdog();
        };
        const onQuiet = () => {
            if (quietSince === null) quietSince = now();
        };
        const onPlay = () => {
            quietSince = null;
        };
        const onPlaying = () => {
            onPlay();
            if (!nudgePending) return;
            nudgePending = false;
            const width = videoElement.style.width;
            videoElement.style.width = 'calc(' + (width || '100%') + ' - ' + DISPLAY_NUDGE_PX + 'px)';
            nudgeTimer = schedule(() => {
                nudgeTimer = null;
                videoElement.style.width = width;
            }, DISPLAY_NUDGE_MS);
        };
        const onElementError = () => {
            starting = false;
            clearWatchdog();
        };
        const ELEMENT_LISTENERS = [
            ['loadedmetadata', onStarted],
            ['pause', onQuiet],
            ['ended', onQuiet],
            ['play', onPlay],
            ['playing', onPlaying],
            ['error', onElementError],
        ].concat(PROGRESS_EVENTS.map((eventName) => [eventName, onProgress]));
        if (videoElement) {
            ELEMENT_LISTENERS.forEach(([eventName, listener]) => videoElement.addEventListener(eventName, listener));
        }
        if (doc && useWatchdog) doc.addEventListener('visibilitychange', onVisibility);

        // quiet: the pipeline was already paused long enough (or this is the release itself).
        function run(action, quiet) {
            const command = action && action.type === 'command' ? action.commandName : null;
            if (PIPELINE_COMMANDS.indexOf(command) !== -1) {
                clearWatchdog();
                stream = null;
                starting = false;
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
                if (doc && useWatchdog) doc.removeEventListener('visibilitychange', onVisibility);
                if (nudgeTimer !== null) cancel(nudgeTimer);
                nudgeTimer = null;
            }
            if (action && action.type === 'setProp' && action.propName === 'selectedSubtitlesTrackId') subtitlesSelectedAt = now();
            video.dispatch(action);
            if (command === 'destroy' && videoElement) {
                // The element is out of the page now; give it its own load() back.
                delete videoElement.load;
            }
            const args = command === 'load' ? action.commandArgs || {} : null;
            if (args && args.stream && typeof args.stream.url === 'string' && hasPipeline()) {
                stream = args.stream;
                loadedAt = now();
                starting = true;
                droppedLoads = 0;
                quietSince = null;
                nudgePending = displayNudge;
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

const readKey = (storage, key) => {
    try {
        return storage ? storage.getItem(key) : null;
    } catch (_error) {
        return null;
    }
};

// What the localStorage keys turn on. storage: localStorage-like, or null.
const readGuardSettings = (storage) => ({
    enabled: readKey(storage, GUARD_KEY) !== 'off',
    dropExtraLoad: readKey(storage, EXTRA_LOAD_KEY) !== 'keep',
    watchdog: readKey(storage, WATCHDOG_KEY) !== 'off',
    quietRelease: readKey(storage, QUIET_RELEASE_KEY) !== 'off',
    holdInPlace: readKey(storage, HOLD_KEY) !== 'off',
    displayNudge: readKey(storage, DISPLAY_NUDGE_KEY) !== 'off',
});

module.exports = {
    withPipelineGuard,
    holdVideosInPlace,
    readGuardSettings,
    GUARD_KEY,
    EXTRA_LOAD_KEY,
    WATCHDOG_KEY,
    QUIET_RELEASE_KEY,
    HOLD_KEY,
    DISPLAY_NUDGE_KEY,
    DISPLAY_NUDGE_PX,
    DISPLAY_NUDGE_MS,
    LEAVE_DELAY_MS,
    SUBTITLE_SELECT_SETTLE_MS,
    RELEASE_SETTLE_MS,
    LOAD_GAP_MS,
    START_TIMEOUT_MS,
};
