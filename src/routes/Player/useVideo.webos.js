// webOS TV 4.x build only (resolved instead of useVideo.js by webos/webpack/app.js, F5.1).
// Same hook, with the TV's load arguments (no transcoding, every audio channel: see
// webos/lib/player) and without playback speed: the state reports `playbackSpeed: null`, which the
// Player already reads as "no speed control" (speed menu, shortcuts), and speed changes are ignored
// (the C8 plays without sound at rates other than 1x). Add-on subtitles from hosts with a Let's
// Encrypt certificate go through the tlsproxy (F5.5, webos/lib/subtitles); the errors the Player
// receives (log, toast, error layer) have the token of those proxy URLs masked (F3.7b, webos/lib/redact),
// and the state shows the add-on's own subtitle URLs, not the proxy ones.
// The <video> stays in place until the pipeline guard releases it (F5.6, webos/lib/player/withPipelineGuard.js),
// and the stream being held or unloaded reports no time meanwhile (F5.7: the next episode started at the end).

const React = require('react');
// The explicit extension resolves to the upstream hook, not to this file.
const useUpstreamVideo = require('./useVideo.js');
const { PLAYBACK_SPEED_SUPPORTED, toWebOsLoadArgs } = require('../../../webos/lib/player');
const { proxifySubtitlesTracks, restoreSubtitlesTracksUrls } = require('../../../webos/lib/subtitles');
const tlsProxy = require('../../../webos/tlsproxy/page').default;
const { rememberStream } = require('../../../webos/lib/debrid-link');
const { holdVideosInPlace } = require('../../../webos/lib/player/withPipelineGuard');
const { withRedactedErrors } = require('../../../webos/lib/redact');

// Keeps the native rate: setPlaybackSpeed(2) from the "hold for 2x" gesture does nothing.
const ignorePlaybackSpeed = () => { /* no-op */ };

const useVideo = () => {
    const video = useUpstreamVideo();
    // The stream the Player is leaving (see `stale` below), and the current one for the callbacks.
    const streamRef = React.useRef(video.state.stream);
    streamRef.current = video.state.stream;
    const [leavingStream, setLeavingStream] = React.useState(null);
    // A layout effect cleanup runs before React takes the Player's nodes out of the page. It also runs
    // when the Player suspends on the stream of the next episode (withCoreSuspender, decodeStream):
    // the guard pauses the <video> right here, and the Player is not unloading it yet.
    React.useLayoutEffect(() => {
        const containerElement = video.containerRef ? video.containerRef.current : null;
        return () => {
            setLeavingStream(streamRef.current);
            holdVideosInPlace(containerElement);
        };
    }, [video.containerRef]);
    const upstreamLoad = video.load;
    const load = React.useCallback((args, options) => {
        // The Error layer reads it (F6.3): the Player state has no stream once the video unloaded.
        rememberStream(args && args.stream);
        const subtitles = args && args.stream ? args.stream.subtitles : undefined;
        const proxied = proxifySubtitlesTracks(subtitles, tlsProxy.proxify);
        const webOsArgs = proxied !== subtitles ? { ...args, stream: { ...args.stream, subtitles: proxied } } : args;
        upstreamLoad(toWebOsLoadArgs(webOsArgs), options);
    }, [upstreamLoad]);
    const upstreamAddExtraSubtitlesTracks = video.addExtraSubtitlesTracks;
    const addExtraSubtitlesTracks = React.useCallback((tracks) => {
        upstreamAddExtraSubtitlesTracks(proxifySubtitlesTracks(tracks, tlsProxy.proxify));
    }, [upstreamAddExtraSubtitlesTracks]);
    // The guard holds the <video> being left (paused) and unloads it about 1 s later (quiet release):
    // until then the state still has its time and duration, and the Player reports them as the time
    // of the next stream. On the next episode the core then keeps the 568 s of episode 1 as the
    // position of episode 2, which starts at its end (F5.7, measured in the emulator: the pause of
    // the hold sends one last timeupdate, and the Player's TimeChanged effect runs in the same commit
    // as its unload). From the hold or the unload on, and as long as the state shows that same
    // stream, it has no time, as right after an unload without the guard.
    const upstreamUnload = video.unload;
    const unload = React.useCallback(() => {
        setLeavingStream(streamRef.current);
        upstreamUnload();
    }, [upstreamUnload]);
    const stale = leavingStream !== null && video.state.stream === leavingStream;
    // The pipeline got the proxy URLs; the Player gets the ones the add-ons gave (F3.7b). Its own memo,
    // keyed on the tracks array only: the state changes at every timeupdate, the tracks do not.
    const extraSubtitlesTracks = React.useMemo(
        () => restoreSubtitlesTracksUrls(video.state.extraSubtitlesTracks),
        [video.state.extraSubtitlesTracks]
    );
    const state = React.useMemo(() => {
        const base = PLAYBACK_SPEED_SUPPORTED || video.state.playbackSpeed === null ?
            video.state
            :
            { ...video.state, playbackSpeed: null };
        const withTracks = extraSubtitlesTracks === base.extraSubtitlesTracks ? base : { ...base, extraSubtitlesTracks };
        return stale ? { ...withTracks, time: null, duration: null } : withTracks;
    }, [video.state, extraSubtitlesTracks, stale]);

    const events = React.useMemo(() => withRedactedErrors(video.events), [video.events]);

    return {
        ...video,
        events,
        state,
        load,
        unload,
        addExtraSubtitlesTracks,
        setPlaybackSpeed: PLAYBACK_SPEED_SUPPORTED ? video.setPlaybackSpeed : ignorePlaybackSpeed,
    };
};

module.exports = useVideo;
