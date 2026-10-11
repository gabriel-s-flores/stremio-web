/**
 * @jest-environment jsdom
 */
// webos/back/overlays.js: which overlay the bridge closes and which events it sends, to whom.
// The DOM below mimics what the upstream components render (CSS modules: `<local>-<hash>`).

const { OVERLAYS, closeTopOverlay, findPageBackButton } = require('../../back/overlays');

const route = (content, { hidden = '' } = {}) => `
    <div class="route-container">
        <div class="route-content">${content}</div>
        <div class="modals-container">${hidden}</div>
    </div>`;

const render = (routes, portals = '') => {
    document.body.innerHTML = `<div id="app"><div class="routes-container">${routes.join('')}</div></div>${portals}`;
};

// Every event the bridge sends, with where it was seen: window (capture), document and window
// (bubble). `document` listeners are where the Player's `exit` shortcut lives.
const EVENT_TYPES = ['keydown', 'mousedown', 'mouseup', 'click'];
let seen;
const listeners = [];
const listen = (target, where, capture) => {
    EVENT_TYPES.forEach((type) => {
        const listener = (event) => seen.push({ type, where, key: event.key, keyCode: event.keyCode, target: event.target });
        target.addEventListener(type, listener, capture);
        listeners.push(() => target.removeEventListener(type, listener, capture));
    });
};

beforeEach(() => {
    seen = [];
    listen(document, 'document', false);
    listen(window, 'window', false);
});

afterEach(() => {
    listeners.splice(0).forEach((remove) => remove());
    document.body.innerHTML = '';
});

const of = (type, where) => seen.filter((event) => event.type === type && (!where || event.where === where));

describe('closeTopOverlay', () => {
    test('does nothing when no overlay is open', () => {
        render([route('<div class="board-container-a1b2c"><div class="menu-layer-x">not in a player</div></div>')]);
        expect(closeTopOverlay(window)).toBeNull();
        expect(seen).toEqual([]);
    });

    test('a route modal gets an Escape on window only, so document listeners (Player `exit`) never see it', () => {
        render([route('', { hidden: '<div class="modal-container modal-container-q1w2e"></div>' })]);
        // The modals container is the second child of the route container, as in src/router/Route.
        const modals = document.querySelector('.modals-container');
        modals.innerHTML = '<div data-focus-guard></div><div class="modal-container modal-container-q1w2e"></div><div data-focus-guard></div>';
        expect(closeTopOverlay(window)).toBe('modal');
        expect(of('keydown', 'window')).toEqual([expect.objectContaining({ key: 'Escape', keyCode: 27, target: window })]);
        expect(of('keydown', 'document')).toEqual([]);
        expect(of('mousedown')).toEqual([]);
    });

    test('the Escape carries key, code, keyCode and which like a real one', () => {
        render([route('<div class="modals-container"><div class="modal-container"></div></div>')]);
        const events = [];
        const listener = (event) => events.push(event);
        window.addEventListener('keydown', listener);
        closeTopOverlay(window);
        window.removeEventListener('keydown', listener);
        expect(events).toHaveLength(1);
        expect([events[0].key, events[0].code, events[0].keyCode, events[0].which, events[0].bubbles]).toEqual(['Escape', 'Escape', 27, 27, true]);
    });

    test('only the visible route counts: a modal left open in a lower route is ignored', () => {
        render([
            route('<div class="modals-container"><div class="modal-container"></div></div>'),
            route('<div class="board-container-a1b2c"></div>'),
        ]);
        expect(closeTopOverlay(window)).toBeNull();
        expect(seen).toEqual([]);
    });

    test('an overlay that is fading out (Transition `-exit`) is not open any more', () => {
        render([route('')], '<div class="context-menu-container-z9y8x fade-exit"></div>');
        expect(closeTopOverlay(window)).toBeNull();
    });

    test('a popup inside a modal closes first, with a whole press on body and no Escape', () => {
        render([route(`
            <div class="modals-container"><div class="modal-container">
                <div class="label-container-a1 active"><div class="menu-container-b2"><button>Option</button></div></div>
            </div></div>`)]);
        expect(closeTopOverlay(window)).toBe('popup');
        expect(of('keydown')).toEqual([]);
        expect(of('mousedown', 'window').map((event) => event.target)).toEqual([document.body]);
        expect(of('mouseup', 'window').map((event) => event.target)).toEqual([document.body]);
        expect(of('click')).toEqual([]);
    });

    test('a MultiselectMenu dropdown closes with the press and the focus goes back to its label', async () => {
        render([route('<div class="multiselect-menu-a1"><div aria-haspopup="listbox" aria-expanded="true" tabindex="0">Movie</div><div role="listbox"></div></div>')]);
        const label = document.querySelector('[aria-haspopup]');
        expect(closeTopOverlay(window)).toBe('popup');
        expect(of('mouseup', 'document')).toHaveLength(1);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.activeElement).toBe(label);
    });

    test('the Player context menu closes with a whole press on its container, never a lone mousedown', () => {
        render([route('<div class="player-container-p1"><video></video></div>')], '<div class="context-menu-container-c1 fade-enter fade-active"><div class="context-menu-c2"></div></div>');
        const container = document.querySelector('[class^="context-menu-container-"]');
        expect(closeTopOverlay(window)).toBe('context-menu');
        expect(of('mousedown', 'window').map((event) => event.target)).toEqual([container]);
        expect(of('mouseup', 'window').map((event) => event.target)).toEqual([container]);
        expect(of('keydown')).toEqual([]);
    });

    test('Player menus close with a whole press on the Player container, not with the `exit` Escape', () => {
        render([route('<div class="player-container-p1"><div class="layer-l1"></div><div class="layer-l1 menu-layer-m1 fade-enter"></div></div>')]);
        const container = document.querySelector('[class^="player-container-"]');
        expect(closeTopOverlay(window)).toBe('player-menu');
        expect(of('mousedown').map((event) => event.target)).toEqual([container, container]);
        expect(of('mouseup').map((event) => event.target)).toEqual([container, container]);
        expect(of('keydown')).toEqual([]);
    });

    test('the next video popup is dismissed with its button, and it is not a Player menu', () => {
        render([route('<div class="player-container-p1"><div class="layer-l1 menu-layer-m1 next-video-popup-container-n1"><div class="button-container-b1 dismiss-d1"></div></div></div>')]);
        const dismiss = document.querySelector('[class*=" dismiss-"]');
        expect(closeTopOverlay(window)).toBe('next-video-popup');
        expect(of('click').map((event) => event.target)).toContain(dismiss);
        expect(of('mousedown')).toEqual([]);
    });

    test('ActionMenu gets the Escape on its focused item (its handler is React onKeyDown on the menu)', () => {
        render([route('')], '<div class="layer-a1"><div role="menu"><button role="menuitem">Remove</button></div></div>');
        const item = document.querySelector('[role="menuitem"]');
        item.focus();
        expect(closeTopOverlay(window)).toBe('action-menu');
        expect(of('keydown', 'document')).toEqual([expect.objectContaining({ key: 'Escape', target: item })]);
    });

    test('the body modals: server URL by Escape on window, shortcuts and gamepad by their backdrop', () => {
        render([route('')], '<div class="modal-container-s1"><div id="streaming-server-url-modal-title"></div></div>');
        expect(closeTopOverlay(window)).toBe('streaming-server-url-modal');
        expect(of('keydown', 'window')).toEqual([expect.objectContaining({ key: 'Escape', target: window })]);
        expect(of('keydown', 'document')).toEqual([]);

        seen = [];
        render([route('')], '<div class="shortcuts-modal-s2"><div class="backdrop-b1"></div><div class="container-c1"></div></div>');
        expect(closeTopOverlay(window)).toBe('shortcuts-modal');
        expect(of('click').map((event) => event.target.className)).toEqual(['backdrop-b1', 'backdrop-b1']);
        expect(of('keydown')).toEqual([]);

        seen = [];
        render([route('')], '<div class="gamepad-modal-g1" data-gamepad-modal><div class="backdrop-b1"></div></div>');
        expect(closeTopOverlay(window)).toBe('gamepad-modal');
        expect(of('keydown')).toEqual([]);
    });

    test('the order: the QR dialog (F3.4), body modals, menus and popups come before route modals and the Player', () => {
        expect(OVERLAYS.map(({ name }) => name)).toEqual([
            'external-link-dialog',
            'streaming-server-url-modal',
            'shortcuts-modal',
            'gamepad-modal',
            'context-menu',
            'action-menu',
            'popup',
            'modal',
            'player-menu',
            'next-video-popup',
        ]);
    });
});

// One fixture per overlay that the bridge closes with the mouse: whatever it sends, every press
// that starts must end, or a component that tracks presses (the Player's hold for 2x) stays held.
describe('no press is left open', () => {
    const FIXTURES = {
        'popup': [[route('<div class="label-container-a1 active"><div class="menu-container-b2"></div></div>')]],
        'search history': [[route('<div class="search-bar-container-s1 active-x"><input><div class="menu-container-m1"></div></div>')]],
        'context-menu': [[route('<div class="player-container-p1"></div>')], '<div class="context-menu-container-c1"></div>'],
        'player-menu': [[route('<div class="player-container-p1"><div class="side-drawer-layer-d1"></div></div>')]],
    };

    test.each(Object.keys(FIXTURES))('%s', (name) => {
        render(...FIXTURES[name]);
        expect(closeTopOverlay(window)).not.toBeNull();
        const downs = of('mousedown', 'window').length;
        expect(downs).toBeGreaterThan(0);
        expect(of('mouseup', 'window')).toHaveLength(downs);
    });
});

describe('findPageBackButton', () => {
    test('finds the streams list back button of the visible route only', () => {
        render([
            route('<div class="streams-list-container-s1"><div class="button-container-b1 back-button-container-k1"></div></div>'),
            route('<div class="board-container-a1"></div>'),
        ]);
        expect(findPageBackButton(document)).toBeNull();
        render([route('<div class="streams-list-container-s1"><div class="button-container-b1 back-button-container-k1"></div></div>')]);
        expect(findPageBackButton(document).className).toBe('button-container-b1 back-button-container-k1');
    });
});
