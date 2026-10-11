// The focus of a screen (see ../README.md): one engine per mounted screen, on its route content
// element, for Board, Discover, Search, Library, Calendar, Addons and Settings. The screens only
// describe themselves (../board.js, ../discover.js, ../search.js, ../screens.js); the React side is
// ../withScreenNavigation.js.
//
// - Initial focus: the screen mounted with nothing focused gets its first item as soon as it shows
//   up (the Board waits for the catalogs of the core, ~30 s in the C8 profile). Meanwhile, after
//   `fallbackDelay`, a fallback (the filters above the list), which gives way to the item when it
//   comes, unless the user took over (a key, the focus moved).
// - Restore: the screens stay mounted under the ones opened from them (src/router/Routes.tsx), so
//   the element that had the focus is still there when Back brings the screen up again: it gets the
//   focus back, or the element at the same place in the tree if it was re-rendered.
// - Recovery: the focused element went away (a row replaced, a list reloaded, a filter applied), or
//   an arrow came with nothing focused: the focus goes back to the screen, not to the page body
//   (where the spatial navigation starts over from the top corner).
// - Memory: the last element focused in the screen, without the side bar and the modals, and
//   without the top bar unless `rememberTopBar` (isMemorable): leaving through the side bar and
//   coming back lands in the content.
// - Keys: the screen takes the arrows it knows better (`navigate`); whatever it leaves goes on to the
//   upstream spatial-navigation-polyfill.
// It all applies only while the screen is the visible route and no modal is open over it.
//
// The screen description:
// - initial(container, { recovering }): the element for the initial focus, or null while there is
//   none yet; `recovering` when it is for a focus lost later (Search avoids its text field then);
// - fallback(container) (optional): an element to focus meanwhile;
// - fallbackDelay (ms, default 0): how long the initial element is waited for before the fallback;
// - timeout (ms): how long the initial element is waited for at all;
// - rememberTopBar (default false): the top bar is remembered too;
// - path (default true): a re-rendered element is found again by its place in the tree; false
//   when that place may hold something else (a list replaced by another one);
// - navigate(target, dir, container, memory, event) (optional): an element to focus, `true` to
//   swallow the arrow, or null to leave it to the spatial navigation; `memory.last` is the last
//   focused element of the screen, `memory.lastContent` the same out of both bars, `memory.content`
//   the last one inside its lists;
// - capture (default false): navigate runs in the capture phase on the container, before the
//   focused element's own key handlers (open dropdowns of Settings);
// - isContent(element, container) (optional): the element is in the screen's lists;
// - align(element, container) (optional): scrolls the lists to the focused element, on every focus;
//   realign(element, container) (optional, default align): the same after a resize (the interface
//   zoom); neither while the Magic Remote pointer is in use;
// - onMutation(container) (optional): the screen's content changed.

const { ARROWS, ENTER, isAttached, isFocusable, isRendered, isShown } = require('./dom');
const { isFocusLost, modalOpen, routeOf } = require('./routes');
const { isMemorable, pathOf, resolvePath } = require('./memory');
const { PRIORITY, getInputHub } = require('./input');

// The Board waits for the core; past this, a screen that never got content stops waiting.
const INITIAL_FOCUS_TIMEOUT = 120000;

// The engine of each route (the side bar and the interface zoom ask for the visible one).
const engines = new WeakMap();
const screenFocusOf = (route) => (route ? engines.get(route) || null : null);

// The last focus an engine placed, for the diagnostics and the tests on the emulator
// (window.__webosNavigation.status).
const status = { last: null };
const describe = (element) => {
    const className = typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return element.tagName.toLowerCase() + (className ? `.${className}` : '') +
        (element.textContent ? ` "${element.textContent.trim().slice(0, 30)}"` : '');
};

const createScreenFocus = (container, screen, { window: win = window, hub = getInputHub(win), timeout = screen.timeout || INITIAL_FOCUS_TIMEOUT } = {}) => {
    const doc = win.document;
    const route = routeOf(container);
    // last/path: where Back restores to; lastContent: the same without any navigation bar (where the
    // side bar's RIGHT goes back to); content: the last one inside the screen's lists.
    const memory = { last: null, path: null, content: null, lastContent: null };
    // The wait for the initial element: { recovering, fallback, fallbackTimer, timer }.
    let waiting = null;
    // What had the focus when another route came on top.
    let left = null;

    const isVisible = () => isRendered(container);
    const isBlocked = () => modalOpen(doc, route);
    const pointerInUse = () => hub.pointerInUse();

    const focus = (element, reason) => {
        element.focus();
        const focused = doc.activeElement === element;
        if (focused) status.last = { reason, time: Date.now(), path: String(win.location.hash || ''), element: describe(element) };
        return focused;
    };

    // `from`: { last, path }, the memory or what it held when the route was left.
    const target = (from, recovering) => {
        if (isFocusable(from.last) && container.contains(from.last)) return from.last;
        return (screen.path !== false && resolvePath(from.path, container)) || screen.initial(container, { recovering });
    };

    const stopWaiting = () => {
        if (waiting === null) return;
        win.clearTimeout(waiting.timer);
        win.clearTimeout(waiting.fallbackTimer);
        waiting = null;
    };

    // The fallback goes in while the focus is still lost.
    const placeFallback = () => {
        if (waiting === null) return;
        waiting.fallbackTimer = null;
        if (!isVisible() || !isFocusLost(doc) || isBlocked() || !screen.fallback) return;
        const fallback = screen.fallback(container);
        if (!fallback) return;
        // Before focusing: the focusin of the fallback must not end the wait.
        waiting.fallback = fallback;
        if (!focus(fallback, 'fallback') && waiting !== null) waiting.fallback = null;
    };

    // Focus for a screen with nothing focused. When the content is not there yet, waits for it (the
    // mutations under the screen), as long as nothing else took the focus in between: the focus
    // still lost, or still on the fallback. `recovering`: the focus was lost after the screen had
    // it. `now`: an arrow is waiting for a focus, the fallback goes in without its delay.
    const ensureFocus = ({ recovering = false, now = false } = {}) => {
        if (!isVisible() || !isFocusLost(doc) || isBlocked()) return false;
        const element = target(memory, recovering);
        if (element) {
            stopWaiting();
            return focus(element, recovering ? 'recovered' : 'initial');
        }
        if (waiting === null) {
            waiting = { recovering, fallback: null, fallbackTimer: null, timer: win.setTimeout(stopWaiting, timeout) };
            const delay = screen.fallbackDelay || 0;
            if (delay > 0 && !now) waiting.fallbackTimer = win.setTimeout(placeFallback, delay);
            else placeFallback();
        } else if (now && waiting.fallback === null) {
            win.clearTimeout(waiting.fallbackTimer);
            placeFallback();
        }
        return waiting !== null && waiting.fallback !== null && doc.activeElement === waiting.fallback;
    };

    // The content changed: what was awaited may be there now.
    const onWaitedMutation = () => {
        const untouched = waiting.fallback ? doc.activeElement === waiting.fallback : isFocusLost(doc);
        if (!untouched) {
            stopWaiting();
            return;
        }
        if (!isVisible() || isBlocked()) return;
        const next = waiting.fallback ? screen.initial(container, { recovering: waiting.recovering }) : target(memory, waiting.recovering);
        if (next) {
            const reason = waiting.recovering ? 'recovered' : 'initial';
            stopWaiting();
            focus(next, reason);
        } else if (waiting.fallback === null && waiting.fallbackTimer === null) {
            placeFallback();
        }
    };

    // Chromium may drop the focus of a removed element without a focusout: the remembered element
    // left the tree and the focus is on the body.
    const lostWithElement = () => memory.last !== null && !isAttached(memory.last) && isFocusLost(doc) &&
        isVisible() && !pointerInUse();

    const observer = new win.MutationObserver(() => {
        if (waiting !== null) onWaitedMutation();
        else if (lostWithElement()) ensureFocus({ recovering: true });
        if (screen.onMutation) screen.onMutation(container);
    });
    observer.observe(container, { childList: true, subtree: true });

    const leave = () => {
        left = { last: memory.last, path: memory.path };
    };

    // Back to this screen: the element it was left from, even if the screen focused something on its
    // own meanwhile (the search field of Search takes the focus whenever the route comes back).
    const restore = () => {
        if (!isVisible() || isBlocked()) return false;
        const element = target(left || memory, true);
        left = null;
        if (!element) return ensureFocus({ recovering: true });
        if (doc.activeElement !== element) focus(element, 'restored');
        if (screen.align && !pointerInUse()) screen.align(element, container);
        return true;
    };

    // The location changed with the screen on (a filter of Addons or Library): once painted, the
    // focus lost with the old list comes back.
    let locationTimer = null;
    const onLocationChange = () => {
        win.clearTimeout(locationTimer);
        locationTimer = win.setTimeout(() => {
            locationTimer = null;
            ensureFocus({ recovering: true });
        }, 0);
    };

    // The layout changed under the focused element (the interface zoom): its list scrolls to it again,
    // also when the zoom was changed with the pointer (the element under it moved anyway, F4.1b).
    const realign = () => {
        const align = screen.realign || screen.align;
        const active = doc.activeElement;
        if (!align || !isVisible() || !container.contains(active) || !isShown(active)) return;
        align(active, container);
    };

    const onFocusIn = (event) => {
        const element = event.target;
        if (!container.contains(element)) return;
        // The user (or anything else) moved the focus: no initial focus to wait for any more.
        if (waiting !== null && element !== waiting.fallback) stopWaiting();
        if (isMemorable(element, container)) memory.lastContent = element;
        if (isMemorable(element, container, { topBar: screen.rememberTopBar })) {
            memory.last = element;
            memory.path = pathOf(element, container);
            if (screen.isContent && screen.isContent(element, container)) memory.content = element;
        }
        if (screen.align && !pointerInUse()) screen.align(element, container);
    };

    // The focused element was hidden or removed: the check runs once the focus landed (moving to
    // another element is no loss). A blur with the element still shown (a click on the background
    // in pointer mode) is left alone.
    const onFocusOut = (event) => {
        const element = event.target;
        if (element !== memory.last) return;
        win.setTimeout(() => {
            if (!isFocusable(element) && isFocusLost(doc)) ensureFocus({ recovering: true });
        }, 0);
    };

    const onKeyDown = (event) => {
        const dir = ARROWS[event.keyCode];
        if (!dir || !screen.navigate || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (!isVisible()) return;
        const result = screen.navigate(event.target, dir, container, memory, event);
        if (!result) return;
        event.preventDefault();
        if (result !== true && result !== doc.activeElement) focus(result, 'navigate');
    };

    // Before the spatial navigation (the hub runs in the capture phase on window): an arrow or OK ends
    // the fallback's wait (the user took over; not the keys webOS sends when the Magic Remote pointer
    // shows or hides, 1536/1537), and an arrow with nothing focused goes to the screen's element
    // first, instead of the top of the page.
    const onHubKey = (event) => {
        const userKey = Boolean(ARROWS[event.keyCode]) || event.keyCode === ENTER;
        if (userKey && waiting !== null && waiting.fallback !== null && isVisible()) stopWaiting();
        if (!ARROWS[event.keyCode] || event.defaultPrevented || !isFocusLost(doc)) return;
        if (ensureFocus({ recovering: true, now: true })) {
            event.preventDefault();
            // The key placed the focus (the fallback, maybe): the user has it now.
            stopWaiting();
        }
    };

    const removeHubKey = hub.onKey(onHubKey, PRIORITY.screen);
    const removeHubFocus = hub.onFocus(onFocusIn);
    container.addEventListener('focusout', onFocusOut);
    container.addEventListener('keydown', onKeyDown, Boolean(screen.capture));

    const engine = {
        container,
        memory,
        ensureFocus,
        leave,
        restore,
        onLocationChange,
        realign,
        get waiting() {
            return waiting !== null;
        },
        destroy: () => {
            stopWaiting();
            win.clearTimeout(locationTimer);
            observer.disconnect();
            removeHubKey();
            removeHubFocus();
            container.removeEventListener('focusout', onFocusOut);
            container.removeEventListener('keydown', onKeyDown, Boolean(screen.capture));
            if (route && engines.get(route) === engine) engines.delete(route);
        },
    };
    if (route) engines.set(route, engine);
    return engine;
};

module.exports = {
    INITIAL_FOCUS_TIMEOUT,
    createScreenFocus,
    screenFocusOf,
    status,
};
