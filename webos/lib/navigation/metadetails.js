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
//   first key. The panel is drawn as its first stream focused (F8.3): from it, OK plays that stream,
//   DOWN goes to the second, RIGHT focuses the first, UP the list header (the addon filter; with
//   one addon there is none and the focus stays) and LEFT the column. Coming back to the page (Back from a route above, the Player closing, the
//   streams list going back to the episodes) focuses the element focused there last, waiting while
//   its section is still loading (RESTORE_GUARD). Never while the Magic Remote pointer is in use
//   (F4.2). An OK while the page opens is kept from the poster of the Board, which still has the
//   focus under it.
// - The summary. With the TV zoom (F2.6) the info column overflows and the summary has no focusable
//   element, so it could not be reached: it gets a tabindex while the column overflows, and the
//   arrows scroll the column while it has the focus.
// - OK on the library/watched toggles and ratings (ActionsGroup: a div with only onClick).
// The generic parts (focusable elements, scrolling with a margin, finding an element again after a
// remount, the keys, the focus events and the input mode) are the navigation core's (./core).

'use strict';

const { focusablesIn, firstFocusable, isFocusable, isRendered } = require('./core/dom');
const { createKeyedMemory, locate, resolve } = require('./core/memory');
const { keepInView: keepInViewUpTo, offsetInto } = require('./core/scroll');
const { PRIORITY, getInputHub } = require('./core/input');

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
    // The top of the streams list: the addon filter, and the back button of an episode's streams.
    listHeader: '[class*="select-choices-wrapper"]',
    item: '[class*="stream-container"], [class*="video-container"]',
    selectedItem: '[class*="video-container"][class*="selected"]',
    actionsGroupItem: '[class*="group-container"] > [class*="icon-container"]',
    // Menus and popups inside a section handle their own arrows (F4.3).
    overlay: '[class*="dropdown"], [class*="menu-container"], [class*="popup-menu"], [class*="modal"]',
};

// A focus to restore is waited for while its section is still loading (a placeholder): in the C8
// profile the info column took 6.4 s to come back after Back from Discover, with the streams already
// on screen from the cache. The guard only caps the wait; past it the default focus goes in, and the
// restored one replaces it when it shows up, if no key came meanwhile.
const RESTORE_GUARD = 15000;
const RESTORE_RETRY = 250;
const PLACEHOLDER = '[class*="placeholder"]';
// The info column still loading is MetaPreview.Placeholder. A loaded column may hold a placeholder
// too: the title of a movie without a logo (MetaPreview's logo-placeholder).
const META_PLACEHOLDER = '[class*="meta-preview-placeholder"]';

// Last focused element of each page path, across mounts (Back from a route above remounts the page).
const MEMORY_SIZE = 32;
const memory = createKeyedMemory(MEMORY_SIZE);
const remember = (key, value) => memory.set(key, value);

const matches = (element, selector) => !!element && element.nodeType === 1 && element.matches(selector);

const insideOverlay = (element, section) => {
    for (let node = element; node && node !== section; node = node.parentElement) {
        if (matches(node, SELECTORS.overlay)) return true;
    }
    return false;
};

// Keeps the element in view in each scrollable ancestor up to `stop`, with a margin so the next item
// in each direction stays partly visible: the polyfill only moves the focus to visible elements (its
// hitTest). See ./core/scroll.js.
const keepInView = (element, stop) => keepInViewUpTo(element, stop);

// Pointer or keys: the last input that came (F4.1c's own tracking, kept on purpose). The Magic
// Remote's cursorStateChange tells when the pointer shows or hides (webos/magic-remote); a pointer
// move alone is not pointer use. Unknown (nothing yet) counts as keys. With the pointer mode of the
// input hub instead, the renderer kept ~15 MB more after the second opening of this page in the c8
// profile (review F4.4 c1, M2; the bisection is in the F4.4 report): the page keeps this one.
let lastInput = null;
const installInputTracking = (win) => {
    if (win.__webosMetaDetailsInput) return;
    win.__webosMetaDetailsInput = true;
    win.addEventListener('keydown', () => { lastInput = 'keys'; }, true);
    win.addEventListener('mousedown', (event) => { if (event.isTrusted !== false) lastInput = 'pointer'; }, true);
    win.document.addEventListener('cursorStateChange', (event) => {
        const visibility = event.detail && event.detail.visibility;
        if (visibility === true) lastInput = 'pointer';
        else if (visibility === false) lastInput = 'keys';
    });
};

const createMetaDetailsNavigation = ({ root, window: win, hub = getInputHub(win) }) => {
    const doc = win.document;
    installInputTracking(win);
    const pointerInUse = () => {
        const mode = doc.documentElement.getAttribute('data-webos-pointer');
        return mode === 'visible' || (mode === null && lastInput === 'pointer');
    };

    let destroyed = false;
    let routeActive = true;
    let pathname = null;
    let restore = false;
    // The guard of the wait for a focus to restore (RESTORE_GUARD).
    let restoreUntil = 0;
    // The default focus went in while the section of the focus to restore was still loading:
    // { saved, placed }. Cleared by a key or once the section loaded.
    let late = null;
    // A key came since the page was reached (setLocation, the route active again).
    let keyPressed = false;
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

    // The focus this module places is for the remote (never while the pointer is in use), so it
    // shows the ring as the focus-visible polyfill does after a key (same class and attribute, which
    // the polyfill takes off on blur). The polyfill may think the pointer is in use when it is not:
    // Back never reaches it (the F3.2 dispatcher takes the key) and the overlay bridge of F3.2
    // closes the Player menus with a mouse press, so the stream focused again after the Player had
    // no ring.
    const focus = (element) => {
        if (!element) return false;
        element.focus();
        if (doc.activeElement !== element) return false;
        if (!pointerInUse() && !element.hasAttribute('data-focus-visible-added')) {
            element.classList.add('focus-visible');
            element.setAttribute('data-focus-visible-added', '');
        }
        keepInView(element, root);
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

    const inOtherRoute = (element) => {
        const route = element && element.nodeType === 1 ? element.closest('.route-container') : null;
        return route !== null && route !== root.closest('.route-container');
    };

    // The section of a saved focus is still a placeholder (the column), or has no items yet (the list).
    const isLoading = (parts, section) => {
        if (section === 'meta') return !parts.meta || matches(parts.meta, META_PLACEHOLDER) || parts.meta.querySelector(META_PLACEHOLDER) !== null;
        if (section === 'list') return !parts.list || (listItems(parts).length === 0 && parts.list.querySelector(PLACEHOLDER) !== null);
        return false;
    };

    const savedSection = (parts, saved) => (
        saved.section === 'list' ? parts.list : saved.section === 'meta' ? parts.meta : parts.navBar
    );

    // Focuses what the page should have focused now; false while the content is still loading.
    const placeFocus = (parts) => {
        let target = null;
        let pending = null;
        if (restore) {
            const saved = memory.get(pathname);
            // The panel of a streams list. Not on another page: the panel may have been focused
            // under a new path while its old content was still on screen (a series opened from a
            // movie in the same page), and an episodes list has no panel.
            if (saved && saved.section === 'listEntry') {
                if (parts.list && parts.streams) {
                    parts.list.setAttribute('tabindex', '-1');
                    target = parts.list;
                }
            } else if (saved) {
                const section = savedSection(parts, saved);
                target = section ? resolve(saved.locator, section) : null;
                if (target === null && isLoading(parts, saved.section)) {
                    if (Date.now() < restoreUntil) {
                        schedule(RESTORE_RETRY);
                        return false;
                    }
                    pending = saved;
                }
            }
        }
        target = target || defaultTarget(parts);
        if (target === null && parts.list && !parts.list.querySelector(SELECTORS.item) && !parts.list.querySelector(PLACEHOLDER) && !isLoading(parts, 'meta')) {
            // Nothing to list (no addons, no streams, an error): the list's own buttons or the column.
            // Not while the list or the column still load; the title of a movie without a logo is no
            // loading placeholder (MetaPreview's logo-placeholder).
            target = fallbackTarget(parts);
        }
        const placed = focus(target);
        if (placed && pending !== null && !keyPressed) late = { saved: pending, placed: target };
        return placed;
    };

    // The focus to restore showed up after the default one went in: it takes its place, unless a key
    // came or the focus moved since.
    const restoreLate = (parts) => {
        if (keyPressed || doc.activeElement !== late.placed) {
            late = null;
            return;
        }
        if (isLoading(parts, late.saved.section)) {
            schedule(RESTORE_RETRY);
            return;
        }
        const section = savedSection(parts, late.saved);
        const target = section ? resolve(late.saved.locator, section) : null;
        late = null;
        if (target) focus(target);
    };

    const tick = () => {
        tickTimer = null;
        if (destroyed || !routeActive) return;
        const parts = sections();
        if (!parts) return;
        // The page is not on screen yet: the Player's node stays in place for a moment after it
        // closes (holdVideosInPlace, F5.6) and covers the page, and its removal is no mutation of
        // this page. A focus to restore is waited for meanwhile, within the guard.
        if (!isRendered(root)) {
            if (restore && Date.now() < restoreUntil) schedule(RESTORE_RETRY);
            return;
        }
        prepare(parts);
        // Nothing moves the focus while the pointer is in use, a late restore included.
        if (pointerInUse()) return;
        if (late !== null) restoreLate(parts);
        if (hasFocusHere()) return;
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
                keepInView(this, root);
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

    // Before the polyfill (the input hub: capture on window).
    const onKeyDownCapture = (event) => {
        const key = KEYS[event.keyCode];
        if (!key || destroyed || !routeActive || event.defaultPrevented) return;
        // The user took over: no late restore moves the focus from now on.
        keyPressed = true;
        late = null;
        const parts = sections();
        if (!parts) return;
        // No focus on this page yet (still loading, the pointer was in use): the first arrow places it.
        // Not left to the polyfill: it would move from an element of the route below.
        if (!hasFocusHere()) {
            if (key === 'ok') {
                // The poster of the Board keeps the focus under the page while it opens: its Button
                // clicks on the keydown and would open this page again (a second history entry).
                // Stopped here, before the event reaches it.
                if (inOtherRoute(doc.activeElement)) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }
            // A key while a focus to restore is awaited: the wait ends, what is there gets the focus.
            restoreUntil = 0;
            if (!placeFocus(parts)) focus(firstFocusable(parts.container));
            consume(event);
            return;
        }
        const active = doc.activeElement;
        if (!root.contains(active)) return;

        // The streams list panel (initial focus): enters the list. The panel is drawn as its first
        // stream focused (styles.webos.less, F8.3), so the keys act as if it were: OK plays it, DOWN
        // goes to the second one, RIGHT shows the focus on the first.
        if (active === parts.list) {
            const items = listItems(parts);
            let target = null;
            if (key === 'ok' || key === 'right') target = items[0] || firstFocusable(parts.list);
            else if (key === 'down') target = items[1] || items[0] || firstFocusable(parts.list);
            else if (key === 'up') target = firstFocusable(parts.list.querySelector(SELECTORS.listHeader));
            else if (key === 'left') target = metaTarget(parts);
            if (target && focus(target) && key === 'ok' && target === items[0]) target.click();
            consume(event);
            return;
        }
        if (key === 'ok') return;

        // DOWN from the bar on top (UP from the top of the column reaches its buttons, the profile
        // one since F4.1b): back to the column element focused before, not to the list below.
        if (key === 'down' && parts.navBar && parts.navBar.contains(active) && !insideOverlay(active, parts.navBar)) {
            const target = metaTarget(parts);
            if (target) focus(target);
            consume(event);
            return;
        }

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
        // Not a disabled one (the ratings while they load): upstream only blocks its pointer events.
        if (active && root.contains(active) && matches(active, SELECTORS.actionsGroupItem) && !matches(active, '[class*="disabled"]')) {
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
    const removeFocus = hub.onFocus((event) => {
        if (root.contains(event.target)) onFocusIn(event);
    });
    const removeKey = hub.onKey(onKeyDownCapture, PRIORITY.screen);
    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('navnotarget', onNavNoTarget);

    return {
        // The page path changed (or the first one): a pushed page opens on its default focus, one
        // reached by Back or replaced in place (streams <-> episodes) gets its last focus back.
        setLocation(nextPathname, navigationType) {
            pathname = nextPathname;
            restore = navigationType !== 'PUSH';
            restoreUntil = restore ? Date.now() + RESTORE_GUARD : 0;
            late = null;
            keyPressed = false;
            schedule();
        },
        // The route below the top one is not active (the Player on top of the page); coming back
        // restores the focus.
        setRouteActive(active) {
            if (active && !routeActive) {
                restore = true;
                restoreUntil = Date.now() + RESTORE_GUARD;
                late = null;
                keyPressed = false;
            }
            routeActive = active;
            if (!active) restoreScrollIntoView();
            schedule();
        },
        destroy() {
            destroyed = true;
            win.clearTimeout(tickTimer);
            observer.disconnect();
            removeFocus();
            removeKey();
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
    _setLastInput: (value) => {
        lastInput = value === 'key' ? 'keys' : value;
    },
};
