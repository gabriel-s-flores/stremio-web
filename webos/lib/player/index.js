// webOS player settings (F5.1): what the app's Player sends to stremio-video on the TV and the
// helper the ControlBar override uses to drop the speed button. API and reasons: see README.md.

// No transcoding (there is no streaming server, P3) and every audio channel goes to the TV, which
// downmixes to its own speakers (P2): the same as the upstream "surround sound" setting turned on.
const WEBOS_LOAD_ARGS = Object.freeze({
    forceTranscoding: false,
    streamingServerURL: null,
    maxAudioChannels: 32,
});

// Playback rates other than 1x play without sound on the C8, so the app keeps the native rate.
const PLAYBACK_SPEED_SUPPORTED = false;
// The rate the TV plays at. The Player state reports no speed (null), but the seek bar divides the
// remaining time by the speed, so the control bar gets this value instead.
const NATIVE_PLAYBACK_SPEED = 1;

const toWebOsLoadArgs = (args) => Object.assign({}, args, WEBOS_LOAD_ARGS);

// Returns `element` without the descendants matching `predicate`, cloning only the elements on the
// way to a removed one (everything else keeps its identity). `React` is injected for the tests.
const removeElements = (React, element, predicate) => {
    const visit = (node) => {
        if (!React.isValidElement(node)) return node;
        if (predicate(node)) return null;
        const children = node.props.children;
        if (children === undefined || typeof children === 'function') return node;
        let changed = false;
        const next = React.Children.map(children, (child) => {
            const result = visit(child);
            if (result !== child) changed = true;
            return result;
        });
        return changed ? React.cloneElement(node, undefined, next) : node;
    };
    return visit(element);
};

module.exports = {
    WEBOS_LOAD_ARGS,
    PLAYBACK_SPEED_SUPPORTED,
    NATIVE_PLAYBACK_SPEED,
    toWebOsLoadArgs,
    removeElements,
};
