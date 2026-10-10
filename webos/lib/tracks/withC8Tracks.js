// Decorator of stremio-video's WebOsVideo (F5.4): the audio and subtitle track props come from the
// header probe and the <video>'s audioTracks instead of the streaming server's /tracks (there is no
// server, P3), and the audio switch enables the chosen track and disables the others on the
// element. Everything else goes to WebOsVideo unchanged. Wired in by webos/webpack/player.js.

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

// deps.probeCache: { get(url) -> Promise }, deps.log (optional): console-like.
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
        // A switch asked before the element listed its tracks; applied when they show up.
        let pendingIndex = null;

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
                if (pendingIndex !== null && enableOnly(videoElement, pendingIndex)) {
                    pendingIndex = null;
                    element = readElementTracks(videoElement);
                }
                const enabled = enabledIndex(element);
                const selectedIndex = pendingIndex !== null ? pendingIndex : enabled;
                values.audioTracks = buildAudioTracks({ probe, rules, elementTracks: element, selectedIndex });
                values.selectedAudioTrackId = values.audioTracks.some((track) => track.index === selectedIndex) ?
                    trackId(selectedIndex) : null;
                values.subtitlesTracks = buildSubtitleTracks({ probe, rules });
            }
            OWN_PROPS.forEach(publish);
        };

        const onElementTracks = () => {
            if (!destroyed) refresh();
        };
        const elementTrackList = videoElement ? videoElement.audioTracks : null;
        if (elementTrackList && typeof elementTrackList.addEventListener === 'function') {
            ELEMENT_TRACK_EVENTS.forEach((eventName) => elementTrackList.addEventListener(eventName, onElementTracks));
        }
        if (videoElement) videoElement.addEventListener('loadedmetadata', onElementTracks);

        const startProbe = (url, id) => {
            const startedAt = Date.now();
            probeCache.get(url).then((result) => {
                if (destroyed || id !== loadId) return;
                probe = result;
                rules = evaluate({ probe: result, stream });
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
        };

        const selectAudioTrack = (id) => {
            const index = trackIndex(id);
            if (stream === null || index === null || !values.audioTracks.some((track) => track.index === index)) return;
            pendingIndex = enableOnly(videoElement, index) ? null : index;
            refresh();
            const selected = values.audioTracks.filter((track) => track.index === index)[0];
            if (log) log.info('[webos] tracks: audio ' + id + (pendingIndex !== null ? ' (pending)' : '') + ', enabled: ' + JSON.stringify(readElementTracks(videoElement).map((track) => track.enabled)));
            if (selected) emit('audioTrackLoaded', selected);
        };

        const reset = () => {
            loadId++;
            stream = null;
            probe = null;
            rules = null;
            pendingIndex = null;
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
            if (action && action.type === 'command' && action.commandName === 'destroy') {
                destroyed = true;
                if (elementTrackList && typeof elementTrackList.removeEventListener === 'function') {
                    ELEMENT_TRACK_EVENTS.forEach((eventName) => elementTrackList.removeEventListener(eventName, onElementTracks));
                }
                if (videoElement) videoElement.removeEventListener('loadedmetadata', onElementTracks);
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
                    startProbe(stream.url, loadId);
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
