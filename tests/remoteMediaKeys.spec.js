const {
    dispatchRemoteMediaKey,
    shouldDeduplicateMediaCommand,
} = require('../src/routes/Player/remoteMediaKeys');

const state = {
    menusOpen: false,
    nextVideoPopupOpen: false,
    paused: true,
    time: 120000,
    seekTimeDuration: 10000,
    hasSubtitles: true,
    hasAudioTracks: true,
    hasDetails: true,
    playbackSpeed: 1,
};

const actions = () => ({
    play: jest.fn(),
    pause: jest.fn(),
    closeOverlays: jest.fn(),
    cancelSeek: jest.fn(),
    exit: jest.fn(),
    seek: jest.fn(),
    openSubtitles: jest.fn(),
    openAudio: jest.fn(),
    openDetails: jest.fn(),
    openSpeed: jest.fn(),
});

test('Play and Pause issue only the matching idempotent state command', () => {
    const callbacks = actions();
    expect(dispatchRemoteMediaKey('MediaPlay', state, callbacks)).toBe(true);
    expect(callbacks.play).toHaveBeenCalledTimes(1);
    expect(callbacks.pause).not.toHaveBeenCalled();

    expect(dispatchRemoteMediaKey('MediaPlay', { ...state, paused: false }, callbacks)).toBe(false);
    expect(dispatchRemoteMediaKey('MediaPause', { ...state, paused: false }, callbacks)).toBe(true);
    expect(dispatchRemoteMediaKey('MediaPause', state, callbacks)).toBe(false);
    expect(callbacks.pause).toHaveBeenCalledTimes(1);
});

test('Stop closes overlays, cancels the preview, and exits once', () => {
    const callbacks = actions();
    expect(dispatchRemoteMediaKey('MediaStop', { ...state, menusOpen: true }, callbacks)).toBe(true);
    expect(callbacks.closeOverlays).toHaveBeenCalledTimes(1);
    expect(callbacks.cancelSeek).toHaveBeenCalledTimes(1);
    expect(callbacks.exit).toHaveBeenCalledTimes(1);
});

test('FF and RW use the configured duration and do not seek through open overlays', () => {
    const callbacks = actions();
    expect(dispatchRemoteMediaKey('MediaFastForward', state, callbacks)).toBe(true);
    expect(callbacks.seek).toHaveBeenLastCalledWith(10000);
    expect(dispatchRemoteMediaKey('MediaRewind', state, callbacks)).toBe(true);
    expect(callbacks.seek).toHaveBeenLastCalledWith(-10000);
    expect(dispatchRemoteMediaKey('MediaFastForward', { ...state, menusOpen: true }, callbacks)).toBe(false);
    expect(dispatchRemoteMediaKey('MediaRewind', { ...state, time: null }, callbacks)).toBe(false);
    expect(callbacks.seek).toHaveBeenCalledTimes(2);
});

test.each([
    ['ColorRed', { hasSubtitles: true }, 'openSubtitles'],
    ['ColorGreen', { hasAudioTracks: true }, 'openAudio'],
    ['ColorYellow', { hasDetails: true }, 'openDetails'],
    ['ColorBlue', { playbackSpeed: 1 }, 'openSpeed'],
])('%s opens only its available Player action', (key, available, actionName) => {
    const callbacks = actions();
    expect(dispatchRemoteMediaKey(key, { ...state, ...available }, callbacks)).toBe(true);
    expect(callbacks[actionName]).toHaveBeenCalledTimes(1);
    Object.keys(callbacks).filter((name) => name !== actionName).forEach((name) => {
        expect(callbacks[name]).not.toHaveBeenCalled();
    });
});

test.each([
    ['ColorRed', { hasSubtitles: false }],
    ['ColorGreen', { hasAudioTracks: false }],
    ['ColorYellow', { hasDetails: false }],
    ['ColorBlue', { playbackSpeed: null }],
])('%s stays unhandled when its Player action is unavailable', (key, unavailable) => {
    const callbacks = actions();
    expect(dispatchRemoteMediaKey(key, { ...state, ...unavailable }, callbacks)).toBe(false);
    Object.values(callbacks).forEach((callback) => expect(callback).not.toHaveBeenCalled());
});

test('cross-source duplicate playback commands are suppressed without hiding opposite commands', () => {
    const lastCommand = { command: 'play', source: 'keyboard', timestamp: 1000 };
    expect(shouldDeduplicateMediaCommand(lastCommand, 'play', 'shell', 1100)).toBe(true);
    expect(shouldDeduplicateMediaCommand(lastCommand, 'pause', 'shell', 1100)).toBe(false);
    expect(shouldDeduplicateMediaCommand(lastCommand, 'play', 'keyboard', 1100)).toBe(false);
    expect(shouldDeduplicateMediaCommand(lastCommand, 'play', 'shell', 1300)).toBe(false);
});
