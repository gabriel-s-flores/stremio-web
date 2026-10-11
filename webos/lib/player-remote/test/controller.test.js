/**
 * @jest-environment jsdom
 */
// webos/lib/player-remote/controller.js: what each remote key does in the Player, against a DOM that
// mimics the upstream Player (CSS modules: `<local>-<hash>`). Listeners on document stand for the
// upstream shortcuts (src/common/Shortcuts), on window (bubble) for the spatial-navigation-polyfill.

const { createPlayerRemote, SEEK_RELEASE_FALLBACK_MS } = require('../controller');

const BUTTON = 'control-bar-button-aB1cD';

const render = ({ hidden = false, popup = false, lowerRoute = false } = {}) => {
    const player = `
        <div class="player-container-pL4yr${hidden ? ' overlayHidden-oH1dn' : ''}" id="player">
            <div class="layer-lAy3r control-bar-layer-cBl4y" id="bar">
                <div class="seek-bar-cB5kb seek-bar-container-sB1cn" id="seek">
                    <div class="slider-container-sL1dr"></div>
                    <div class="button-container-bT1cn" tabindex="-1" id="remaining"></div>
                </div>
                <div class="control-bar-buttons-container-bC1nt" id="row">
                    <div class="${BUTTON} button-container-bT1cn" tabindex="0" id="play"></div>
                    <div class="${BUTTON} button-container-bT1cn" tabindex="0" id="next"></div>
                    <div class="${BUTTON} button-container-bT1cn" tabindex="0" id="mute"></div>
                    <div class="control-bar-buttons-menu-button-mB1tn" tabindex="0" id="more" data-hidden></div>
                    <div class="control-bar-buttons-menu-container-mC1nt">
                        <div class="${BUTTON} button-container-bT1cn disabled" tabindex="0" id="subtitles"></div>
                        <div class="${BUTTON} button-container-bT1cn" tabindex="0" id="audio"></div>
                        <div class="${BUTTON} button-container-bT1cn" tabindex="0" id="options"></div>
                    </div>
                </div>
            </div>
            ${popup ? `
            <div class="layer-lAy3r menu-layer-mL4yr next-video-popup-container-nV1pp" id="popup">
                <div class="buttons-container-bC2nt">
                    <div class="button-container-bT1cn dismiss-dI5ms" tabindex="0" id="dismiss"></div>
                    <div class="button-container-bT1cn play-button-pB1tn" tabindex="0" id="watch"></div>
                </div>
            </div>` : ''}
        </div>`;
    const routes = lowerRoute ?
        `<div class="route-container">${player}</div><div class="route-container"><div id="top"></div></div>` :
        `<div class="route-container"><div id="board" tabindex="0"></div></div><div class="route-container">${player}</div>`;
    document.body.innerHTML = `<div id="app"><div class="routes-container">${routes}</div></div>`;
};

const $ = (id) => document.getElementById(id);

// jsdom has no layout: everything is shown except [data-hidden] (the "more" button at TV width).
beforeAll(() => {
    Element.prototype.getClientRects = function() {
        return this.closest('[data-hidden]') ? [] : [{}];
    };
    Element.prototype.getBoundingClientRect = function() {
        return this.closest('[data-hidden]') ? { width: 0, height: 0 } : { x: 0, y: 0, width: 10, height: 10 };
    };
});

let props;
let stop;
let overlayOpen;
let remote;
let uninstall;
let seen;
const cleanups = [];

const listen = (target, type, where, capture) => {
    const listener = (event) => seen.push({ type, where, key: event.key, keyCode: event.keyCode, repeat: event.repeat, prevented: event.defaultPrevented });
    target.addEventListener(type, listener, capture);
    cleanups.push(() => target.removeEventListener(type, listener, capture));
};

const setup = (options) => {
    if (uninstall) uninstall();
    render(options);
    props = {
        paused: false,
        nextVideo: { id: 'tt1:1:2' },
        onPlayRequested: jest.fn(),
        onPauseRequested: jest.fn(),
        onNextVideoRequested: jest.fn(),
        onHideRequested: jest.fn(),
    };
    stop = jest.fn();
    overlayOpen = false;
    remote = createPlayerRemote({
        window,
        getBar: () => $('bar'),
        getProps: () => props,
        isOverlayOpen: () => overlayOpen,
        stop,
    });
    remote.prepare();
    uninstall = remote.install();
};

beforeEach(() => {
    seen = [];
    ['keydown', 'keyup'].forEach((type) => {
        listen(document, type, 'shortcuts', false);
        listen(window, type, 'polyfill', false);
    });
    listen(document, 'mousemove', 'mousemove', false);
});

afterEach(() => {
    if (uninstall) uninstall();
    uninstall = null;
    cleanups.splice(0).forEach((cleanup) => cleanup());
    document.body.innerHTML = '';
    jest.useRealTimers();
});

const press = (keyCode, { type = 'keydown', repeat = false, key, target = document.activeElement || document.body } = {}) => {
    const event = new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    (target === document.body ? document.body : target).dispatchEvent(event);
    return event;
};

const KEYS = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, PLAY: 415, PAUSE: 19, FF: 417, RW: 412, STOP: 413, YELLOW: 405 };
const reached = (where, type = 'keydown') => seen.filter((entry) => entry.where === where && entry.type === type);
const revealed = () => seen.filter((entry) => entry.type === 'mousemove').length;

describe('bar hidden', () => {
    beforeEach(() => setup({ hidden: true }));

    it('the seek bar becomes focusable', () => {
        expect($('seek').tabIndex).toBe(0);
    });

    it('OK toggles play/pause, puts the focus on play and shows the bar; nothing else sees the key', () => {
        $('options').focus();
        press(KEYS.OK);
        expect(props.onPauseRequested).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe($('play'));
        expect($('play').hasAttribute('data-focus-visible-added')).toBe(true);
        expect($('play').classList.contains('focus-visible')).toBe(true);
        expect(reached('shortcuts')).toHaveLength(0);
        expect(reached('polyfill')).toHaveLength(0);
        expect(revealed()).toBe(1);
    });

    it('LEFT/RIGHT go on to the upstream seek (not to the polyfill) and focus the seek bar', () => {
        press(KEYS.RIGHT);
        expect(reached('shortcuts')).toHaveLength(1);
        expect(reached('shortcuts')[0].prevented).toBe(true);
        expect(document.activeElement).toBe($('seek'));
        expect(revealed()).toBe(1);
    });

    it('UP/DOWN show the bar on the last button the remote was on, without the volume shortcut', () => {
        props.paused = true;
        setup({ hidden: false });
        $('mute').focus();
        press(KEYS.RIGHT);
        expect(document.activeElement).toBe($('audio'));
        setup({ hidden: true });
        press(KEYS.DOWN);
        expect(document.activeElement).toBe($('play'));
        expect(reached('shortcuts')).toHaveLength(0);
    });

    it('any other key shows the bar and goes on', () => {
        press(KEYS.YELLOW);
        expect(revealed()).toBe(1);
        expect(reached('shortcuts')).toHaveLength(1);
    });
});

describe('bar on screen', () => {
    beforeEach(() => setup());

    it('seek bar: LEFT/RIGHT seek, DOWN goes to the buttons, UP stays, OK toggles', () => {
        $('seek').focus();
        press(KEYS.LEFT);
        expect(reached('shortcuts')).toHaveLength(1);
        expect(reached('polyfill')).toHaveLength(1);
        expect(reached('polyfill')[0].prevented).toBe(true);
        expect(document.activeElement).toBe($('seek'));
        press(KEYS.UP);
        expect(document.activeElement).toBe($('seek'));
        press(KEYS.OK);
        expect(props.onPauseRequested).toHaveBeenCalledTimes(1);
        press(KEYS.DOWN);
        expect(document.activeElement).toBe($('play'));
        expect(reached('shortcuts')).toHaveLength(1);
    });

    it('buttons: LEFT/RIGHT walk the shown, enabled buttons and stop at the ends', () => {
        $('play').focus();
        press(KEYS.LEFT);
        expect(document.activeElement).toBe($('play'));
        const order = [];
        for (let i = 0; i < 6; i++) {
            press(KEYS.RIGHT);
            order.push(document.activeElement.id);
        }
        expect(order).toEqual(['next', 'mute', 'audio', 'options', 'options', 'options']);
        expect(reached('shortcuts')).toHaveLength(0);
        expect(reached('polyfill')).toHaveLength(0);
    });

    it('buttons: UP to the seek bar, DOWN back to the same button', () => {
        $('mute').focus();
        press(KEYS.UP);
        expect(document.activeElement).toBe($('seek'));
        press(KEYS.DOWN);
        expect(document.activeElement).toBe($('mute'));
    });

    it('buttons: OK is left to the focused button (the upstream Button clicks on Enter)', () => {
        $('audio').focus();
        const event = press(KEYS.OK);
        expect(event.defaultPrevented).toBe(false);
        expect(reached('shortcuts')).toHaveLength(1);
        expect(props.onPauseRequested).not.toHaveBeenCalled();
    });

    it('focus outside the bar (the pointer showed it): OK toggles, LEFT seeks', () => {
        document.activeElement.blur();
        press(KEYS.OK);
        expect(props.onPauseRequested).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe($('play'));
        document.activeElement.blur();
        press(KEYS.LEFT);
        expect(document.activeElement).toBe($('seek'));
        expect(reached('shortcuts')).toHaveLength(1);
    });
});

describe('media keys', () => {
    beforeEach(() => setup({ hidden: true }));

    it('PLAY plays only when paused, PAUSE pauses only when playing; repeats are ignored', () => {
        press(KEYS.PLAY);
        expect(props.onPlayRequested).not.toHaveBeenCalled();
        press(KEYS.PAUSE);
        expect(props.onPauseRequested).toHaveBeenCalledTimes(1);
        props.paused = true;
        press(KEYS.PAUSE);
        expect(props.onPauseRequested).toHaveBeenCalledTimes(1);
        press(KEYS.PLAY, { repeat: true });
        expect(props.onPlayRequested).not.toHaveBeenCalled();
        press(KEYS.PLAY);
        expect(props.onPlayRequested).toHaveBeenCalledTimes(1);
        expect(reached('shortcuts')).toHaveLength(0);
    });

    it('MediaPlayPause (by key name) toggles', () => {
        press(0, { key: 'MediaPlayPause' });
        expect(props.onPauseRequested).toHaveBeenCalledTimes(1);
    });

    it('FF/RW are sent to the upstream seek as arrows, with the repeat, and released on keyup', () => {
        press(KEYS.FF);
        press(KEYS.FF, { repeat: true });
        press(KEYS.FF, { type: 'keyup' });
        const arrows = reached('shortcuts').concat(reached('shortcuts', 'keyup'));
        expect(arrows.map((entry) => [entry.type, entry.key, entry.keyCode, entry.repeat])).toEqual([
            ['keydown', 'ArrowRight', 39, false],
            ['keydown', 'ArrowRight', 39, true],
            ['keyup', 'ArrowRight', 39, false],
        ]);
        // The polyfill sees the arrows already handled.
        expect(reached('polyfill').every((entry) => entry.prevented)).toBe(true);
        expect(document.activeElement).toBe($('seek'));
        press(KEYS.RW);
        press(KEYS.RW, { type: 'keyup' });
        expect(reached('shortcuts').slice(-1)[0].key).toBe('ArrowLeft');
        expect(reached('shortcuts', 'keyup').slice(-1)[0].key).toBe('ArrowLeft');
    });

    it('a held FF without its keyup is released after a while', () => {
        jest.useFakeTimers();
        press(KEYS.FF);
        expect(reached('shortcuts', 'keyup')).toHaveLength(0);
        jest.advanceTimersByTime(SEEK_RELEASE_FALLBACK_MS);
        expect(reached('shortcuts', 'keyup')).toHaveLength(1);
    });

    it('STOP leaves (once per press)', () => {
        press(KEYS.STOP);
        press(KEYS.STOP, { repeat: true });
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it('MediaTrackNext plays the next video', () => {
        press(0, { key: 'MediaTrackNext' });
        expect(props.onNextVideoRequested).toHaveBeenCalledTimes(1);
    });
});

describe('overlays', () => {
    beforeEach(() => setup());

    it('an open menu keeps the arrows and OK (F4.3); play/pause still work, FF waits', () => {
        overlayOpen = true;
        $('seek').focus();
        press(KEYS.DOWN);
        press(KEYS.OK);
        expect(document.activeElement).toBe($('seek'));
        expect(reached('shortcuts')).toHaveLength(2);
        expect(props.onPauseRequested).not.toHaveBeenCalled();
        press(KEYS.PAUSE);
        expect(props.onPauseRequested).toHaveBeenCalledTimes(1);
        press(KEYS.FF);
        expect(reached('shortcuts').filter((entry) => entry.key === 'ArrowRight')).toHaveLength(0);
        expect(revealed()).toBe(0);
    });

    it('an arrow the focus layer (F4.3) already handled stops here: no volume, no seek, no polyfill behind the menu', () => {
        // F4.3 registers its capture listener when the app starts, before this controller.
        const focusLayer = (event) => {
            if (event.keyCode >= 37 && event.keyCode <= 40 && event.__handled) event.preventDefault();
        };
        window.addEventListener('keydown', focusLayer, true);
        cleanups.push(() => window.removeEventListener('keydown', focusLayer, true));
        setup();
        overlayOpen = true;
        $('seek').focus();
        [40, 38, 39, 37].forEach((keyCode) => {
            const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'keyCode', { get: () => keyCode });
            event.__handled = true;
            document.activeElement.dispatchEvent(event);
        });
        expect(reached('shortcuts')).toHaveLength(0);
        expect(reached('polyfill')).toHaveLength(0);
        expect(remote.status.result).toBe('overlay-arrow');
        // An arrow it leaves to the overlay itself goes on.
        press(KEYS.DOWN);
        expect(reached('shortcuts')).toHaveLength(1);
        expect(remote.status.result).toBe('overlay');
    });

    it('next video popup up: FF/RW and LEFT/RIGHT on the seek bar do nothing (the upstream seek is off) and say so', () => {
        setup({ popup: true });
        press(KEYS.FF);
        expect(remote.status.result).toBe('none');
        $('seek').focus();
        press(KEYS.RIGHT);
        expect(remote.status.result).toBe('none');
        expect(reached('shortcuts')).toHaveLength(0);
        expect(reached('polyfill')).toHaveLength(0);
    });

    it('next video popup: an arrow from outside goes to "watch", LEFT/RIGHT inside, DOWN to the bar, UP back', () => {
        setup({ popup: true });
        document.activeElement.blur();
        press(KEYS.DOWN);
        expect(document.activeElement).toBe($('watch'));
        press(KEYS.LEFT);
        expect(document.activeElement).toBe($('dismiss'));
        const event = press(KEYS.OK);
        expect(event.defaultPrevented).toBe(false);
        press(KEYS.DOWN);
        expect(document.activeElement).toBe($('seek'));
        press(KEYS.UP);
        expect(document.activeElement).toBe($('watch'));
    });
});

describe('Back', () => {
    it('with the bar on screen and the video playing: hides the bar and consumes the press', () => {
        setup();
        const context = {};
        expect(remote.onBack(context)).toBe(true);
        expect(props.onHideRequested).toHaveBeenCalledTimes(1);
        expect(context.detail).toBe('player-controls-hidden');
    });

    it('passes on when paused, hidden, with a menu or the popup open, and for Stop', () => {
        setup();
        props.paused = true;
        expect(remote.onBack({})).toBe(false);
        props.paused = false;
        expect(remote.onBack({ source: 'stop' })).toBe(false);
        overlayOpen = true;
        expect(remote.onBack({})).toBe(false);
        setup({ popup: true });
        expect(remote.onBack({})).toBe(false);
        setup({ hidden: true });
        expect(remote.onBack({})).toBe(false);
        expect(props.onHideRequested).not.toHaveBeenCalled();
    });
});

describe('leaving the Player', () => {
    it('gives the focus back to the element that opened the Player (the stream below), with the ring', () => {
        render({ hidden: true, lowerRoute: false });
        const stream = document.createElement('a');
        stream.setAttribute('href', '#/player/x');
        stream.tabIndex = 0;
        document.querySelector('.route-container').appendChild(stream);
        stream.focus();
        const created = createPlayerRemote({ window, getBar: () => $('bar'), getProps: () => ({ paused: false, onPauseRequested: () => {} }), isOverlayOpen: () => false });
        const remove = created.install();
        press(KEYS.OK);
        expect(document.activeElement).toBe($('play'));
        // The Player goes away.
        $('player').parentNode.removeChild($('player'));
        remove();
        expect(document.activeElement).toBe(stream);
        expect(stream.hasAttribute('data-focus-visible-added')).toBe(true);
    });

    it('tries again while the route below is still hidden (the guard holds the Player node), then gives up', () => {
        jest.useFakeTimers();
        render({ hidden: true });
        const stream = document.createElement('a');
        stream.tabIndex = 0;
        document.querySelector('.route-container').appendChild(stream);
        stream.focus();
        const created = createPlayerRemote({ window, getBar: () => $('bar'), getProps: () => ({ paused: false, onPauseRequested: () => {} }), isOverlayOpen: () => false });
        const remove = created.install();
        press(KEYS.OK);
        // display: none for a while: focus() does nothing.
        let focusable = false;
        const nativeFocus = HTMLElement.prototype.focus;
        stream.focus = function() {
            if (focusable) nativeFocus.call(this);
        };
        remove();
        expect(document.activeElement).toBe($('play'));
        jest.advanceTimersByTime(500);
        expect(document.activeElement).toBe($('play'));
        focusable = true;
        jest.advanceTimersByTime(100);
        expect(document.activeElement).toBe(stream);
        expect(created.status.exit.restored).toBe(true);
    });

    it('leaves the focus alone when it is already somewhere else, or when the element is gone', () => {
        render({ hidden: true });
        const stream = document.createElement('a');
        stream.tabIndex = 0;
        document.querySelector('.route-container').appendChild(stream);
        stream.focus();
        let created = createPlayerRemote({ window, getBar: () => $('bar'), getProps: () => ({}), isOverlayOpen: () => false });
        let remove = created.install();
        $('board').focus();
        remove();
        expect(document.activeElement).toBe($('board'));
        stream.focus();
        created = createPlayerRemote({ window, getBar: () => $('bar'), getProps: () => ({}), isOverlayOpen: () => false });
        remove = created.install();
        stream.parentNode.removeChild(stream);
        remove();
        expect(document.activeElement).toBe(document.body);
    });
});

describe('route', () => {
    it('does nothing while the Player is not the visible route', () => {
        setup({ hidden: true, lowerRoute: true });
        press(KEYS.OK, { target: document.body });
        press(KEYS.PLAY, { target: document.body });
        expect(props.onPauseRequested).not.toHaveBeenCalled();
        expect(reached('shortcuts')).toHaveLength(2);
        expect(remote.onBack({})).toBe(false);
        expect(revealed()).toBe(0);
    });
});
