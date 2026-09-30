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

const shouldDeduplicateMediaCommand = (lastCommand, command, source, timestamp, isToggle = false, windowMs = 250) => {
    const commandMatches = lastCommand?.command === command;
    // The platform can emit a keyboard MediaPlay/MediaPause and a shell
    // play-pause event for one press. The shell event is a toggle, so React may
    // have already updated `paused` and made its derived command look opposite.
    const shellToggleEcho = isToggle && source === 'shell' && lastCommand?.source === 'keyboard';
    return !!lastCommand &&
        (commandMatches || shellToggleEcho) &&
        lastCommand.source !== source &&
        timestamp >= lastCommand.timestamp &&
        timestamp - lastCommand.timestamp <= windowMs;
};

const dispatchRemotePlaybackCommand = (command, state, source, lastCommand, timestamp, actions, isToggle = false) => {
    if (shouldDeduplicateMediaCommand(lastCommand.current, command, source, timestamp, isToggle)) return true;

    const commandAvailable = !state.menusOpen && !state.nextVideoPopupOpen && (
        command === 'play' ? state.paused === true : state.paused === false
    );
    if (!commandAvailable) {
        if (source !== 'keyboard') return false;
        // Consume a recognized key even when it is already in the requested
        // state, so a paired shell toggle cannot perform the opposite action.
        lastCommand.current = { command, source, timestamp };
        return true;
    }

    lastCommand.current = { command, source, timestamp };
    return invoke(actions[command]);
};

const releaseRemoteSeekKey = (keyboardKeys, remoteSeekKeys, releaseSeek) => {
    const key = keyboardKeys.find((keyboardKey) => remoteSeekKeys.has(keyboardKey));
    if (!key) return false;
    remoteSeekKeys.delete(key);
    releaseSeek();
    return true;
};

module.exports = {
    dispatchRemoteMediaKey,
    dispatchRemotePlaybackCommand,
    releaseRemoteSeekKey,
    shouldDeduplicateMediaCommand,
};
