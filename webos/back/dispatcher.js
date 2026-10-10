// Back key dispatcher for webOS TV 4.x (owner: F3.2). API and layers: webos/back/README.md.
//
// appinfo.json sets disableBackHistoryAPI, so WebAppMgr does not call history.back() on Back and
// the page gets a keydown with keyCode 461 instead. One capture listener on window takes that key
// before anything else and runs the registered handlers, highest priority first and, within a
// priority, the most recently registered first. The first handler that returns true consumes the
// press; nothing else (spatial navigation, shortcuts, upstream Escape listeners) ever sees it.

const BACK_KEY_CODE = 461;

// Lower layers are fallbacks for the upper ones: a press reaches the route layer only when no
// keyboard, dialog or overlay took it.
const PRIORITY = Object.freeze({
    ROUTE: 100,
    OVERLAY: 200,
    HANDLER: 300,
    KEYBOARD: 400,
});

const HISTORY_SIZE = 20;

const isBackKey = (event) => event.keyCode === BACK_KEY_CODE || event.which === BACK_KEY_CODE;

const createBackDispatcher = ({ now = () => Date.now(), logError = (...args) => console.error(...args) } = {}) => {
    let entries = [];
    let order = 0;
    const history = [];
    // Every Back key event that reached the page, for the emulator tests and diagnostics.
    const keyEvents = { keydown: 0, keypress: 0, keyup: 0, repeat: 0 };

    const register = (handler, { priority = PRIORITY.HANDLER, name = 'handler' } = {}) => {
        if (typeof handler !== 'function') {
            throw new TypeError('webos/back: handler must be a function');
        }
        const entry = { handler, priority, name, order: order++ };
        entries = entries.concat(entry).sort((a, b) => b.priority - a.priority || b.order - a.order);
        return () => {
            entries = entries.filter((current) => current !== entry);
        };
    };

    // Runs the handlers until one consumes the press. Returns the name of that handler, or null.
    // Handlers may set context.detail (what they did); it is kept in the history.
    // A handler that throws counts as having consumed it: it may have closed something already,
    // and falling through to the route layer would then act twice on one press.
    const dispatch = (context = {}) => {
        let consumedBy = null;
        for (const entry of entries) {
            let consumed = false;
            try {
                consumed = entry.handler(context) === true;
            } catch (error) {
                logError(`webos/back: handler "${entry.name}" failed`, error);
                consumed = true;
            }
            if (consumed) {
                consumedBy = entry.name;
                break;
            }
        }
        history.push({ time: now(), consumedBy, detail: context.detail });
        if (history.length > HISTORY_SIZE) {
            history.shift();
        }
        return consumedBy;
    };

    // keydown, keyup and keypress of Back are all swallowed; only a keydown that is not an
    // auto-repeat dispatches, so holding the key down does not unwind the whole stack.
    const onKeyEvent = (event) => {
        if (!isBackKey(event)) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        keyEvents[event.type] = (keyEvents[event.type] || 0) + 1;
        if (event.repeat) {
            keyEvents.repeat++;
        }
        if (event.type === 'keydown' && !event.repeat) {
            dispatch({ event });
        }
    };

    const KEY_EVENTS = ['keydown', 'keypress', 'keyup'];
    const CAPTURE = { capture: true };
    const install = (target) => {
        KEY_EVENTS.forEach((type) => target.addEventListener(type, onKeyEvent, CAPTURE));
        return () => KEY_EVENTS.forEach((type) => target.removeEventListener(type, onKeyEvent, CAPTURE));
    };

    return {
        register,
        dispatch,
        install,
        onKeyEvent,
        get handlers() {
            return entries.map(({ name, priority }) => ({ name, priority }));
        },
        get history() {
            return history.slice();
        },
        get keyEvents() {
            return Object.assign({}, keyEvents);
        },
    };
};

module.exports = {
    BACK_KEY_CODE,
    PRIORITY,
    isBackKey,
    createBackDispatcher,
};
