// Remote keys the Player handles on webOS TV 4.x (F5.7). Codes measured on the emulator and listed by
// LG (webos/docs/PESQUISA.md, section 5): arrows 37-40, OK 13, Play 415, Pause 19, Fast forward 417,
// Rewind 412, Stop 413. The media keys only exist on the standard remote; the Magic Remote has none.
// `key` names (UI Events) cover keyboards and other remotes that send them instead of the LG codes.

const ACTIONS = Object.freeze({
    LEFT: 'left',
    RIGHT: 'right',
    UP: 'up',
    DOWN: 'down',
    OK: 'ok',
    PLAY: 'play',
    PAUSE: 'pause',
    PLAY_PAUSE: 'play-pause',
    FAST_FORWARD: 'fast-forward',
    REWIND: 'rewind',
    STOP: 'stop',
    NEXT: 'next',
});

const BY_KEY_CODE = {
    13: ACTIONS.OK,
    37: ACTIONS.LEFT,
    38: ACTIONS.UP,
    39: ACTIONS.RIGHT,
    40: ACTIONS.DOWN,
    415: ACTIONS.PLAY,
    19: ACTIONS.PAUSE,
    179: ACTIONS.PLAY_PAUSE,
    417: ACTIONS.FAST_FORWARD,
    412: ACTIONS.REWIND,
    413: ACTIONS.STOP,
    176: ACTIONS.NEXT,
};

const BY_KEY = {
    Enter: ACTIONS.OK,
    ArrowLeft: ACTIONS.LEFT,
    ArrowUp: ACTIONS.UP,
    ArrowRight: ACTIONS.RIGHT,
    ArrowDown: ACTIONS.DOWN,
    MediaPlay: ACTIONS.PLAY,
    MediaPause: ACTIONS.PAUSE,
    MediaPlayPause: ACTIONS.PLAY_PAUSE,
    MediaFastForward: ACTIONS.FAST_FORWARD,
    MediaRewind: ACTIONS.REWIND,
    MediaStop: ACTIONS.STOP,
    MediaTrackNext: ACTIONS.NEXT,
};

const MEDIA_ACTIONS = [
    ACTIONS.PLAY,
    ACTIONS.PAUSE,
    ACTIONS.PLAY_PAUSE,
    ACTIONS.FAST_FORWARD,
    ACTIONS.REWIND,
    ACTIONS.STOP,
    ACTIONS.NEXT,
];

// The action of a key event, or null. The LG code wins: on the TV `key` may be "Unidentified".
const getAction = (event) => {
    const code = event.keyCode || event.which;
    if (Object.prototype.hasOwnProperty.call(BY_KEY_CODE, code)) return BY_KEY_CODE[code];
    if (typeof event.key === 'string' && Object.prototype.hasOwnProperty.call(BY_KEY, event.key)) return BY_KEY[event.key];
    return null;
};

const isMediaAction = (action) => MEDIA_ACTIONS.indexOf(action) !== -1;

const isModified = (event) => !!(event.ctrlKey || event.altKey || event.metaKey || event.shiftKey);

module.exports = {
    ACTIONS,
    getAction,
    isMediaAction,
    isModified,
};
