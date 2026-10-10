// Decorator of stremio-video's WebOsVideo (F5.4): the audio and subtitle track props come from the
// header probe and the <video>'s audioTracks instead of the streaming server's /tracks (there is no
// server, P3), and the audio switch enables the chosen track and disables the others on the
// element. Everything else goes to WebOsVideo unchanged. Wired in by webos/webpack/player.js.
// The probe starts right after WebOsVideo's load and does not hold it, and is cancelled when the
// stream goes away. Nothing touches the pipeline before the video plays: an audio switch asked
// earlier waits for the first `playing`, and the embedded subtitles are listed only then.
// Embedded subtitles are listed only, until F5.5: selecting one (the Player does it on its own for
// the subtitles language of the settings) is dropped here, so WebOsVideo does not turn them on
// through Luna while the menu says OFF. null and the add-on subtitles pass through.
// TODO(F5.5): remove the EMBEDDED_ subtitle interception when the embedded subtitles are shown.

const {
    trackId,
    trackIndex,
    readElementTracks,
    enabledIndex,
    buildAudioTracks,
    buildSubtitleTracks,
} = require('./index');
const { evaluate } = require('../c8-rules');

const OWN_PROPS = ['audioTracks', 'selectedAudioTrackId', 'subtitlesTracks'];
const EMBEDDED_PREFIX = 'EMBEDDED_';
const ELEMENT_TRACK_EVENTS = ['addtrack', 'removetrack', 'change'];

// Enables audioTracks[index] and then disables the others (in that order, so the pipeline never
// has a moment without audio). Tracks already in the right state are not touched. false when the
// element does not have that track (yet).
const enableOnly = (videoElement, index) => {
    const list = videoElement ? videoElement.audioTracks : null;
    if (!list || index >= list.length) return false;
    if (!list[index].enabled) list[index].enabled = true;
    for (let i = 0; i < list.length; i++) {
        if (i !== index && list[i].enabled) list[i].enabled = false;
    }
    return true;
};

// deps.probeCache: { get(url) -> Promise, peek(url) -> result | null, cancel(url) }, deps.log (optional): console-like.
const withC8Tracks = (Video, deps) => {
    const probeCache = deps.probeCache;
    const log = deps.log || null;

    function VideoWithC8Tracks(options) {
        const video = new Video(options);
        const containerElement = options.containerElement;
        const videoElement = containerElement.querySelector('video');
        const listeners = {};
        const observed = {};
        const values = { audioTracks: [], selectedAudioTrackId: null, subtitlesTracks: [] };
        const sent = {};
        let destroyed = false;
        let stream = null;
        let loadId = 0;
        let probe = null;
        let rules = null;
        // The video played since the load (first `playing`).
        let started = false;
        // A switch asked before the video played or before the element listed its tracks.
        let pendingIndex = null;
        let pendingWarned = false;

        const emit = function(eventName) {
            const args = Array.prototype.slice.call(arguments, 1);
            (listeners[eventName] || []).slice().forEach((listener) => {
                listener.apply(null, args);
            });
        };

        const publish = (propName) => {
            const serialized = JSON.stringify(values[propName]);
            if (observed[propName] && sent[propName] !== serialized) {
                sent[propName] = serialized;
                emit('propChanged', propName, values[propName]);
            }
        };

        const refresh = () => {
            if (stream === null) {
                values.audioTracks = [];
                values.selectedAudioTrackId = null;
                values.subtitlesTracks = [];
            } else {
                let element = readElementTracks(videoElement);
                if (pendingIndex !== null && started && enableOnly(videoElement, pendingIndex)) {
                    pendingIndex = null;
                    element = readElementTracks(videoElement);
                }
                const enabled = enabledIndex(element);
                const selectedIndex = pendingIndex !== null ? pendingIndex : enabled;
                values.audioTracks = buildAudioTracks({ probe, rules, elementTracks: element, selectedIndex });
                values.selectedAudioTrackId = values.audioTracks.some((track) => track.index === selectedIndex) ?
                    trackId(selectedIndex) : null;
                values.subtitlesTracks = started ? buildSubtitleTracks({ probe, rules }) : [];
            }
            OWN_PROPS.forEach(publish);
            // Playing, and the element still has no such track (no video.audioTracks on this TV?).
            if (started && pendingIndex !== null && !pendingWarned && log) {
                pendingWarned = true;
                log.warn('[webos] tracks: audio ' + trackId(pendingIndex) + ' still pending after playing: video.audioTracks lists ' +
                    readElementTracks(videoElement).length + ' track(s)');
            }
        };

        const onElementTracks = () => {
            if (!destroyed) refresh();
        };
        const elementTrackList = videoElement ? videoElement.audioTracks : null;
        if (elementTrackList && typeof elementTrackList.addEventListener === 'function') {
            ELEMENT_TRACK_EVENTS.forEach((eventName) => elementTrackList.addEventListener(eventName, onElementTracks));
        }
        const onPlaying = () => {
            if (destroyed || started || stream === null) return;
            started = true;
            refresh();
        };
        if (videoElement) {
            videoElement.addEventListener('loadedmetadata', onElementTracks);
            videoElement.addEventListener('playing', onPlaying);
        }

        const useProbe = (result) => {
            probe = result;
            rules = evaluate({ probe: result, stream });
        };

        function startProbe(url, id) {
            const startedAt = Date.now();
            probeCache.get(url).then((result) => {
                if (destroyed || id !== loadId) return;
                useProbe(result);
                if (log) {
                    log.info('[webos] tracks: probe ' + result.container + ', ' + result.summary.audioTracks + ' audio, ' +
                        result.summary.subtitleTracks + ' subtitles, ' + (Date.now() - startedAt) + ' ms');
                }
                refresh();
            }, (error) => {
                if (destroyed || id !== loadId) return;
                // The element's own list (language only) stays.
                if (log) log.warn('[webos] tracks: probe failed (' + ((error && error.code) || error) + '), using video.audioTracks');
            });
        }

        const selectAudioTrack = (id) => {
            const index = trackIndex(id);
            if (stream === null || index === null || !values.audioTracks.some((track) => track.index === index)) return;
            pendingIndex = started && enableOnly(videoElement, index) ? null : index;
            refresh();
            const selected = values.audioTracks.filter((track) => track.index === index)[0];
            if (log) log.info('[webos] tracks: audio ' + id + (pendingIndex !== null ? ' (pending)' : '') + ', enabled: ' + JSON.stringify(readElementTracks(videoElement).map((track) => track.enabled)));
            if (selected) emit('audioTrackLoaded', selected);
        };

        const reset = () => {
            if (stream !== null && probe === null && typeof probeCache.cancel === 'function') probeCache.cancel(stream.url);
            loadId++;
            stream = null;
            probe = null;
            rules = null;
            started = false;
            pendingIndex = null;
            pendingWarned = false;
        };

        video.on('propValue', (propName, propValue) => {
            if (OWN_PROPS.indexOf(propName) === -1) emit('propValue', propName, propValue);
        });
        video.on('propChanged', (propName, propValue) => {
            if (OWN_PROPS.indexOf(propName) !== -1) return;
            // WebOsVideo unloads on its own after a critical error.
            if (propName === 'stream' && propValue === null && stream !== null) {
                reset();
                refresh();
            }
            emit('propChanged', propName, propValue);
        });
        Video.manifest.events
            .filter((eventName) => ['propValue', 'propChanged', 'audioTrackLoaded'].indexOf(eventName) === -1)
            .forEach((eventName) => {
                video.on(eventName, function() {
                    emit.apply(null, [eventName].concat(Array.prototype.slice.call(arguments)));
                });
            });

        this.on = function(eventName, listener) {
            if (destroyed) throw new Error('Video is destroyed');
            listeners[eventName] = (listeners[eventName] || []).concat(listener);
        };

        this.dispatch = function(action) {
            if (destroyed) throw new Error('Video is destroyed');
            if (action && action.type === 'observeProp' && OWN_PROPS.indexOf(action.propName) !== -1) {
                observed[action.propName] = true;
                sent[action.propName] = JSON.stringify(values[action.propName]);
                emit('propValue', action.propName, values[action.propName]);
                return;
            }
            if (action && action.type === 'setProp' && action.propName === 'selectedAudioTrackId') {
                selectAudioTrack(action.propValue);
                return;
            }
            if (action && action.type === 'setProp' && action.propName === 'selectedSubtitlesTrackId' &&
                typeof action.propValue === 'string' && action.propValue.indexOf(EMBEDDED_PREFIX) === 0) {
                if (log) log.info('[webos] tracks: embedded subtitles ' + action.propValue + ' listed only (F5.5), not turned on');
                return;
            }
            if (action && action.type === 'command' && action.commandName === 'destroy') {
                reset();
                destroyed = true;
                if (elementTrackList && typeof elementTrackList.removeEventListener === 'function') {
                    ELEMENT_TRACK_EVENTS.forEach((eventName) => elementTrackList.removeEventListener(eventName, onElementTracks));
                }
                if (videoElement) {
                    videoElement.removeEventListener('loadedmetadata', onElementTracks);
                    videoElement.removeEventListener('playing', onPlaying);
                }
                video.dispatch(action);
                return;
            }
            video.dispatch(action);
            if (action && action.type === 'command' && action.commandName === 'unload') {
                reset();
                refresh();
            }
            if (action && action.type === 'command' && action.commandName === 'load') {
                const args = action.commandArgs || {};
                reset();
                if (args.stream && typeof args.stream.url === 'string') {
                    stream = args.stream;
                    // A probe already in the cache (same stream again, or the stream list probed
                    // it) is used at once; otherwise it runs next to the pipeline start.
                    const cached = probeCache.peek(stream.url);
                    if (cached) useProbe(cached);
                    else startProbe(stream.url, loadId);
                }
                refresh();
            }
        };
    }

    VideoWithC8Tracks.canPlayStream = Video.canPlayStream;
    VideoWithC8Tracks.manifest = Video.manifest;

    return VideoWithC8Tracks;
};

module.exports = withC8Tracks;
