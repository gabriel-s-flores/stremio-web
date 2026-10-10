// Overlay layer of the Back dispatcher (owner: F3.2): closes the topmost upstream overlay that is
// open, one per press, without editing the upstream components.
//
// Each overlay is closed through a path it already has (its Escape listener, a click on its
// backdrop, a click outside), chosen so that one press closes exactly one thing:
// - a synthetic Escape is only sent where the document listeners do not see it. On document, the
//   Player's `exit` shortcut would also close every menu and leave the Player on the same press;
// - popups and dropdowns close with a click outside, which no modal or Player handler reacts to.
// Overlays are looked for in the visible route only: lower routes stay mounted but hidden
// (src/router/Routes.tsx) and may still hold an open modal. Class names come from CSS modules
// ([local]-[hash]), so they are matched by prefix. Catalog with the upstream line numbers:
// webos/back/README.md. Components that register their own handler (useBackHandler) run before
// this layer, so overlays can move off this bridge one by one (F4.3).

const classPrefix = (prefix) => `[class^="${prefix}-"], [class*=" ${prefix}-"]`;

// Child combinator over selector lists: child('body', 'a, b') -> 'body > a, body > b'.
const child = (parents, children) => parents.split(', ').reduce((selectors, parent) => (
    selectors.concat(children.split(', ').map((selector) => `${parent} > ${selector}`))
), []).join(', ');

const hasClassToken = (element, pattern) => (
    typeof element.className === 'string' && element.className.split(/\s+/).some((token) => pattern.test(token))
);

// Transition (src/components/Transition) keeps an element mounted with `<name>-exit` while it fades.
const isLeaving = (element) => hasClassToken(element, /-exit$/);

const getActiveRoute = (doc) => doc.querySelector('.routes-container > .route-container:last-child');

// Elements of the visible route, plus the ones portalled outside of any route (document.body).
const findAll = (doc, selector) => {
    const activeRoute = getActiveRoute(doc);
    return Array.from(doc.querySelectorAll(selector)).filter((element) => {
        const route = element.closest('.route-container');
        return (route === null || route === activeRoute) && !isLeaving(element);
    });
};

const find = (doc, selector) => findAll(doc, selector)[0] || null;

const findLast = (doc, selector) => {
    const elements = findAll(doc, selector);
    return elements.length > 0 ? elements[elements.length - 1] : null;
};

// keyCode and which cannot be set through the KeyboardEvent constructor; listeners that read them
// (src/common/Shortcuts/keyboard.ts) must see 27 like for a real Escape.
const createEscapeEvent = (win) => {
    const event = new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    const values = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 };
    Object.keys(values).forEach((property) => {
        if (event[property] !== values[property]) {
            Object.defineProperty(event, property, { get: () => values[property] });
        }
    });
    return event;
};

const sendEscape = (win, target) => target.dispatchEvent(createEscapeEvent(win));

const sendMouse = (win, target, type) => target.dispatchEvent(new win.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: win,
    button: 0,
}));

// Popup and NavMenu labels keep focus with tabIndex -1 only while the menu is open; when the menu
// unmounts, the focus may fall on body and spatial navigation has nowhere to start from.
const restoreFocus = (win, doc, trigger) => {
    if (!trigger) {
        return;
    }
    win.setTimeout(() => {
        const active = doc.activeElement;
        if ((active === null || active === doc.body || !doc.body.contains(active)) && doc.body.contains(trigger)) {
            trigger.focus();
        }
    }, 0);
};

const POPUP_SELECTORS = [
    // Popup (src/components/Popup), portal or not: the label gets the plain class `active`.
    child('.active', classPrefix('menu-container')),
    classPrefix('portal-layer'),
    // Search history dropdown (src/components/NavBar/HorizontalNavBar/SearchBar).
    child(classPrefix('search-bar-container'), classPrefix('menu-container')),
    // MultiselectMenu without portal (src/components/MultiselectMenu): no Escape at all.
    '[aria-haspopup="listbox"][aria-expanded="true"]',
].join(', ');

const getPopupTrigger = (element) => {
    if (element.getAttribute('aria-expanded') === 'true') {
        return element;
    }
    return element.closest('.active');
};

// Ordered from the top of the screen down: the first one found is the one closed.
const OVERLAYS = [
    {
        // src/App/StreamingServerUrlModal: listens for Escape on window.
        name: 'streaming-server-url-modal',
        find: (doc) => doc.getElementById('streaming-server-url-modal-title'),
        close: (win) => sendEscape(win, win),
    },
    {
        // src/App/ShortcutsModal and src/App/GamepadModal: Escape on document, so the backdrop.
        name: 'shortcuts-modal',
        find: (doc) => find(doc, child('body', classPrefix('shortcuts-modal'))),
        close: (win, doc, element) => element.querySelector(classPrefix('backdrop')).click(),
    },
    {
        name: 'gamepad-modal',
        find: (doc) => find(doc, '[data-gamepad-modal]'),
        close: (win, doc, element) => element.querySelector(classPrefix('backdrop')).click(),
    },
    {
        // src/components/ContextMenu: Escape on document; a left mousedown on its container closes it.
        name: 'context-menu',
        find: (doc) => find(doc, child('body', classPrefix('context-menu-container'))),
        close: (win, doc, element) => sendMouse(win, element, 'mousedown'),
    },
    {
        // src/components/ActionMenu: React onKeyDown on the menu, which also gives the focus back.
        name: 'action-menu',
        find: (doc) => find(doc, '[role="menu"]'),
        close: (win, doc, element) => {
            const target = element.contains(doc.activeElement) ? doc.activeElement : element;
            sendEscape(win, target);
        },
    },
    {
        // A click outside closes every open popup and dropdown, and nothing else: Popup and the
        // search bar listen for mousedown, MultiselectMenu for mouseup.
        name: 'popup',
        find: (doc) => find(doc, POPUP_SELECTORS),
        close: (win, doc, element) => {
            const trigger = getPopupTrigger(element);
            sendMouse(win, doc.body, 'mousedown');
            sendMouse(win, doc.body, 'mouseup');
            restoreFocus(win, doc, trigger);
        },
    },
    {
        // ModalDialog and BottomSheet in the route's modals container: Escape on window closes
        // only the topmost one (they check it). The Intro login loader has no way to close and
        // keeps the press, so Back never navigates behind a modal.
        name: 'modal',
        find: (doc) => findLast(doc, '.modals-container > .modal-container'),
        close: (win) => sendEscape(win, win),
    },
    {
        // Player menus and side drawer (src/routes/Player/Player.js) only close through the
        // Player's mousedown handler or its `exit` shortcut, which also leaves the Player.
        name: 'player-menu',
        find: (doc) => {
            const container = find(doc, classPrefix('player-container'));
            if (container === null) {
                return null;
            }
            const open = Array.from(container.querySelectorAll(`${classPrefix('menu-layer')}, ${classPrefix('side-drawer-layer')}`))
                .some((layer) => !isLeaving(layer) && !hasClassToken(layer, /^next-video-popup-container-/));
            return open ? container : null;
        },
        close: (win, doc, container) => sendMouse(win, container, 'mousedown'),
    },
    {
        // Next video popup in the Player: its dismiss button (closeMenus does not close it).
        name: 'next-video-popup',
        find: (doc) => {
            const popup = find(doc, classPrefix('next-video-popup-container'));
            return popup && popup.querySelector(classPrefix('dismiss'));
        },
        close: (win, doc, button) => button.click(),
    },
];

// Closes the topmost open overlay; returns its name, or null when none is open.
const closeTopOverlay = (win, doc = win.document) => {
    for (const overlay of OVERLAYS) {
        const element = overlay.find(doc);
        if (element) {
            overlay.close(win, doc, element);
            return overlay.name;
        }
    }
    return null;
};

// Page state that Back undoes before the route changes: the streams list of an episode has its
// own back button (src/routes/MetaDetails/StreamsList), which returns to the episode list.
const findPageBackButton = (doc) => {
    const list = find(doc, classPrefix('streams-list-container'));
    return list && list.querySelector(classPrefix('back-button-container'));
};

module.exports = {
    OVERLAYS,
    closeTopOverlay,
    findPageBackButton,
    getActiveRoute,
};
