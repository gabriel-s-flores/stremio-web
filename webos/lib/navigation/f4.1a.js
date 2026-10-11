// Remote navigation of the Board, Discover and Search screens (owner: F4.1a). webOS build only: the
// screens get it from their index.webos.js (withScreenNavigation of ./f4.1a-screen.js); the desktop
// never loads it.
//
// The arrows still go through the upstream spatial-navigation-polyfill. A screen only takes the
// presses it knows better (webos/lib/navigation/board.js, discover.js, search.js): moving along a
// catalog row or the Discover grid, going between rows, and coming down from the top bar. Whatever
// it leaves (null) goes on to the polyfill: the vertical nav bar on the left (F4.1b), the preview
// panel of Discover, the filters, the menus.
//
// On top of that, each screen keeps its own focus:
// - initial focus: when the screen mounts with nothing focused, its first item gets the focus as
//   soon as it shows up (the Board waits for the catalogs of the core, ~30 s in the C8 profile);
// - restore: the screens stay mounted under the ones opened from them (src/router/Routes.tsx), so
//   the element that had the focus is still there when Back brings the screen up again; it gets the
//   focus back, or the element at the same place in the tree if it was re-rendered;
// - recovery: when the focused element goes away (a row replaced, the catalog reloading), or an
//   arrow comes with nothing focused, the focus goes back to the screen instead of the page body.
// It all applies only while the screen is the visible route.

const ARROWS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
// The Board waits for the core; past this, a screen that never got content stops waiting.
const INITIAL_FOCUS_TIMEOUT = 120000;

// Chromium 53 has no Node#isConnected.
const isAttached = (element) => Boolean(element) && element.ownerDocument.documentElement.contains(element);

// display: none on the element or an ancestor (the hidden routes, the items a row hides) leaves no box.
const isRendered = (element) => isAttached(element) && element.getClientRects().length > 0;

const isFocusable = (element) => Boolean(element) && element.tabIndex >= 0 && !element.disabled && isRendered(element);

// Nothing focused, or the focus left on an element no longer shown: the link of the screen below
// that opened this one (its route is display: none now), or one that was removed.
const isFocusLost = (document) => {
    const active = document.activeElement;
    return !active || active === document.body || active === document.documentElement || !isRendered(active);
};

// The first focusable element at or inside `element` (itself included), in DOM order.
const firstFocusable = (element) => {
    if (!element) return null;
    if (isFocusable(element)) return element;
    return Array.from(element.querySelectorAll('[tabindex], a[href], button, input')).find(isFocusable) || null;
};

// Child indexes from the container down to the element: where the element was, if it is re-rendered.
const pathOf = (element, container) => {
    const path = [];
    for (let node = element; node && node !== container; node = node.parentElement) {
        if (!node.parentElement) return null;
        path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
    }
    return path;
};

// The focusable element at that place now, or inside the deepest node of the path that still exists.
const resolvePath = (path, container) => {
    if (!Array.isArray(path)) return null;
    let node = container;
    for (const index of path) {
        const child = node.children[index];
        if (!child) break;
        node = child;
    }
    return node === container ? null : firstFocusable(node);
};

// CSS modules name classes `[local]-[hash:base64:5]` (webpack.config.js): the element with exactly
// that local name, not one whose name only starts the same (board-content vs board-content-container).
const hasLocalName = (element, local) => {
    const pattern = new RegExp(`^${local}-[A-Za-z0-9_-]{5}$`);
    return String(element.className).split(/\s+/).some((name) => pattern.test(name));
};

const queryLocal = (root, local) => {
    return Array.from(root.querySelectorAll(`[class*="${local}-"]`)).find((element) => hasLocalName(element, local)) || null;
};

// The route of this screen is the one on screen: the routes under it are display: none.
const isVisibleRoute = (container) => isRendered(container);

// A modal or dialog of the app over the screen: its own focus handling wins (F4.3, F3.2).
const hasOverlay = (document) => document.querySelector('[class*="modal-container"], [role="dialog"]') !== null;

// The behaviour shared by the three screens, on the screen's route content element. `screen`:
// - initial(container): the element for the initial focus, or null while there is none yet;
// - navigate(target, dir, container, memory): an element to focus, `true` to swallow the press, or
//   null to leave it to the spatial navigation; `memory.last` is the last focused element of the
//   screen, `memory.content` the last one inside its lists (to go back to from the top bar);
// - isContent(element, container): the element is in the screen's lists;
// - align(element, container): scrolls the lists so the focused element shows (optional).
const createScreenFocus = (container, screen, { window: win = window, timeout = INITIAL_FOCUS_TIMEOUT } = {}) => {
    const document = win.document;
    const memory = { last: null, path: null, content: null };
    let waiting = null;

    const focus = (element) => {
        element.focus();
        return document.activeElement === element;
    };

    // `from`: { last, path }, the memory or what it held when the route was left.
    const target = (from = memory) => {
        if (isFocusable(from.last) && container.contains(from.last)) return from.last;
        return resolvePath(from.path, container) || screen.initial(container);
    };

    const stopWaiting = () => {
        if (waiting !== null) {
            waiting.observer.disconnect();
            win.clearTimeout(waiting.timer);
            waiting = null;
        }
    };

    // Focus for a screen with nothing focused; when the content is not there yet, waits for it
    // (DOM mutations under the screen), as long as nothing else took the focus in between.
    const ensureFocus = () => {
        if (!isVisibleRoute(container) || !isFocusLost(document) || hasOverlay(document)) return false;
        const element = target();
        if (element) {
            stopWaiting();
            return focus(element);
        }
        if (waiting === null) {
            const observer = new win.MutationObserver(() => {
                if (!isFocusLost(document)) {
                    stopWaiting();
                    return;
                }
                const next = target();
                if (next && isVisibleRoute(container)) {
                    stopWaiting();
                    focus(next);
                }
            });
            observer.observe(container, { childList: true, subtree: true });
            waiting = { observer, timer: win.setTimeout(stopWaiting, timeout) };
        }
        return false;
    };

    // Another route on top: what had the focus here is what Back should come back to.
    let left = null;
    const leave = () => {
        left = { last: memory.last, path: memory.path };
    };

    // Back to this screen: the element it was left from, even if the screen focused something on its
    // own meanwhile (the search field of Search takes the focus whenever the route comes back).
    const restore = () => {
        if (!isVisibleRoute(container) || hasOverlay(document)) return false;
        const element = target(left || memory);
        left = null;
        if (!element) return ensureFocus();
        if (document.activeElement !== element) focus(element);
        if (screen.align) screen.align(element, container);
        return true;
    };

    const onFocusIn = (event) => {
        const element = event.target;
        if (!container.contains(element)) return;
        memory.last = element;
        memory.path = pathOf(element, container);
        if (screen.isContent(element, container)) memory.content = element;
        stopWaiting();
        if (screen.align) screen.align(element, container);
    };

    // The focused element was removed or hidden (a placeholder row replaced, the grid reloading):
    // the focus would stay on the body, where the arrows start over from the top of the page.
    // A blur with the element still shown (a click on the background in pointer mode) is left alone.
    // Chromium may also drop the focus of a removed element without any event: the next arrow
    // (onWindowKeyDown) brings it back then.
    const onFocusOut = (event) => {
        const element = event.target;
        // The focus going to another element (relatedTarget) is a move, not a loss.
        const next = event.relatedTarget;
        if ((next && next.nodeType === 1) || element !== memory.last) return;
        win.setTimeout(() => {
            if (!isFocusable(element) && isFocusLost(document)) ensureFocus();
        }, 0);
    };

    const onKeyDown = (event) => {
        const dir = ARROWS[event.keyCode];
        if (!dir || event.defaultPrevented || !isVisibleRoute(container)) return;
        const result = screen.navigate(event.target, dir, container, memory);
        if (!result) return;
        event.preventDefault();
        if (result !== true && result !== document.activeElement) focus(result);
    };

    // An arrow with nothing focused: the screen's own element first, before the spatial navigation
    // starts from the top of the page (capture, so it runs before the polyfill's window listener).
    const onWindowKeyDown = (event) => {
        if (!ARROWS[event.keyCode] || event.defaultPrevented || !isFocusLost(document)) return;
        if (ensureFocus()) event.preventDefault();
    };

    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('focusout', onFocusOut);
    container.addEventListener('keydown', onKeyDown);
    win.addEventListener('keydown', onWindowKeyDown, true);

    return {
        memory,
        ensureFocus,
        leave,
        restore,
        destroy: () => {
            stopWaiting();
            container.removeEventListener('focusin', onFocusIn);
            container.removeEventListener('focusout', onFocusOut);
            container.removeEventListener('keydown', onKeyDown);
            win.removeEventListener('keydown', onWindowKeyDown, true);
        },
    };
};

module.exports = {
    ARROWS,
    createScreenFocus,
    firstFocusable,
    hasLocalName,
    isFocusable,
    isFocusLost,
    isRendered,
    pathOf,
    queryLocal,
    resolvePath,
};
