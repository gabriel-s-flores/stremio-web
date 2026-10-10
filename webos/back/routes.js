// Route layer of the Back dispatcher (owner: F3.2): what Back does when no overlay is open.
// Pure, so it is unit tested; webos/back/BackNavigation.js applies the result.
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

module.exports = {
    ROOT_PATHS,
    isRootPath,
    isMetaDetailsPath,
    resolveRouteBack,
};
