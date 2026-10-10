// webOS TV 4.x build only (resolved instead of useVideo.js by webos/webpack/app.js, F5.1).
// Same hook, with the TV's load arguments (no transcoding, every audio channel: see
// webos/lib/player) and without playback speed: the state reports `playbackSpeed: null`, which the
// Player already reads as "no speed control" (speed menu, shortcuts), and speed changes are ignored
// (the C8 plays without sound at rates other than 1x).

const React = require('react');
// The explicit extension resolves to the upstream hook, not to this file.
const useUpstreamVideo = require('./useVideo.js');
const { PLAYBACK_SPEED_SUPPORTED, toWebOsLoadArgs } = require('../../../webos/lib/player');

// Keeps the native rate: setPlaybackSpeed(2) from the "hold for 2x" gesture does nothing.
const ignorePlaybackSpeed = () => { /* no-op */ };

const useVideo = () => {
    const video = useUpstreamVideo();
    const upstreamLoad = video.load;
    const load = React.useCallback((args, options) => {
        upstreamLoad(toWebOsLoadArgs(args), options);
    }, [upstreamLoad]);
    const state = React.useMemo(() => {
        return PLAYBACK_SPEED_SUPPORTED || video.state.playbackSpeed === null ?
            video.state
            :
            { ...video.state, playbackSpeed: null };
    }, [video.state]);

    return {
        ...video,
        state,
        load,
        setPlaybackSpeed: PLAYBACK_SPEED_SUPPORTED ? video.setPlaybackSpeed : ignorePlaybackSpeed,
    };
};

module.exports = useVideo;
