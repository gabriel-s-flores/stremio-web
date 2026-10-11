// The side navigation bar of every screen (see README.md). Its buttons are focusable in the webOS
// build (src/components/NavBar/VerticalNavBar/NavTabButton/NavTabButton.webos.js): LEFT from the
// first column of a screen reaches it through the spatial navigation, and RIGHT comes back here to
// the item of the screen's content the user left it from (the screen's memory without the bars,
// ./core/screenFocus.js: on Board, Discover and Search the memory of Back keeps the top bar, and the
// search button there is the clear button with a query); with none, into the screen's content,
// never to the bar at the top (the polyfill could take the search field, which opens the system
// keyboard): with nothing focusable in the content, the focus stays.

const { ARROWS, inViewport, isFocusable } = require('./core/dom');
const { inNavBars, inSideBar, modalOpen, visibleRoute } = require('./core/routes');
const { PRIORITY, getInputHub } = require('./core/input');
const { screenFocusOf } = require('./core/screenFocus');

// Returns a function that removes it.
const installSideBar = (win, { hub = getInputHub(win) } = {}) => {
    const doc = win.document;
    return hub.onKey((event) => {
        if (ARROWS[event.keyCode] !== 'right' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const route = visibleRoute(doc);
        const active = doc.activeElement;
        if (route === null || !route.contains(active) || !inSideBar(active, route) || modalOpen(doc, route)) return;
        const screen = screenFocusOf(route);
        const content = screen ? screen.memory.lastContent : null;
        let target = isFocusable(content) && route.contains(content) ? content : null;
        if (target === null && typeof active.spatialNavigationSearch === 'function') {
            const candidates = Array.prototype.filter.call(route.querySelectorAll('*'), (element) => (
                isFocusable(element) && !inNavBars(element, route) && inViewport(element)
            ));
            target = candidates.length > 0 ? active.spatialNavigationSearch('right', { container: route, candidates }) : null;
        }
        // Nothing in the content (an empty Search): the focus stays, the polyfill would take the top bar.
        event.preventDefault();
        if (target) target.focus();
    }, PRIORITY.global);
};

module.exports = { installSideBar };
