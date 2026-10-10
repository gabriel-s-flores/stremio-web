// webos/back/dispatcher.js: order of the handlers, consuming the key, auto-repeat.

const { BACK_KEY_CODE, PRIORITY, isBackKey, createBackDispatcher } = require('../../back/dispatcher');

const keyEvent = (type, keyCode, { repeat = false } = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'keyCode', { value: keyCode });
    Object.defineProperty(event, 'which', { value: keyCode });
    Object.defineProperty(event, 'repeat', { value: repeat });
    return event;
};

describe('createBackDispatcher', () => {
    test('Back is keyCode 461 only', () => {
        expect(BACK_KEY_CODE).toBe(461);
        expect(isBackKey({ keyCode: 461 })).toBe(true);
        expect(isBackKey({ keyCode: 0, which: 461 })).toBe(true);
        expect(isBackKey({ keyCode: 27, key: 'Escape' })).toBe(false);
        expect(isBackKey({ keyCode: 8, key: 'Backspace' })).toBe(false);
    });

    test('runs higher priorities first and, within one, the latest registered first', () => {
        const dispatcher = createBackDispatcher();
        const calls = [];
        const handler = (name) => () => {
            calls.push(name);
            return false;
        };
        dispatcher.register(handler('route'), { priority: PRIORITY.ROUTE, name: 'route' });
        dispatcher.register(handler('modal-a'), { name: 'modal-a' });
        dispatcher.register(handler('keyboard'), { priority: PRIORITY.KEYBOARD, name: 'keyboard' });
        dispatcher.register(handler('overlay'), { priority: PRIORITY.OVERLAY, name: 'overlay' });
        dispatcher.register(handler('modal-b'), { name: 'modal-b' });

        expect(dispatcher.dispatch()).toBeNull();
        expect(calls).toEqual(['keyboard', 'modal-b', 'modal-a', 'overlay', 'route']);
        expect(dispatcher.handlers.map(({ name }) => name)).toEqual(calls);
    });

    test('stops at the first handler that returns true, and only true consumes', () => {
        const dispatcher = createBackDispatcher();
        const route = jest.fn(() => true);
        const overlay = jest.fn(() => 'yes');
        const dialog = jest.fn(() => true);
        dispatcher.register(route, { priority: PRIORITY.ROUTE, name: 'route' });
        dispatcher.register(overlay, { priority: PRIORITY.OVERLAY, name: 'overlay' });
        expect(dispatcher.dispatch()).toBe('route');
        expect(overlay).toHaveBeenCalledTimes(1);

        const unregister = dispatcher.register(dialog, { name: 'dialog' });
        expect(dispatcher.dispatch()).toBe('dialog');
        expect(route).toHaveBeenCalledTimes(1);

        unregister();
        unregister();
        expect(dispatcher.dispatch()).toBe('route');
        expect(dialog).toHaveBeenCalledTimes(1);
    });

    test('a handler that throws consumes the press, so the route layer does not act on it too', () => {
        const logError = jest.fn();
        const dispatcher = createBackDispatcher({ logError });
        const route = jest.fn(() => true);
        dispatcher.register(route, { priority: PRIORITY.ROUTE, name: 'route' });
        dispatcher.register(() => {
            throw new Error('boom');
        }, { name: 'broken' });
        expect(dispatcher.dispatch()).toBe('broken');
        expect(route).not.toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith('webos/back: handler "broken" failed', expect.any(Error));
    });

    test('passes the context to the handlers and keeps the last 20 presses with their detail', () => {
        let time = 0;
        const dispatcher = createBackDispatcher({ now: () => ++time });
        dispatcher.register((context) => {
            context.detail = `press-${context.n}`;
            return context.n % 2 === 0;
        }, { name: 'even' });
        for (let n = 1; n <= 25; n++) {
            dispatcher.dispatch({ n });
        }
        const history = dispatcher.history;
        expect(history).toHaveLength(20);
        expect(history[0]).toEqual({ time: 6, consumedBy: 'even', detail: 'press-6' });
        expect(history[19]).toEqual({ time: 25, consumedBy: null, detail: 'press-25' });
        expect(history[18]).toEqual({ time: 24, consumedBy: 'even', detail: 'press-24' });
    });

    test('rejects handlers that are not functions', () => {
        expect(() => createBackDispatcher().register(null)).toThrow(TypeError);
    });
});

describe('Back key events', () => {
    const setup = () => {
        const dispatcher = createBackDispatcher();
        const handler = jest.fn(() => true);
        dispatcher.register(handler, { name: 'handler' });
        const target = new EventTarget();
        const uninstall = dispatcher.install(target);
        const later = jest.fn();
        ['keydown', 'keypress', 'keyup'].forEach((type) => target.addEventListener(type, later, true));
        return { dispatcher, handler, target, uninstall, later };
    };

    test('a Back keydown dispatches once and nobody else sees the key', () => {
        const { handler, target, later } = setup();
        const event = keyEvent('keydown', 461);
        target.dispatchEvent(event);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].event).toBe(event);
        expect(event.defaultPrevented).toBe(true);
        expect(later).not.toHaveBeenCalled();
    });

    test('keypress, keyup and auto-repeat keydowns of Back are swallowed without dispatching', () => {
        const { handler, target, later } = setup();
        const events = [keyEvent('keydown', 461, { repeat: true }), keyEvent('keypress', 461), keyEvent('keyup', 461)];
        events.forEach((event) => target.dispatchEvent(event));
        expect(handler).not.toHaveBeenCalled();
        expect(later).not.toHaveBeenCalled();
        events.forEach((event) => expect(event.defaultPrevented).toBe(true));
    });

    test('other keys go through untouched', () => {
        const { handler, target, later } = setup();
        [27, 8, 13, 37, 403].forEach((keyCode) => {
            const event = keyEvent('keydown', keyCode);
            target.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
        });
        expect(handler).not.toHaveBeenCalled();
        expect(later).toHaveBeenCalledTimes(5);
    });

    test('uninstall removes the listeners', () => {
        const { handler, target, uninstall, later } = setup();
        uninstall();
        target.dispatchEvent(keyEvent('keydown', 461));
        expect(handler).not.toHaveBeenCalled();
        expect(later).toHaveBeenCalledTimes(1);
    });
});
