// Routes, navigation bars and overlays, as the remote navigation sees them (see ../README.md).
//
// The router (src/router/Routes.tsx) keeps the screens a route was opened from mounted under it:
// `.routes-container > .route-container` (one per view), the top one shown and the others
// display: none. Each route has its content (`.route-content`) and its `.modals-container`, where
// ModalDialog renders.

const { closestLocal, isElement, isRendered, isShown } = require('./dom');

const ROUTES = '.routes-container > .route-container';
const ROUTE = '.route-container';

// Local class names (CSS modules) of the navigation bars: the vertical one on the left
// (src/components/NavBar/VerticalNavBar) and the top one (HorizontalNavBar).
const SIDE_BAR = 'vertical-nav-bar-container';
const TOP_BAR = 'horizontal-nav-bar-container';

// The route on screen: the last route container that is shown.
const visibleRoute = (doc) => {
    const routes = doc.querySelectorAll(ROUTES);
    for (let index = routes.length - 1; index >= 0; index--) {
        if (isShown(routes[index])) return routes[index];
    }
    return null;
};

const routeOf = (element) => (isElement(element) ? element.closest(ROUTE) : null);

// Nothing focused, or the focus left on an element no longer shown: the link of the screen below
// that opened this one (its route is display: none now), or one that was removed.
const isFocusLost = (doc) => {
    const active = doc.activeElement;
    return !active || active === doc.body || active === doc.documentElement || !isRendered(active);
};

const inSideBar = (element, stop) => closestLocal(element, [SIDE_BAR], stop) !== null;
const inNavBars = (element, stop) => closestLocal(element, [SIDE_BAR, TOP_BAR], stop) !== null;

// Inside a modal of a route (ModalDialog renders into the route's .modals-container).
const inRouteModal = (element) => isElement(element) && element.closest('.modals-container') !== null;

// A modal or dialog over the screen: its own focus handling wins (webos/lib/navigation/modals.js,
// the Back of webos/back). A ModalDialog of the route (shown in its .modals-container), or anything
// with the class or the role of one.
const modalOpen = (doc, route = null) => {
    const container = route ? route.querySelector('.modals-container') : null;
    if (container && Array.prototype.some.call(container.children, isShown)) return true;
    return doc.querySelector('[class*="modal-container"], [role="dialog"]') !== null;
};

module.exports = {
    ROUTE,
    ROUTES,
    SIDE_BAR,
    TOP_BAR,
    inNavBars,
    inRouteModal,
    inSideBar,
    isFocusLost,
    modalOpen,
    routeOf,
    visibleRoute,
};
