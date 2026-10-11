// The input hub of the remote navigation (see ../README.md): one keydown listener (capture, on
// window) and one focusin listener (capture, on document) for every part of it, and the input mode
// (keys or pointer).
//
// Capture on window runs before the spatial-navigation-polyfill (window, bubble phase): a handler
// that moves the focus calls preventDefault() and the polyfill skips the key. The Back dispatcher of
// webos/back registers its own listener first, at import, and keeps the Back key out of here.
//
// Key handlers run by priority (lowest first), then in the order they were added. A handler that
// returns true stops the ones after it (it also calls stopImmediatePropagation() when the key must
// not reach anything else, the polyfill included).
//
// Nothing runs at boot: the listeners are added with the first handler and removed with the last.

// The order of the key handlers.
const PRIORITY = {
    // An open overlay owns the keys (modals.js).
    overlay: 10,
    // The YELLOW key of the context menus (contextMenu.js).
    colorKeys: 20,
    // Every screen: the side navigation bar (sideBar.js).
    global: 30,
    // A screen with the focus lost (screenFocus.js), the details page (metadetails.js).
    screen: 40,
};

const hubs = new WeakMap();

// `isTrusted` is a parameter for the tests: jsdom cannot make a trusted event.
const createInputHub = (win, { isTrusted = (event) => event.isTrusted } = {}) => {
    const doc = win.document;
    const keyHandlers = [];
    const focusHandlers = [];
    let order = 0;
    let installed = false;
    // 'key', 'pointer', or null before any input (counts as keys).
    let lastInput = null;
    let lastPointerDown = -Infinity;

    const onKeyDown = (event) => {
        lastInput = 'key';
        for (const entry of keyHandlers.slice()) {
            if (entry.handler(event) === true) return;
        }
    };

    const onFocusIn = (event) => {
        focusHandlers.slice().forEach((handler) => handler(event));
    };

    const onPointer = (event) => {
        if (!isTrusted(event)) return;
        lastInput = 'pointer';
        if (event.type === 'mousedown') lastPointerDown = Date.now();
    };

    // The Magic Remote's pointer showing or hiding (webOS, webos/magic-remote).
    const onCursorState = (event) => {
        const visibility = event.detail && event.detail.visibility;
        if (visibility === true) lastInput = 'pointer';
        else if (visibility === false) lastInput = 'key';
    };

    const update = () => {
        const needed = keyHandlers.length + focusHandlers.length > 0;
        if (needed === installed) return;
        installed = needed;
        const method = needed ? 'addEventListener' : 'removeEventListener';
        win[method]('keydown', onKeyDown, true);
        doc[method]('focusin', onFocusIn, true);
        win[method]('mousedown', onPointer, true);
        win[method]('mousemove', onPointer, true);
        doc[method]('cursorStateChange', onCursorState);
    };

    const remover = (list, entry) => () => {
        const index = list.indexOf(entry);
        if (index !== -1) list.splice(index, 1);
        update();
    };

    return {
        // `handler(event)` for every keydown; returns a function that removes it.
        onKey: (handler, priority = PRIORITY.screen) => {
            const entry = { handler, priority, order: order++ };
            keyHandlers.push(entry);
            keyHandlers.sort((a, b) => a.priority - b.priority || a.order - b.order);
            update();
            return remover(keyHandlers, entry);
        },
        // `handler(event)` for every focusin; returns a function that removes it.
        onFocus: (handler) => {
            focusHandlers.push(handler);
            update();
            return remover(focusHandlers, handler);
        },
        get lastInput() {
            return lastInput;
        },
        // When the last trusted mousedown came (Date.now()).
        get lastPointerDown() {
            return lastPointerDown;
        },
        isKeyInput: () => lastInput !== 'pointer',
        // The Magic Remote pointer is in use (webos/magic-remote, F4.2): showing, or, before the first
        // cursorStateChange tells it, the last input was the pointer. A click focuses what it points
        // at; moving or scrolling things then would take them away from under the pointer.
        pointerInUse: () => {
            const mode = doc.documentElement.getAttribute('data-webos-pointer');
            return mode === 'visible' || (mode === null && lastInput === 'pointer');
        },
        // For the tests.
        setLastInput: (value) => {
            lastInput = value;
        },
        get listeners() {
            return { keys: keyHandlers.length, focus: focusHandlers.length, installed };
        },
    };
};

// The hub of a window (one per window, made on first use).
const getInputHub = (win) => {
    let hub = hubs.get(win);
    if (!hub) {
        hub = createInputHub(win);
        hubs.set(win, hub);
    }
    return hub;
};

module.exports = {
    PRIORITY,
    createInputHub,
    getInputHub,
};
