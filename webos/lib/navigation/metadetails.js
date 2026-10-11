// Remote control navigation of the details page (MetaDetails: info column, episodes and streams
// list), F4.1c. Plain DOM, no React: src/routes/MetaDetails/MetaDetails.webos.js creates one
// controller per mounted page and tells it the route state. The arrows stay with the upstream
// spatial-navigation-polyfill; this module only fixes what it gets wrong on this page:
//
// - Scrolling. The polyfill calls scrollIntoView() (top aligned) on every move, so the item above
//   the focused one is always out of view and UP took two presses per item (one to scroll 40px,
//   one to focus). While an arrow of this page is handled, that call keeps the item in view with
//   a margin instead (keepInView): the neighbours stay partly visible, one press per item.
// - Sections. The page has three: the nav bar, the info column (MetaPreview) and the list (episodes
//   or streams). The two last ones are spatial navigation containers (styles.webos.less), and when
//   the polyfill finds nothing inside one (navnotarget) the move is decided here: RIGHT from the
//   column goes to the list (to the item focused there before), LEFT from the list to the column,
//   UP from the column to the back button, and nothing leaves the bottom of either. Without this,
//   UP from the top of the column landed on a stream and RIGHT from a stream on the addon filter.
// - Initial focus and restoration. Opening the page focuses the selected episode (or the first
//   one), or, for a streams list, the list panel itself: a stream item with the focus freezes the
//   order of the C8 ranking (F6.2), whose probes may still reorder the top of the list until the
//   first key. From the panel, DOWN, RIGHT or OK enters the first stream, UP the list header and
//   LEFT the column. Coming back to the page (Back from a route above, the Player closing, the
//   streams list going back to the episodes) focuses the element focused there last. Never while
//   the Magic Remote pointer is in use (F4.2).
// - The summary. With the TV zoom (F2.6) the info column overflows and the summary has no focusable
//   element, so it could not be reached: it gets a tabindex while the column overflows, and the
//   arrows scroll the column while it has the focus.
// - OK on the library/watched toggles and ratings (ActionsGroup: a div with only onClick).

'use strict';

const KEYS = { 13: 'ok', 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

// CSS modules class names are `[local]-[hash]`: matched by prefix.
const SELECTORS = {
    container: '[class*="metadetails-container"]',
    navBar: '[class*="nav-bar"]',
    navBack: '[class*="back-button-container"]',
    meta: '[class*="meta-preview"]',
    metaInfo: '[class*="meta-info-container"]',
    description: '[class*="description-container"]',
    actions: '[class*="action-buttons-container"]',
    list: '[class*="streams-list"], [class*="videos-list"]',
    streamsList: '[class*="streams-list"]',
    item: '[class*="stream-container"], [class*="video-container"]',
    selectedItem: '[class*="video-container"][class*="selected"]',
    actionsGroupItem: '[class*="group-container"] > [class*="icon-container"]',
    // Menus and popups inside a section handle their own arrows (F4.3).
    overlay: '[class*="dropdown"], [class*="menu-container"], [class*="popup-menu"], [class*="modal"]',
};

const FOCUSABLE = '[tabindex], a[href], button, input, select, textarea';

// How long a focus to restore is waited for, and how often it is looked for meanwhile.
const RESTORE_WAIT = 3000;
const RESTORE_RETRY = 250;

// Last focused element of each page path, across mounts (Back from a route above remounts the page).
const MEMORY_SIZE = 32;
const memory = new Map();

const remember = (key, value) => {
    memory.delete(key);
    memory.set(key, value);
    if (memory.size > MEMORY_SIZE) {
        memory.delete(memory.keys().next().value);
    }
};

// Pointer or keys: the last input that came. The Magic Remote's cursorStateChange tells when the
// pointer shows or hides (webos/magic-remote). Unknown (nothing yet) counts as keys.
let lastInput = null;
const installInputTracking = (win) => {
    if (!win || win.__webosMetaDetailsInput) return;
    win.__webosMetaDetailsInput = true;
    win.addEventListener('keydown', () => { lastInput = 'keys'; }, true);
    win.addEventListener('mousedown', (event) => { if (event.isTrusted !== false) lastInput = 'pointer'; }, true);
    if (win.document) {
        win.document.addEventListener('cursorStateChange', (event) => {
            const visibility = event.detail && event.detail.visibility;
            if (visibility === true) lastInput = 'pointer';
            else if (visibility === false) lastInput = 'keys';
        });
    }
};
const pointerInUse = (doc) => {
    const mode = doc.documentElement.getAttribute('data-webos-pointer');
    return mode === 'visible' || (mode === null && lastInput === 'pointer');
};

const matches = (element, selector) => !!element && element.nodeType === 1 && element.matches(selector);

const isRendered = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
};

const isFocusable = (element) => element.tabIndex >= 0 && !element.disabled && isRendered(element);

const focusablesIn = (root) => (root ? Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), isFocusable) : []);

const firstFocusable = (root) => focusablesIn(root)[0] || null;

const insideOverlay = (element, section) => {
    for (let node = element; node && node !== section; node = node.parentElement) {
        if (matches(node, SELECTORS.overlay)) return true;
    }
    return false;
};

// The scrollable ancestors of an element, up to (not including) stop.
const scrollParents = (element, stop, win) => {
    const parents = [];
    for (let node = element.parentElement; node && node !== stop; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        const y = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1;
        const x = (style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1;
        if (x || y) parents.push({ node, x, y });
    }
    return parents;
};

// Scroll offset that keeps [start, end] inside [min, max] with the margin, or 0.
const offsetInto = (start, end, min, max, margin) => {
    if (end - start > max - min - 2 * margin) {
        return start - (min + margin);
    }
    if (start < min + margin) return start - (min + margin);
    if (end > max - margin) return end - (max - margin);
    return 0;
};

// Keeps the element in view in each scrollable ancestor (inner first), with a margin of half the
// element, up to a quarter of the container, so the next item in each direction stays partly
// visible: the polyfill only moves the focus to visible elements (its hitTest). Rects may be in
// screen pixels (the F2.6 zoom, src/common/interfaceScale.webos.ts) while scrollTop is in CSS
// pixels: the ratio of the container's rect to its offset size converts them.
const keepInView = (element, stop, win) => {
    scrollParents(element, stop, win).forEach(({ node, x, y }) => {
        const box = node.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        if (y) {
            const ratio = node.offsetHeight > 0 ? box.height / node.offsetHeight : 1;
            const margin = Math.min(rect.height / 2, box.height / 4);
            const delta = offsetInto(rect.top, rect.bottom, box.top, box.bottom, margin);
            if (delta !== 0 && ratio > 0) node.scrollTop += delta / ratio;
        }
        if (x) {
            const ratio = node.offsetWidth > 0 ? box.width / node.offsetWidth : 1;
            const margin = Math.min(rect.width / 2, box.width / 4);
            const delta = offsetInto(rect.left, rect.right, box.left, box.right, margin);
            if (delta !== 0 && ratio > 0) node.scrollLeft += delta / ratio;
        }
    });
};

// Where an element is, to find it again after a remount: its link (streams), its title (episodes,
// buttons) and its position among the focusable elements of its section.
const locate = (element, section) => ({
    href: element.getAttribute('href'),
    title: element.getAttribute('title'),
    text: (element.textContent || '').trim().slice(0, 80),
    index: focusablesIn(section).indexOf(element),
});

const resolve = (locator, section) => {
    const candidates = focusablesIn(section);
    const byHref = locator.href ? candidates.filter((element) => element.getAttribute('href') === locator.href) : [];
    if (byHref.length > 0) return byHref[0];
    const byLabel = candidates.filter((element) => (
        element.getAttribute('title') === locator.title && (element.textContent || '').trim().slice(0, 80) === locator.text
    ));
    if (byLabel.length > 0) return byLabel[0];
    return locator.index >= 0 && locator.index < candidates.length ? candidates[locator.index] : null;
};

const createMetaDetailsNavigation = ({ root, window: win }) => {
    const doc = win.document;
    installInputTracking(win);

    let destroyed = false;
    let routeActive = true;
    let pathname = null;
    let restore = false;
    // Until then a focus to restore that is not there yet is waited for (the page is still loading:
    // the streams may be cached while the info column is a placeholder); then the default.
    let restoreUntil = 0;
    let tickTimer = null;
    let nativeScrollIntoView = null;

    const sections = () => {
        const container = root.querySelector(SELECTORS.container);
        if (!container) return null;
        const meta = container.querySelector(SELECTORS.meta);
        const list = container.querySelector(SELECTORS.list);
        let navBar = null;
        for (let child = container.firstElementChild; child; child = child.nextElementSibling) {
            if (matches(child, SELECTORS.navBar)) navBar = child;
        }
        return { container, navBar, meta, list, streams: matches(list, SELECTORS.streamsList) };
    };

    const sectionOf = (parts, element) => {
        if (!parts || !element) return null;
        if (parts.list && parts.list.contains(element)) return 'list';
        if (parts.meta && parts.meta.contains(element)) return 'meta';
        if (parts.navBar && parts.navBar.contains(element)) return 'nav';
        return null;
    };

    const listItems = (parts) => (
        parts.list ? Array.prototype.filter.call(parts.list.querySelectorAll(SELECTORS.item), isFocusable) : []
    );

    const focus = (element) => {
        if (!element) return false;
        element.focus();
        if (doc.activeElement !== element) return false;
        keepInView(element, root, win);
        return true;
    };

    // The summary is reachable while the column overflows.
    const prepare = (parts) => {
        const info = parts.meta ? parts.meta.querySelector(SELECTORS.metaInfo) : null;
        const description = info ? info.querySelector(SELECTORS.description) : null;
        if (description) {
            const overflows = info.scrollHeight > info.clientHeight + 1;
            if (overflows && description.getAttribute('tabindex') === null) description.setAttribute('tabindex', '0');
            else if (!overflows && description.getAttribute('tabindex') === '0' && doc.activeElement !== description) description.removeAttribute('tabindex');
        }
    };

    const metaTarget = (parts) => {
        const saved = memory.get(`${pathname}#meta`);
        const restored = saved && parts.meta ? resolve(saved, parts.meta) : null;
        return restored || firstFocusable(parts.meta && parts.meta.querySelector(SELECTORS.actions)) || firstFocusable(parts.meta);
    };

    const listTarget = (parts) => {
        const saved = memory.get(`${pathname}#list`);
        const restored = saved && parts.list ? resolve(saved, parts.list) : null;
        if (restored) return restored;
        const items = listItems(parts);
        const selected = items.filter((item) => matches(item, SELECTORS.selectedItem))[0];
        return selected || items[0] || firstFocusable(parts.list);
    };

    // The page's default focus. null while the content is still loading.
    const defaultTarget = (parts) => {
        if (parts.list && parts.streams) {
            if (listItems(parts).length > 0) {
                parts.list.setAttribute('tabindex', '-1');
                return parts.list;
            }
            return null;
        }
        if (parts.list) {
            const items = listItems(parts);
            if (items.length > 0) return items.filter((item) => matches(item, SELECTORS.selectedItem))[0] || items[0];
        }
        return null;
    };

    // Not a text field: focusing one opens the system keyboard.
    const fallbackTarget = (parts) => (
        focusablesIn(parts.list).filter((element) => element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA')[0] || metaTarget(parts)
    );

    // The focus is somewhere that keeps it: this page, a modal or a popup in a portal. Not the body,
    // a removed element or another route (the poster of the Board keeps the focus under this page).
    const hasFocusHere = () => {
        const active = doc.activeElement;
        if (!active || active === doc.body || !doc.documentElement.contains(active)) return false;
        const route = active.closest('.route-container');
        return route === null || route === root.closest('.route-container');
    };

    // Focuses what the page should have focused now; false while the content is still loading.
    const placeFocus = (parts) => {
        let target = null;
        if (restore) {
            const saved = memory.get(pathname);
            if (saved && saved.section === 'listEntry' && parts.list && parts.streams) {
                parts.list.setAttribute('tabindex', '-1');
                target = parts.list;
            } else if (saved) {
                const section = saved.section === 'list' ? parts.list : saved.section === 'meta' ? parts.meta : parts.navBar;
                target = section ? resolve(saved.locator, section) : null;
                if (target === null && Date.now() < restoreUntil) {
                    schedule(RESTORE_RETRY);
                    return false;
                }
            }
        }
        target = target || defaultTarget(parts);
        if (target === null && parts.list && !parts.list.querySelector(SELECTORS.item) && !root.querySelector('[class*="placeholder"]')) {
            // Nothing to list (no addons, no streams, an error): the list's own buttons or the column.
            target = fallbackTarget(parts);
        }
        return focus(target);
    };

    const tick = () => {
        tickTimer = null;
        if (destroyed || !routeActive) return;
        const parts = sections();
        if (!parts) return;
        prepare(parts);
        if (hasFocusHere() || pointerInUse(doc)) return;
        placeFocus(parts);
    };

    const schedule = (delay = 60) => {
        if (tickTimer === null && !destroyed) tickTimer = win.setTimeout(tick, delay);
    };

    const onFocusIn = (event) => {
        if (!routeActive || pathname === null) return;
        const parts = sections();
        const element = event.target;
        if (parts && element === parts.list) {
            remember(pathname, { section: 'listEntry' });
            return;
        }
        const section = sectionOf(parts, element);
        if (section === null) return;
        const sectionElement = section === 'list' ? parts.list : section === 'meta' ? parts.meta : parts.navBar;
        if (insideOverlay(element, sectionElement)) return;
        const locator = locate(element, sectionElement);
        remember(pathname, { section, locator });
        if (section !== 'nav') remember(`${pathname}#${section}`, locator);
    };

    const restoreScrollIntoView = () => {
        if (nativeScrollIntoView !== null) {
            win.Element.prototype.scrollIntoView = nativeScrollIntoView;
            nativeScrollIntoView = null;
        }
    };

    // The polyfill's scrollIntoView() (no argument) on an element of this page keeps it in view.
    const patchScrollIntoView = () => {
        if (nativeScrollIntoView !== null) return;
        const native = win.Element.prototype.scrollIntoView;
        nativeScrollIntoView = native;
        win.Element.prototype.scrollIntoView = function scrollIntoView() {
            if (arguments.length === 0 && root.contains(this)) {
                keepInView(this, root, win);
                return undefined;
            }
            return native.apply(this, arguments);
        };
        // The polyfill handles the key in the same dispatch; this is a guard if its listener throws.
        win.setTimeout(restoreScrollIntoView, 0);
    };

    // preventDefault() is enough to keep the polyfill (and the Button's Enter) out; the propagation
    // goes on, so the focus-visible polyfill still sees the key.
    const consume = (event) => {
        event.preventDefault();
    };

    // Before the polyfill (capture on window).
    const onKeyDownCapture = (event) => {
        const key = KEYS[event.keyCode];
        if (!key || destroyed || !routeActive || event.defaultPrevented) return;
        const parts = sections();
        if (!parts) return;
        // No focus on this page yet (still loading, the pointer was in use): the first arrow places it.
        // Not left to the polyfill: it would move from an element of the route below.
        if (!hasFocusHere()) {
            if (key !== 'ok') {
                if (!placeFocus(parts)) focus(firstFocusable(parts.container));
                consume(event);
            }
            return;
        }
        const active = doc.activeElement;
        if (!root.contains(active)) return;

        // The streams list panel (initial focus): enters the list.
        if (active === parts.list) {
            let target = null;
            if (key === 'down' || key === 'right' || key === 'ok') target = listItems(parts)[0] || firstFocusable(parts.list);
            else if (key === 'up') target = focusablesIn(parts.list).filter((element) => !matches(element, SELECTORS.item))[0] || firstFocusable(parts.navBar);
            else if (key === 'left') target = metaTarget(parts);
            if (target) focus(target);
            consume(event);
            return;
        }
        if (key === 'ok') return;

        // The action buttons row and the summary. The polyfill measures the whole box of an element,
        // also the part the column has scrolled out of view: a summary cut by the bottom of the column
        // overlapped the row, and RIGHT from Trailer went up to it. LEFT/RIGHT follow the row; past
        // its end, and from the summary, RIGHT goes to the list.
        const actions = parts.meta ? parts.meta.querySelector(SELECTORS.actions) : null;
        const inRow = actions !== null && actions.contains(active) && !insideOverlay(active, actions);
        // UP from the row: the bottom of the column above it, the summary, even when the column is
        // scrolled to the top and the summary is below the fold (the polyfill only sees what shows).
        if (inRow && key === 'up') {
            const above = focusablesIn(parts.meta.querySelector(SELECTORS.metaInfo));
            if (above.length > 0) {
                focus(above[above.length - 1]);
                consume(event);
                return;
            }
        }
        if ((inRow || matches(active, SELECTORS.description)) && (key === 'left' || key === 'right')) {
            const row = inRow ? focusablesIn(actions) : [];
            const next = row[row.indexOf(active) + (key === 'right' ? 1 : -1)] || null;
            if (next) focus(next);
            else if (key === 'right' && parts.list) focus(listTarget(parts));
            consume(event);
            return;
        }

        // A list item: LEFT goes to the column, RIGHT only into the item (the episode's play button).
        const item = parts.list && parts.list.contains(active) ? active.closest(SELECTORS.item) : null;
        if (item && (key === 'left' || key === 'right')) {
            if (key === 'right' && active === item) {
                const inner = focusablesIn(item)[0] || null;
                if (inner) focus(inner);
                consume(event);
                return;
            }
            if (key === 'left') {
                focus(metaTarget(parts));
                consume(event);
                return;
            }
        }
        patchScrollIntoView();
    };

    // After the polyfill (window listeners run in the order they were added; the polyfill's first).
    const onKeyDown = (event) => {
        restoreScrollIntoView();
        if (KEYS[event.keyCode] !== 'ok' || event.defaultPrevented || destroyed || !routeActive) return;
        const active = doc.activeElement;
        if (active && root.contains(active) && matches(active, SELECTORS.actionsGroupItem)) {
            event.preventDefault();
            active.click();
        }
    };

    // The polyfill found nothing in a section (bubbles from the container, cancelable).
    const onNavNoTarget = (event) => {
        if (destroyed || !routeActive) return;
        const parts = sections();
        if (!parts) return;
        const container = event.target;
        const section = container === parts.meta ? 'meta' : container === parts.list ? 'list' : null;
        if (section === null) return;
        const detail = event.detail || {};
        const from = detail.causedTarget;
        if (from && insideOverlay(from, container)) return;
        const dir = detail.dir;
        let target = null;
        if (section === 'meta') {
            if (dir === 'right') target = parts.list ? listTarget(parts) : null;
            else if (dir === 'up') {
                // The upstream back button has tabIndex -1 (the remote has Back): then whatever the bar
                // has, or nothing.
                const back = parts.navBar ? parts.navBar.querySelector(SELECTORS.navBack) : null;
                target = back && isFocusable(back) ? back : firstFocusable(parts.navBar);
            }
        } else if (dir === 'left') {
            target = metaTarget(parts);
        } else if (dir === 'up') {
            return;
        }
        event.preventDefault();
        if (target && isFocusable(target)) focus(target);
    };

    const observer = new win.MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener('focusin', onFocusIn);
    win.addEventListener('keydown', onKeyDownCapture, true);
    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('navnotarget', onNavNoTarget);

    return {
        // The page path changed (or the first one): a pushed page opens on its default focus, one
        // reached by Back or replaced in place (streams <-> episodes) gets its last focus back.
        setLocation(nextPathname, navigationType) {
            pathname = nextPathname;
            restore = navigationType !== 'PUSH';
            restoreUntil = restore ? Date.now() + RESTORE_WAIT : 0;
            schedule();
        },
        // The route below the top one is not active (the Player on top of the page); coming back
        // restores the focus.
        setRouteActive(active) {
            if (active && !routeActive) {
                restore = true;
                restoreUntil = Date.now() + RESTORE_WAIT;
            }
            routeActive = active;
            if (!active) restoreScrollIntoView();
            schedule();
        },
        destroy() {
            destroyed = true;
            win.clearTimeout(tickTimer);
            observer.disconnect();
            root.removeEventListener('focusin', onFocusIn);
            win.removeEventListener('keydown', onKeyDownCapture, true);
            win.removeEventListener('keydown', onKeyDown);
            win.removeEventListener('navnotarget', onNavNoTarget);
            restoreScrollIntoView();
        },
        // For tests.
        tick,
    };
};

module.exports = {
    SELECTORS,
    createMetaDetailsNavigation,
    keepInView,
    locate,
    resolve,
    offsetInto,
    _memory: memory,
    _setLastInput: (value) => { lastInput = value; },
};
