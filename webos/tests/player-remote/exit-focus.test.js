/**
 * @jest-environment jsdom
 */
// Leaving the Player (F5.7, debt closed in F7.3): webos/lib/player-remote/controller.js gives the focus
// back to the stream that opened the Player. While the Player node is held by the pipeline guard (F5.6)
// the route below is `display: none`, where focus() does nothing: it tries every 100 ms for 3 s and
// stops. Also covered: which elements count as "the Player" (never an entry, and a focus inside them
// is a lost focus) and the focus ring, left out while the Magic Remote pointer is in use.
// Fake timers (modern: Date.now() moves with them, the deadline reads it).

const { createPlayerRemote } = require('../../lib/player-remote/controller');

const RETRY_MS = 100;
const TIMEOUT_MS = 3000;

const $ = (id) => document.getElementById(id);

// The routes of the app: the page below (with the stream played) and the Player on top of it.
const render = () => {
    document.body.innerHTML = `
        <div id="app"><div class="routes-container">
            <div class="route-container" id="below"><a id="stream" href="#/player/x" tabindex="0"></a><div id="other" tabindex="0"></div></div>
            <div class="route-container" id="above">
                <div class="player-container-pL4yr overlayHidden-oH1dn" id="player">
                    <div class="layer-lAy3r control-bar-layer-cBl4y" id="bar">
                        <div class="control-bar-buttons-container-bC1nt" id="row">
                            <div class="control-bar-button-aB1cD button-container-bT1cn" tabindex="0" id="play"></div>
                        </div>
                    </div>
                    <div id="menu" tabindex="0"></div>
                </div>
            </div>
        </div></div>`;
};

// The stream cannot take the focus while the route below is display: none.
const hideRouteBelow = (element) => {
    const nativeFocus = HTMLElement.prototype.focus;
    const state = { visible: false, calls: 0 };
    element.focus = function() {
        state.calls++;
        if (state.visible) nativeFocus.call(this);
    };
    return state;
};

const open = (options = {}) => {
    const created = createPlayerRemote({
        window,
        getBar: () => $('bar'),
        getProps: () => ({ paused: false }),
        isOverlayOpen: () => false,
        getLastFocused: () => options.lastFocused || null,
    });
    return { created, leave: created.install() };
};

// jsdom has no layout: everything is shown.
beforeAll(() => {
    Element.prototype.getClientRects = function() {
        return [{}];
    };
    Element.prototype.getBoundingClientRect = function() {
        return { x: 0, y: 0, width: 10, height: 10 };
    };
});

beforeEach(() => {
    jest.useFakeTimers();
    render();
    document.documentElement.removeAttribute('data-webos-pointer');
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    document.documentElement.removeAttribute('data-webos-pointer');
    document.body.innerHTML = '';
});

describe('the 3 s deadline', () => {
    it('gives the focus back as soon as the route below shows up, long before the deadline', () => {
        $('stream').focus();
        const route = hideRouteBelow($('stream'));
        const { created, leave } = open();
        $('play').focus();
        leave();
        expect(document.activeElement).toBe(document.body);
        expect(route.calls).toBe(1);
        jest.advanceTimersByTime(1500);
        expect(document.activeElement).toBe(document.body);
        expect(created.status.exit.restored).toBe(false);
        route.visible = true;
        jest.advanceTimersByTime(RETRY_MS);
        expect(document.activeElement).toBe($('stream'));
        expect(created.status.exit.restored).toBe(true);
        // One attempt at once, one every 100 ms until it took (17 in total), not 31 until the deadline.
        expect(route.calls).toBe(1500 / RETRY_MS + 2);
        jest.advanceTimersByTime(TIMEOUT_MS * 2);
        expect(route.calls).toBe(1500 / RETRY_MS + 2);
    });

    it('still works on the last attempt, at the deadline', () => {
        $('stream').focus();
        const route = hideRouteBelow($('stream'));
        const { created, leave } = open();
        $('play').focus();
        leave();
        jest.advanceTimersByTime(TIMEOUT_MS - RETRY_MS - 1);
        expect(document.activeElement).toBe(document.body);
        route.visible = true;
        jest.advanceTimersByTime(RETRY_MS + 1);
        expect(document.activeElement).toBe($('stream'));
        expect(created.status.exit.restored).toBe(true);
        expect(created.status.exit.stopped).toBeUndefined();
    });

    it('gives up after 3 s and never tries again, even if the route shows up later', () => {
        $('stream').focus();
        const route = hideRouteBelow($('stream'));
        const { created, leave } = open();
        $('play').focus();
        leave();
        jest.advanceTimersByTime(TIMEOUT_MS + RETRY_MS);
        expect(created.status.exit.stopped).toBe('timeout');
        expect(created.status.exit.restored).toBe(false);
        // The first attempt at once and the last one at the deadline.
        const calls = route.calls;
        expect(calls).toBe(TIMEOUT_MS / RETRY_MS + 1);
        route.visible = true;
        jest.advanceTimersByTime(TIMEOUT_MS * 3);
        expect(route.calls).toBe(calls);
        expect(document.activeElement).toBe(document.body);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('stops retrying when the focus lands somewhere else meanwhile (F4.4 restored it first)', () => {
        $('stream').focus();
        const route = hideRouteBelow($('stream'));
        const { created, leave } = open();
        $('play').focus();
        leave();
        jest.advanceTimersByTime(500);
        const calls = route.calls;
        $('other').focus();
        jest.advanceTimersByTime(RETRY_MS);
        expect(created.status.exit.stopped).toMatch(/^focus elsewhere/);
        jest.advanceTimersByTime(TIMEOUT_MS);
        expect(route.calls).toBe(calls);
        expect(document.activeElement).toBe($('other'));
    });
});

describe('elements of the Player', () => {
    it('are never taken as the entry: a focus inside the Player at install falls back to the last focused element', () => {
        $('play').focus();
        const { created, leave } = open({ lastFocused: $('stream') });
        expect(created.status.entry).toMatch(/^a/);
        leave();
        expect(document.activeElement).toBe($('stream'));
    });

    it('are never the entry even as the last focused element: with nothing else, nothing is given back', () => {
        $('play').focus();
        const { created, leave } = open({ lastFocused: $('menu') });
        expect(created.status.entry).toBeNull();
        leave();
        expect(created.status.exit.stopped).toBe('no entry');
        expect(document.activeElement).toBe(document.body);
    });

    it('count as a lost focus: from any element inside the Player the stream gets it back', () => {
        $('stream').focus();
        const { created, leave } = open();
        // The focus ends up on a Player element that is not the bar (a menu), which is also leaving.
        $('menu').focus();
        expect(document.activeElement).toBe($('menu'));
        leave();
        expect(document.activeElement).toBe($('stream'));
        expect(created.status.exit.restored).toBe(true);
    });

    it('count as a lost focus also while retrying: the focus coming back into the leaving Player does not stop it', () => {
        $('stream').focus();
        const route = hideRouteBelow($('stream'));
        const { created, leave } = open();
        $('play').focus();
        leave();
        jest.advanceTimersByTime(500);
        // The guard keeps the Player node; something puts the focus in it again.
        $('menu').focus();
        jest.advanceTimersByTime(RETRY_MS);
        expect(created.status.exit.stopped).toBeUndefined();
        route.visible = true;
        jest.advanceTimersByTime(RETRY_MS);
        expect(document.activeElement).toBe($('stream'));
        expect(created.status.exit.restored).toBe(true);
    });

    it('a focus outside the Player is not touched', () => {
        $('stream').focus();
        const { created, leave } = open();
        $('other').focus();
        leave();
        expect(document.activeElement).toBe($('other'));
        expect(created.status.exit.stopped).toMatch(/^focus elsewhere/);
        expect(created.status.exit.attempts).toBe(0);
    });

    it('are blurred first when they hold the focus, but an outside focus is not', () => {
        $('stream').focus();
        const route = hideRouteBelow($('stream'));
        const { created, leave } = open();
        $('menu').focus();
        leave();
        expect(created.status.exit.blurred).toBe(true);
        expect(document.activeElement).toBe(document.body);
        expect(route.calls).toBe(1);

        render();
        $('stream').focus();
        const second = open();
        $('other').focus();
        second.leave();
        expect(second.created.status.exit.blurred).toBe(false);
        expect(document.activeElement).toBe($('other'));
    });
});

describe('focus ring', () => {
    it('is added to the stream when the remote (not the pointer) is in use', () => {
        $('stream').focus();
        const { leave } = open();
        $('play').focus();
        leave();
        expect(document.activeElement).toBe($('stream'));
        expect($('stream').classList.contains('focus-visible')).toBe(true);
        expect($('stream').hasAttribute('data-focus-visible-added')).toBe(true);
    });

    it('is left out while the Magic Remote pointer is visible', () => {
        document.documentElement.setAttribute('data-webos-pointer', 'visible');
        $('stream').focus();
        const { created, leave } = open();
        $('play').focus();
        leave();
        expect(document.activeElement).toBe($('stream'));
        expect(created.status.exit.restored).toBe(true);
        expect($('stream').classList.contains('focus-visible')).toBe(false);
        expect($('stream').hasAttribute('data-focus-visible-added')).toBe(false);
    });

    it('is left out also when the route shows up late, with the pointer in use', () => {
        $('stream').focus();
        const route = hideRouteBelow($('stream'));
        const { leave } = open();
        $('play').focus();
        leave();
        jest.advanceTimersByTime(800);
        document.documentElement.setAttribute('data-webos-pointer', 'visible');
        route.visible = true;
        jest.advanceTimersByTime(RETRY_MS);
        expect(document.activeElement).toBe($('stream'));
        expect($('stream').classList.contains('focus-visible')).toBe(false);
    });

    it('is back once the pointer is hidden again', () => {
        document.documentElement.setAttribute('data-webos-pointer', 'hidden');
        $('stream').focus();
        const { leave } = open();
        $('play').focus();
        leave();
        expect($('stream').classList.contains('focus-visible')).toBe(true);
    });
});
