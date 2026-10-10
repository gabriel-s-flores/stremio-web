// Route layer of the Back dispatcher (owner: F3.2): what Back does when no overlay is open.
// No React or DOM here, so it is unit tested; webos/back/BackNavigation.js wires it to the router.
//
// Mirrors the upstream back paths so Back on the remote does what the on-screen back button does:
// - the Board (and /intro, the only other screen the app can open on) is the root: Back asks to
//   quit, whatever the history holds (Board -> Discover -> Board via the nav bar, for example);
// - MetaDetails goes back to the stored origin, like HorizontalNavBar with originPath
//   (src/routes/MetaDetails/MetaDetails.js, src/router/useNavigateWithOrigin.ts);
// - everything else is src/router/useGoBack.ts without origin (what the Player's Escape does):
//   one history entry back, or the getBackFallback() path when the app has no entry to go back to.

const ROOT_PATHS = ['/', '/intro'];
const META_DETAILS_PREFIXES = ['/metadetails', '/detail'];

const isRootPath = (pathname) => ROOT_PATHS.includes(pathname);

const isMetaDetailsPath = (pathname) => META_DETAILS_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
));

// location.state.from is a Location or a path (useNavigateWithOrigin.getOriginPath).
const getOriginPath = (from) => {
    if (typeof from === 'string') {
        return from.length > 0 ? from : null;
    }
    if (from && typeof from.pathname === 'string') {
        return from.pathname + (from.search || '');
    }
    return null;
};

// { pathname, state } is the router location, historyIndex is window.history.state.idx and
// fallbackPath is getBackFallback(location) (src/router/getBackFallback.ts).
// Returns { type: 'exit' } or { type: 'navigate', to, replace }.
const resolveRouteBack = ({ pathname, state, historyIndex, fallbackPath }) => {
    if (isRootPath(pathname)) {
        return { type: 'exit' };
    }

    if (isMetaDetailsPath(pathname)) {
        const originPath = getOriginPath(state && state.from);
        if (originPath !== null) {
            return { type: 'navigate', to: originPath, replace: true };
        }
    }

    if (typeof historyIndex === 'number' && historyIndex > 0) {
        return { type: 'navigate', to: -1, replace: false };
    }

    return { type: 'navigate', to: fallbackPath || '/', replace: true };
};

// One press moves one step: after a navigation, presses on the same location are consumed without
// navigating again until the location changes. A history pop is asynchronous, and a second
// navigate(-1) computed from the old location would skip a screen or leave the app's history.
// The guard expires after PENDING_MS, so a navigation that never happens does not leave Back stuck.
const PENDING_MS = 1000;

// The route layer's handler. Everything it touches comes in, so it runs the same in the tests:
// - getLocation(): the router location ({ pathname, state, key });
// - getHistoryIndex(): window.history.state.idx;
// - getFallbackPath(location): getBackFallback() of src/router;
// - findPageBackButton(): the streams list back button, or null;
// - navigate(to, options): the router's navigate;
// - openExitDialog(): shows the quit dialog.
const createRouteBackHandler = ({ getLocation, getHistoryIndex, getFallbackPath, findPageBackButton, navigate, openExitDialog, now = () => Date.now() }) => {
    let pending = { key: null, time: 0 };
    const markPending = (location) => {
        pending = { key: location.key, time: now() };
    };

    return (context = {}) => {
        const location = getLocation();
        if (pending.key === location.key && now() - pending.time < PENDING_MS) {
            context.detail = 'pending';
            return true;
        }

        const pageBackButton = findPageBackButton();
        if (pageBackButton) {
            context.detail = 'page';
            markPending(location);
            pageBackButton.click();
            return true;
        }

        const action = resolveRouteBack({
            pathname: location.pathname,
            state: location.state,
            historyIndex: getHistoryIndex(),
            fallbackPath: getFallbackPath(location),
        });
        if (action.type === 'exit') {
            context.detail = 'exit-dialog';
            openExitDialog();
            return true;
        }

        context.detail = `navigate:${action.to}`;
        markPending(location);
        if (action.to === -1) {
            navigate(-1);
        } else {
            navigate(action.to, { replace: action.replace });
        }
        return true;
    };
};

module.exports = {
    PENDING_MS,
    createRouteBackHandler,
    ROOT_PATHS,
    isRootPath,
    isMetaDetailsPath,
    resolveRouteBack,
};
