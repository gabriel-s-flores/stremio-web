const invoke = (callback) => {
    if (typeof callback !== 'function') return false;
    callback();
    return true;
};

const invokeAll = (callbacks) => {
    if (callbacks.some((callback) => typeof callback !== 'function')) return false;
    callbacks.forEach((callback) => callback());
    return true;
};

const dispatchRemoteMediaKey = (key, state, actions) => {
    const playbackAvailable = !state.menusOpen && !state.nextVideoPopupOpen;

    switch (key) {
        case 'MediaPlay':
            return playbackAvailable && state.paused === true && invoke(actions.play);
        case 'MediaPause':
            return playbackAvailable && state.paused === false && invoke(actions.pause);
        case 'MediaStop':
            return invokeAll([actions.closeOverlays, actions.cancelSeek, actions.exit]);
        case 'ArrowRight':
            return playbackAvailable && !state.tvControlFocused && state.time !== null &&
                typeof state.seekTimeDuration === 'number' &&
                typeof actions.seek === 'function' &&
                invoke(() => actions.seek(state.seekTimeDuration));
        case 'ArrowLeft':
            return playbackAvailable && !state.tvControlFocused && state.time !== null &&
                typeof state.seekTimeDuration === 'number' &&
                typeof actions.seek === 'function' &&
                invoke(() => actions.seek(-state.seekTimeDuration));
        case 'MediaFastForward':
            return playbackAvailable && state.time !== null &&
                typeof state.seekTimeDuration === 'number' &&
                typeof actions.seek === 'function' &&
                invoke(() => actions.seek(state.seekTimeDuration));
        case 'MediaRewind':
            return playbackAvailable && state.time !== null &&
                typeof state.seekTimeDuration === 'number' &&
                typeof actions.seek === 'function' &&
                invoke(() => actions.seek(-state.seekTimeDuration));
        case 'ColorRed':
            return state.hasSubtitles && invoke(actions.openSubtitles);
        case 'ColorGreen':
            return state.hasAudioTracks && invoke(actions.openAudio);
        case 'ColorYellow':
            return state.hasDetails && invoke(actions.openDetails);
        case 'ColorBlue':
            return state.playbackSpeed !== null && invoke(actions.openSpeed);
        default:
            return false;
    }
};

const shouldDeduplicateMediaCommand = (lastCommand, command, source, timestamp, windowMs = 250) => {
    return !!lastCommand &&
        lastCommand.command === command &&
        lastCommand.source !== source &&
        timestamp >= lastCommand.timestamp &&
        timestamp - lastCommand.timestamp <= windowMs;
};

module.exports = {
    dispatchRemoteMediaKey,
    shouldDeduplicateMediaCommand,
};
