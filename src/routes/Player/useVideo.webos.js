// webOS TV 4.x build only (resolved instead of useVideo.js by webos/webpack/app.js, F5.1).
// Same hook, with the TV's load arguments (no transcoding, every audio channel: see
// webos/lib/player) and without playback speed: the state reports `playbackSpeed: null`, which the
// Player already reads as "no speed control" (speed menu, shortcuts), and speed changes are ignored
// (the C8 plays without sound at rates other than 1x). Add-on subtitles from hosts with a Let's
// Encrypt certificate go through the tlsproxy (F5.5, webos/lib/subtitles); the errors the Player
// receives (log, toast, error layer) have the token of those proxy URLs masked (F3.7b, webos/lib/redact),
// and the state shows the add-on's own subtitle URLs, not the proxy ones.
// The <video> stays in place until the pipeline guard releases it (F5.6, webos/lib/player/withPipelineGuard.js).

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
    // A layout effect cleanup runs before React takes the Player's nodes out of the page.
    React.useLayoutEffect(() => {
        const containerElement = video.containerRef ? video.containerRef.current : null;
        return () => {
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
    const state = React.useMemo(() => {
        const base = PLAYBACK_SPEED_SUPPORTED || video.state.playbackSpeed === null ?
            video.state
            :
            { ...video.state, playbackSpeed: null };
        // The pipeline got the proxy URLs; the Player gets the ones the add-ons gave (F3.7b).
        const extraSubtitlesTracks = restoreSubtitlesTracksUrls(base.extraSubtitlesTracks);
        return extraSubtitlesTracks === base.extraSubtitlesTracks ? base : { ...base, extraSubtitlesTracks };
    }, [video.state]);

    const events = React.useMemo(() => withRedactedErrors(video.events), [video.events]);

    return {
        ...video,
        events,
        state,
        load,
        addExtraSubtitlesTracks,
        setPlaybackSpeed: PLAYBACK_SPEED_SUPPORTED ? video.setPlaybackSpeed : ignorePlaybackSpeed,
    };
};

module.exports = useVideo;
