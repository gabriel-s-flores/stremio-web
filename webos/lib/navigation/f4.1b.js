// Remote control navigation of Library, Calendar, Addons and Settings, and of the side navigation
// bar of every screen (F4.1b). It sits on top of the upstream spatial-navigation-polyfill and only
// takes an arrow key from it where the polyfill gets it wrong; everything else is left to it.
//
// - Initial focus: when a screen of this task is opened (or shown again by Back) and nothing in it
//   has the focus, the element it was left on gets it back; otherwise the first item of the screen
//   (the first poster, addon, calendar day or settings menu entry). Lists load after the route, so
//   the search is retried for a few seconds, and stops at the first key the user presses.
// - Focus never gets lost: an arrow with the focus on <body> (an item removed, a list reloaded)
//   puts it back on the screen's element instead of letting the polyfill start from the corner.
// - Scrolling lists: inside the vertical lists of these screens the next item UP or DOWN is searched
//   among all items of the list, not only the visible ones, and the list scrolls just enough to show
//   it with a margin. LEFT/RIGHT stay in the visible items of the same row; with none, they leave the
//   list for the closest visible element outside it (Settings: LEFT to the selected menu entry),
//   never for the bar at the top (RIGHT at the end of a row stays). RIGHT from the Settings menu goes
//   back to the row it was entered from. The polyfill only sees visible items (the row above a scrolled grid is hidden, so it
//   scrolled 40px per press) and scrolls every focused item to the top of the list
//   (scrollIntoView() runs unconditionally in focusingController). With no item in that direction
//   the list scrolls by most of its height, which also reaches non-focusable content (Settings'
//   shortcuts and info) and the end of the Library grid, where the next page loads.
// - Side navigation bar (every screen): RIGHT goes back to the item of the screen the user left it
//   from (with none, into the screen's content, never to the top bar). LEFT from the first column
//   already reaches it through the polyfill, once its buttons are focusable (NavTabButton.webos.js).
//   OK on the profile button (NavMenu.webos.js) puts the focus on the first entry of its menu.
// - Modals inside the route (the addon details of Addons): left to the modal (F4.3); what is focused
//   inside one is not where the screen restores to, so closing it goes back to the opened item.
// - Interface zoom: after the zoom changes (a resize event), the focused element is scrolled back
//   into its list.
//
// The keydown listener is on window in the capture phase, so it runs before the polyfill (window,
// bubble phase) and, when it moves the focus, preventDefault() makes the polyfill skip the key.
// No work at boot: install() only adds listeners. Classes are CSS modules (`<local>-<hash>`);
// webos/tests/navigation/f4.1b.test.js fails if the upstream ones used here are renamed.

const ARROWS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

// Retries of the initial focus while the screen loads its content. For a while only the first
// choice of the screen is taken (its list comes after the filters above it).
const INITIAL_FOCUS_RETRY_MS = 200;
const INITIAL_FOCUS_PREFERRED_MS = 1500;
const INITIAL_FOCUS_TIMEOUT_MS = 6000;
// After the initial focus, a list replaced right after (a filter of Addons) is focused again.
const INITIAL_FOCUS_VERIFY_MS = 500;
const INITIAL_FOCUS_VERIFICATIONS = 4;
// Part of the list height kept visible beyond the focused item, and scrolled when there is none.
const REVEAL_MARGIN = 0.15;
const PAGE_SCROLL = 0.6;

// Local CSS module class names: `name` must be the whole local part of a class (`list` does not
// match `list-container-ab1Cd`). The hash is 5 base64url characters.
const hasLocalClass = (element, name) => {
    const className = element && typeof element.className === 'string' ? element.className : '';
    if (className.indexOf(name + '-') === -1) return false;
    const pattern = new RegExp('^' + name + '-[\\w-]{5}$');
    return className.split(/\s+/).some((token) => pattern.test(token));
};

const queryLocal = (root, name) => Array.prototype.filter.call(
    root.querySelectorAll('[class*="' + name + '-"]'),
    (element) => hasLocalClass(element, name)
);

const closestLocal = (element, names, root) => {
    for (let node = element; node && node !== root && node.nodeType === 1; node = node.parentNode) {
        if (names.some((name) => hasLocalClass(node, name))) return node;
    }
    return null;
};

// What the screens of this task need. `paths` are the first segment of the route; `initial` is
// tried in order (a list of local classes, the first focusable inside the last one wins, or a
// function of the route container), the first `preferred` of them (default 1) right away and the
// others only after a moment; `lists` are the scrolling containers handled here. Library and
// Calendar show only a "log in" placeholder to a guest.
const SCREENS = [
    {
        name: 'library',
        paths: ['library', 'continuewatching'],
        initial: [['placeholder'], ['meta-items-container'], ['selectable-inputs-container']],
        preferred: 2,
        lists: ['meta-items-container'],
    },
    {
        name: 'calendar',
        paths: ['calendar'],
        initial: [
            ['placeholder'],
            (route) => queryLocal(route, 'cell').filter((cell) => hasLocalClass(cell, 'today'))[0],
            ['table', 'grid'],
        ],
        preferred: 2,
        lists: ['list'],
    },
    {
        name: 'addons',
        paths: ['addons'],
        initial: [['addons-list-container'], ['selectable-inputs-container']],
        lists: ['addons-list-container'],
    },
    {
        name: 'settings',
        paths: ['settings'],
        initial: [
            (route) => queryLocal(route, 'menu').map((menu) => queryLocal(menu, 'selected')[0]).filter(Boolean)[0],
            ['menu'],
            ['sections-container'],
        ],
        lists: ['sections-container'],
        // LEFT out of the sections: the entry of the section on screen; RIGHT from the menu: back to
        // the row the user left (when it is still on screen).
        leftExit: (route) => queryLocal(route, 'menu').map((menu) => queryLocal(menu, 'selected')[0]).filter(Boolean)[0],
        rightReturn: { from: 'menu', to: 'sections-container' },
    },
];

const NAV_BAR = 'vertical-nav-bar-container';
const HORIZONTAL_NAV_BAR = 'horizontal-nav-bar-container';
const PROFILE_BUTTON = 'nav-menu-popup-label';
const PROFILE_MENU = 'nav-menu-container';
// The profile menu renders a moment after OK (over a second in a busy emulator), and its focus
// lock takes the focus off the button.
const PROFILE_MENU_RETRY_MS = 100;
const PROFILE_MENU_TIMEOUT_MS = 3000;

// The hash router keeps the path in location.hash.
const pathFromLocation = (location) => String(location.hash || '').replace(/^#/, '').split('?')[0];

const screenForPath = (path, screens = SCREENS) => {
    const segment = String(path || '').replace(/^\/+/, '').split('/')[0];
    return screens.find((screen) => screen.paths.indexOf(segment) !== -1) || null;
};

const isFocusable = (element) => element.tabIndex >= 0 && !element.disabled && !element.hasAttribute('disabled');

const isShown = (element) => {
    if (!element || !element.getClientRects || element.getClientRects().length === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
};

const inViewport = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
};

const isTextInput = (element) => element.tagName === 'TEXTAREA' ||
    (element.tagName === 'INPUT' && ['range', 'checkbox', 'radio', 'button', 'submit'].indexOf(element.type) === -1);

const firstFocusable = (root) => {
    if (isFocusable(root) && isShown(root)) return root;
    return Array.prototype.find.call(root.querySelectorAll('[tabindex], a[href], button, input, select, textarea'), (element) => (
        isFocusable(element) && isShown(element)
    )) || null;
};

const createNavigation = ({ window, document = window.document, screens = SCREENS }) => {
    // Per route container (routes below the top one stay mounted, display: none): the last focused
    // element outside the navigation bars.
    const lastContent = new WeakMap();
    // Per list of a screen: the last element focused in it.
    const lastInList = new WeakMap();
    let pendingInitial = null;
    let pendingProfileMenu = null;

    const visibleRoute = () => {
        const routes = document.querySelectorAll('.routes-container > .route-container');
        for (let index = routes.length - 1; index >= 0; index--) {
            if (isShown(routes[index])) return routes[index];
        }
        return null;
    };

    const currentScreen = () => screenForPath(pathFromLocation(window.location), screens);

    // Modals of the route (ModalDialog renders into the route's .modals-container).
    const inModal = (element) => !!(element && element.closest && element.closest('.modals-container'));
    const modalOpen = (route) => !!route.querySelector('.modals-container > *');

    const inNavBars = (element, route) => !!closestLocal(element, [NAV_BAR, HORIZONTAL_NAV_BAR], route);

    const usable = (element, route) => !!element && element !== document.body && route.contains(element) &&
        isFocusable(element) && isShown(element);

    const findInitial = (screen, route, preferredOnly = false) => {
        for (const entry of preferredOnly ? screen.initial.slice(0, screen.preferred || 1) : screen.initial) {
            let target = null;
            if (typeof entry === 'function') {
                target = entry(route);
                target = target ? firstFocusable(target) : null;
            } else {
                let scopes = [route];
                entry.forEach((name) => {
                    scopes = scopes.reduce((found, scope) => found.concat(queryLocal(scope, name)), []);
                });
                for (const scope of scopes) {
                    target = inNavBars(scope, route) ? null : firstFocusable(scope);
                    if (target) break;
                }
            }
            if (target) return target;
        }
        return null;
    };

    // The element the screen should have the focus on now: where it was left, else its first item.
    const screenTarget = (screen, route, preferredOnly = false) => {
        const content = lastContent.get(route);
        if (usable(content, route)) return { element: content, reason: 'restored' };
        const initial = findInitial(screen, route, preferredOnly);
        return initial ? { element: initial, reason: 'initial' } : null;
    };

    const focusHasPlace = (route) => {
        const active = document.activeElement;
        if (!active || active === document.body || active === document.documentElement) return false;
        // Overlays in portals (modals, menus) keep their focus.
        if (!route.contains(active)) return document.body.contains(active) && isShown(active);
        return isShown(active);
    };

    const cancelInitial = () => {
        if (pendingInitial !== null) {
            window.clearTimeout(pendingInitial);
            pendingInitial = null;
        }
    };

    const status = { last: null };
    const record = (reason, element) => {
        status.last = { reason, time: Date.now(), path: pathFromLocation(window.location), element: describe(element) };
    };

    // Called when the location changes: focus the screen once its content is there.
    const focusScreen = () => {
        cancelInitial();
        const screen = currentScreen();
        if (screen === null) return;
        let started = Date.now();
        let verifications = 0;
        const attempt = () => {
            pendingInitial = null;
            if (currentScreen() !== screen) return;
            const route = visibleRoute();
            // A modal is open (or opening): its focus is the modal's.
            if (route !== null && modalOpen(route)) return;
            if (route !== null && focusHasPlace(route)) return;
            const preferredOnly = Date.now() - started < INITIAL_FOCUS_PREFERRED_MS;
            const target = route !== null ? screenTarget(screen, route, preferredOnly) : null;
            if (target !== null) {
                target.element.focus();
                record(target.reason, target.element);
                if (verifications < INITIAL_FOCUS_VERIFICATIONS) {
                    pendingInitial = window.setTimeout(() => verify(target.element), INITIAL_FOCUS_VERIFY_MS);
                }
                return;
            }
            if (Date.now() - started < INITIAL_FOCUS_TIMEOUT_MS) {
                pendingInitial = window.setTimeout(attempt, INITIAL_FOCUS_RETRY_MS);
            }
        };
        // The focused element went away with its list (and the focus with it): search again.
        const verify = (element) => {
            pendingInitial = null;
            verifications++;
            if (document.body.contains(element)) {
                if (verifications < INITIAL_FOCUS_VERIFICATIONS) {
                    pendingInitial = window.setTimeout(() => verify(element), INITIAL_FOCUS_VERIFY_MS);
                }
                return;
            }
            started = Date.now();
            attempt();
        };
        // After the route is painted (lower routes become display: none in the same commit).
        pendingInitial = window.setTimeout(attempt, 0);
    };

    // Scrolls `list` so that `element` is inside it with a margin (both in the same pixels: the
    // rects are in screen pixels, scrollTop in the list's CSS pixels, before the zoom of F2.6).
    const reveal = (list, element) => {
        const listRect = list.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const ratio = list.offsetHeight > 0 ? listRect.height / list.offsetHeight : 1;
        const margin = Math.min(listRect.height * REVEAL_MARGIN, Math.max(0, (listRect.height - rect.height) / 2));
        let delta = 0;
        if (rect.top < listRect.top + margin) {
            delta = rect.top - listRect.top - margin;
        } else if (rect.bottom > listRect.bottom - margin) {
            delta = Math.min(rect.bottom - listRect.bottom + margin, rect.top - listRect.top - margin);
        }
        if (delta !== 0) list.scrollTop += delta / ratio;
    };

    const canScroll = (list, dir) => {
        if (dir === 'up') return list.scrollTop > 0;
        if (dir === 'down') return list.scrollTop + list.clientHeight < list.scrollHeight - 1;
        return false;
    };

    const listCandidates = (list, active) => Array.prototype.filter.call(list.querySelectorAll('*'), (element) => (
        element !== active && isFocusable(element) && isShown(element) && !element.contains(active)
    ));

    const search = (active, dir, container, candidates) => (
        candidates.length > 0 && typeof active.spatialNavigationSearch === 'function' ?
            active.spatialNavigationSearch(dir, { container, candidates }) :
            null
    );

    const insideRect = (rect, box) => rect.bottom > box.top && rect.top < box.bottom && rect.right > box.left && rect.left < box.right;

    // LEFT/RIGHT in a list: the visible items of the same row; with none, the closest visible element
    // outside the list in that direction (the screen's `leftExit` first), never the bar at the top.
    // True when the key was used.
    const moveAcross = (screen, route, list, active, dir) => {
        const from = active.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const row = listCandidates(list, active).filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top < from.bottom && rect.bottom > from.top && insideRect(rect, listRect) && inViewport(element);
        });
        const inRow = search(active, dir, list, row);
        if (inRow) {
            inRow.focus();
            record('row', inRow);
            return true;
        }
        const preferred = dir === 'left' && screen.leftExit ? screen.leftExit(route) : null;
        const outside = preferred && isFocusable(preferred) && isShown(preferred) && inViewport(preferred) ?
            preferred :
            search(active, dir, route, Array.prototype.filter.call(route.querySelectorAll('*'), (element) => (
                !list.contains(element) && isFocusable(element) && isShown(element) && inViewport(element) &&
                !closestLocal(element, [HORIZONTAL_NAV_BAR], route) && !inModal(element)
            )));
        if (outside) {
            outside.focus();
            record('list-exit', outside);
            return true;
        }
        // The end of a row: RIGHT stays; LEFT is the polyfill's.
        if (dir === 'right') {
            record('row-end', active);
            return true;
        }
        return false;
    };

    // Moves the focus inside a list, UP and DOWN. True when the key was used. `outer` is the list of
    // the screen around it (an open dropdown inside Settings), kept showing the focused element too.
    const moveInList = (list, active, dir, outer = null) => {
        const candidates = listCandidates(list, active);
        const best = candidates.length > 0 && typeof active.spatialNavigationSearch === 'function' ?
            active.spatialNavigationSearch(dir, { container: list, candidates }) :
            null;
        if (best) {
            reveal(list, best);
            if (outer !== null) reveal(outer, best);
            best.focus();
            record('list', best);
            return true;
        }
        if ((dir === 'up' || dir === 'down') && canScroll(list, dir)) {
            list.scrollTop += (dir === 'up' ? -1 : 1) * list.clientHeight * PAGE_SCROLL;
            record('scroll', active);
            return true;
        }
        // The end of a list: DOWN stays (the next page of the Library comes in on its own); UP leaves
        // it through the polyfill (filters or bar above).
        if (dir === 'down') {
            record('list-end', active);
            return true;
        }
        return false;
    };

    // OK on the profile button opens its menu with nothing focused (its focus lock takes the focus
    // off the button, to body): the first entry of the menu gets it. Keeping the focus inside the
    // menu is F4.3's.
    const focusProfileMenu = (route) => {
        const started = Date.now();
        const attempt = () => {
            pendingProfileMenu = null;
            const menu = queryLocal(route, PROFILE_MENU)[0];
            const first = menu ? firstFocusable(menu) : null;
            if (first && !menu.contains(document.activeElement)) {
                first.focus();
                record('profile-menu', first);
            } else if (!first && Date.now() - started < PROFILE_MENU_TIMEOUT_MS) {
                pendingProfileMenu = window.setTimeout(attempt, PROFILE_MENU_RETRY_MS);
            }
        };
        pendingProfileMenu = window.setTimeout(attempt, PROFILE_MENU_RETRY_MS);
    };

    const cancelProfileMenu = () => {
        if (pendingProfileMenu !== null) {
            window.clearTimeout(pendingProfileMenu);
            pendingProfileMenu = null;
        }
    };

    const onKeyDown = (event) => {
        const dir = ARROWS[event.keyCode];
        if (pendingInitial !== null) cancelInitial();
        cancelProfileMenu();
        if (event.keyCode === 13 && document.activeElement && closestLocal(document.activeElement, [PROFILE_BUTTON], null)) {
            const route = visibleRoute();
            if (route !== null) focusProfileMenu(route);
            return;
        }
        if (!dir || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const route = visibleRoute();
        if (route === null) return;
        const screen = currentScreen();
        const active = document.activeElement;
        // A modal of the route is open: the keys are the modal's (F4.3), even with the focus lost.
        if (modalOpen(route)) return;

        // Lost focus on a screen of this task: back to its element.
        if (screen !== null && !focusHasPlace(route)) {
            const target = screenTarget(screen, route);
            if (target !== null) {
                event.preventDefault();
                target.element.focus();
                record('recovered', target.element);
            }
            return;
        }
        if (!active || !route.contains(active)) return;

        // Navigation bar → screen: back to where the user came from, else into the screen's content
        // (the polyfill could take the search bar at the top).
        if (dir === 'right' && closestLocal(active, [NAV_BAR], route)) {
            const content = lastContent.get(route);
            if (usable(content, route)) {
                event.preventDefault();
                content.focus();
                record('nav-bar-return', content);
                return;
            }
            const candidates = Array.prototype.filter.call(route.querySelectorAll('*'), (element) => (
                isFocusable(element) && isShown(element) && !inNavBars(element, route) && inViewport(element)
            ));
            const best = candidates.length > 0 && typeof active.spatialNavigationSearch === 'function' ?
                active.spatialNavigationSearch(dir, { container: route, candidates }) :
                null;
            if (best) {
                event.preventDefault();
                best.focus();
                record('nav-bar-enter', best);
            }
            return;
        }

        if (screen === null || isTextInput(active)) return;
        // Open dropdowns (role="listbox") are lists of their own: the language list of Settings.
        // RIGHT from a menu next to a list (Settings): back to the row the user left.
        if (dir === 'right' && screen.rightReturn && closestLocal(active, [screen.rightReturn.from], route)) {
            const list = queryLocal(route, screen.rightReturn.to)[0];
            const row = list ? lastInList.get(list) : null;
            if (usable(row, route) && inViewport(row)) {
                event.preventDefault();
                row.focus();
                record('menu-return', row);
                return;
            }
        }

        // LEFT/RIGHT in an open dropdown are the polyfill's (F4.3).
        const listbox = active.closest ? active.closest('[role="listbox"]') : null;
        const screenList = closestLocal(active, screen.lists, route);
        const vertical = dir === 'up' || dir === 'down';
        let moved = false;
        if (listbox && route.contains(listbox)) {
            moved = vertical && moveInList(listbox, active, dir, screenList);
        } else if (screenList !== null) {
            moved = vertical ? moveInList(screenList, active, dir) : moveAcross(screen, route, screenList, active, dir);
        }
        if (moved) event.preventDefault();
    };

    // The interface zoom (Settings) changes the layout under the focused element: keep it in its list.
    let pendingReveal = null;
    const onResize = () => {
        if (pendingReveal !== null) return;
        pendingReveal = window.setTimeout(() => {
            pendingReveal = null;
            const route = visibleRoute();
            const screen = currentScreen();
            const active = document.activeElement;
            if (route === null || screen === null || !active || !route.contains(active)) return;
            const list = closestLocal(active, screen.lists, route);
            if (list !== null && isShown(active)) reveal(list, active);
        }, 0);
    };

    const onFocusIn = (event) => {
        const target = event.target;
        if (!target || target.nodeType !== 1) return;
        const route = target.closest ? target.closest('.route-container') : null;
        if (!route || inNavBars(target, route) || inModal(target)) return;
        lastContent.set(route, target);
        const screen = currentScreen();
        const list = screen !== null && !target.closest('[role="listbox"]') ? closestLocal(target, screen.lists, route) : null;
        if (list !== null) lastInList.set(list, target);
    };

    const install = () => {
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onResize);
        document.addEventListener('focusin', onFocusIn, true);
        return () => {
            cancelInitial();
            cancelProfileMenu();
            if (pendingReveal !== null) window.clearTimeout(pendingReveal);
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('resize', onResize);
            document.removeEventListener('focusin', onFocusIn, true);
        };
    };

    return { install, focusScreen, status, reveal, moveInList, moveAcross, findInitial, visibleRoute };
};

function describe(element) {
    if (!element || element.nodeType !== 1) return null;
    const className = typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return element.tagName.toLowerCase() + (className ? '.' + className : '') +
        (element.textContent ? ' "' + element.textContent.trim().slice(0, 30) + '"' : '');
}

module.exports = {
    SCREENS,
    NAV_BAR,
    HORIZONTAL_NAV_BAR,
    createNavigation,
    hasLocalClass,
    queryLocal,
    screenForPath,
    pathFromLocation,
};
