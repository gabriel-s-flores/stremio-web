/**
 * @jest-environment jsdom
 */
// webos/lib/navigation/contextMenu.js: the remote triggers of the context menus.

const { installContextMenuTrigger, openContextMenu, YELLOW_KEY, LONG_PRESS_MS } = require('../../lib/navigation/contextMenu');

let remove;
let seen;

beforeEach(() => {
    jest.useFakeTimers();
    seen = [];
    remove = installContextMenuTrigger(window, { isTrusted: (event) => event.__trusted === true });
    document.elementFromPoint = (x, y) => document.getElementById('item') && { x, y };
});

afterEach(() => {
    remove();
    jest.useRealTimers();
    document.body.innerHTML = '';
    delete document.elementFromPoint;
});

const page = (content) => {
    document.body.innerHTML = `<div class="routes-container"><div class="route-container">${content}</div></div>`;
};

const record = (element, { handle = true } = {}) => {
    ['mousedown', 'mouseup', 'contextmenu', 'click'].forEach((type) => {
        element.addEventListener(type, (event) => {
            seen.push({ type, button: event.button, x: event.clientX, y: event.clientY });
            if (type === 'contextmenu' && handle) event.preventDefault();
        });
    });
};

const key = (keyCode, options = {}) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
    Object.defineProperty(event, 'keyCode', { value: keyCode });
    (document.activeElement || document.body).dispatchEvent(event);
};

const trusted = (type, init) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
    event.__trusted = true;
    return event;
};

describe('YELLOW key', () => {
    test('sends the events of a right click to the focused element, at its center', () => {
        page('<div id="item" tabindex="0"></div>');
        const item = document.getElementById('item');
        item.getBoundingClientRect = () => ({ left: 100, top: 200, width: 40, height: 20 });
        record(item);
        item.focus();
        key(YELLOW_KEY);
        expect(seen).toEqual([
            { type: 'mousedown', button: 2, x: 120, y: 210 },
            { type: 'mouseup', button: 2, x: 120, y: 210 },
            { type: 'contextmenu', button: 2, x: 120, y: 210 },
        ]);
    });

    test('other keys and the auto-repeat do nothing', () => {
        page('<div id="item" tabindex="0"></div>');
        record(document.getElementById('item'));
        document.getElementById('item').focus();
        key(403);
        key(YELLOW_KEY, { repeat: true });
        expect(seen).toEqual([]);
    });

    test('the YELLOW of the diagnostics sequence (right after GREEN) is not a menu request', () => {
        page('<div id="item" tabindex="0"></div>');
        record(document.getElementById('item'));
        document.getElementById('item').focus();
        key(404);
        key(YELLOW_KEY);
        expect(seen).toEqual([]);
        jest.advanceTimersByTime(3000);
        key(YELLOW_KEY);
        expect(seen.map((event) => event.type)).toEqual(['mousedown', 'mouseup', 'contextmenu']);
    });

    test('in the Player, with nothing handling it under the focus, the video gets the right click', () => {
        page('<div class="player-container-a1"><div id="bar" tabindex="0"></div><video id="video"></video></div>');
        const bar = document.getElementById('bar');
        const video = document.getElementById('video');
        record(bar, { handle: false });
        record(video);
        bar.focus();
        key(YELLOW_KEY);
        expect(seen.filter((event) => event.type === 'contextmenu')).toHaveLength(2);
        expect(openContextMenu(window, null)).toBe(true);
    });

    test('with the focus on the body and no Player, nothing happens', () => {
        page('<div id="item" tabindex="0"></div>');
        record(document.getElementById('item'));
        key(YELLOW_KEY);
        expect(seen).toEqual([]);
    });
});

describe('holding the pointer button', () => {
    const hold = (init) => {
        const item = document.getElementById('item');
        item.dispatchEvent(trusted('mousedown', init));
        jest.advanceTimersByTime(LONG_PRESS_MS + 10);
    };

    test('opens the menu and swallows the click of the release', () => {
        page('<div id="item" tabindex="0"></div>');
        const target = { x: 0, y: 0, dispatchEvent: jest.fn(() => false) };
        document.elementFromPoint = () => target;
        const item = document.getElementById('item');
        hold({ clientX: 50, clientY: 60 });
        expect(target.dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual(['mousedown', 'mouseup', 'contextmenu']);
        const clicks = jest.fn();
        item.addEventListener('click', clicks);
        item.dispatchEvent(trusted('mouseup'));
        item.dispatchEvent(trusted('click'));
        expect(clicks).not.toHaveBeenCalled();
        // Only that one click.
        item.dispatchEvent(trusted('click'));
        expect(clicks).toHaveBeenCalledTimes(1);
    });

    test('a press that no menu handles still clicks', () => {
        page('<div id="item" tabindex="0"></div>');
        const target = { dispatchEvent: jest.fn(() => true) };
        document.elementFromPoint = () => target;
        const item = document.getElementById('item');
        hold({ clientX: 50, clientY: 60 });
        const clicks = jest.fn();
        item.addEventListener('click', clicks);
        item.dispatchEvent(trusted('click'));
        expect(clicks).toHaveBeenCalledTimes(1);
    });

    test('a short press, a drift of the pointer or a release cancel it', () => {
        page('<div id="item" tabindex="0"></div>');
        const target = { dispatchEvent: jest.fn(() => false) };
        document.elementFromPoint = () => target;
        const item = document.getElementById('item');
        item.dispatchEvent(trusted('mousedown', { clientX: 10, clientY: 10 }));
        jest.advanceTimersByTime(LONG_PRESS_MS - 100);
        item.dispatchEvent(trusted('mouseup'));
        jest.advanceTimersByTime(500);
        item.dispatchEvent(trusted('mousedown', { clientX: 10, clientY: 10 }));
        item.dispatchEvent(trusted('mousemove', { clientX: 10, clientY: 60 }));
        jest.advanceTimersByTime(LONG_PRESS_MS + 10);
        expect(target.dispatchEvent).not.toHaveBeenCalled();
    });

    test('untrusted presses and other buttons are ignored', () => {
        page('<div id="item" tabindex="0"></div>');
        const target = { dispatchEvent: jest.fn(() => false) };
        document.elementFromPoint = () => target;
        const item = document.getElementById('item');
        item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        item.dispatchEvent(trusted('mousedown', { button: 2 }));
        jest.advanceTimersByTime(LONG_PRESS_MS + 10);
        expect(target.dispatchEvent).not.toHaveBeenCalled();
    });
});
