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
//
// Each Back leaves one screen (F3.2b). The upstream back button replaces the current entry with the
// origin, which leaves the origin twice in the history: one Back looked like it did nothing. So the
// app's history entries are tracked (createHistoryStack) and Back goes through the history instead:
// - MetaDetails goes back to the entry of its origin when that entry is in the history;
// - entries of the same screen count as one: the Search queries (setSearchParams pushes one entry
//   per query, so do the history and suggestion links), the Discover catalogs and filters, the
//   Library types, the Calendar months. Back skips them and leaves the screen.
// What is not tracked (an entry the app did not see) is handled as before.

const ROOT_PATHS = ['/', '/intro'];
const META_DETAILS_PREFIXES = ['/metadetails', '/detail'];

const isRootPath = (pathname) => ROOT_PATHS.includes(pathname);

const isMetaDetailsPath = (pathname) => META_DETAILS_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
));

// The screen a path shows: its first segment (/search, /discover, /library, /calendar, /addons,
// /player...), and for MetaDetails the title (/metadetails/:type/:id, the legacy /detail too): two
// titles are two screens, the episode streams of a title are the same one.
const getScreen = (pathname) => {
    const segments = pathname.split('/').filter((segment) => segment.length > 0);
    if (isMetaDetailsPath(pathname)) {
        return ['metadetails'].concat(segments.slice(1, 3)).join('/');
    }
    return segments.length > 0 ? segments[0] : '';
};

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

// The app's history entries, by history.state.idx: { pathname, search } of each entry the router
// went through. A PUSH drops the entries after it (the browser does the same); a POP or a REPLACE
// only sets its own. Entries of an index that is not a number (a page that left the router) are not
// recorded, and what is not known is null.
const createHistoryStack = () => {
    let entries = [];
    return {
        record: (index, { pathname, search }, action) => {
            if (typeof index !== 'number' || index < 0) {
                return;
            }
            if (action === 'PUSH') {
                entries = entries.slice(0, index);
            }
            entries[index] = { pathname, search: search || '' };
        },
        get: (index) => entries[index] || null,
    };
};

const getEntryPath = (entry) => entry.pathname + (entry.search || '');

// { pathname, state } is the router location, historyIndex is window.history.state.idx,
// fallbackPath is getBackFallback(location) (src/router/getBackFallback.ts) and getEntry(index) is
// the entry of the app's history at that index, or null (createHistoryStack().get).
// Returns { type: 'exit' } or { type: 'navigate', to, replace }; `to` is a path or a negative delta.
const resolveRouteBack = ({ pathname, state, historyIndex, fallbackPath, getEntry = () => null }) => {
    if (isRootPath(pathname)) {
        return { type: 'exit' };
    }

    const hasIndex = typeof historyIndex === 'number' && historyIndex >= 0;

    if (isMetaDetailsPath(pathname)) {
        const originPath = getOriginPath(state && state.from);
        if (originPath !== null) {
            // The nearest entry of the origin: the one right before, or before the other titles
            // and episodes opened from the same origin (useNavigateWithOrigin keeps the first one).
            for (let index = hasIndex ? historyIndex - 1 : -1; index >= 0; index--) {
                const entry = getEntry(index);
                if (entry === null) {
                    break;
                }
                if (getEntryPath(entry) === originPath) {
                    return { type: 'navigate', to: index - historyIndex, replace: false };
                }
            }
            return { type: 'navigate', to: originPath, replace: true };
        }
    }

    if (hasIndex && historyIndex > 0) {
        // Back to the nearest entry of another screen. When every entry before is of this screen
        // (the app was opened on it), nothing in the history leaves it: the fallback path does.
        const screen = getScreen(pathname);
        let index = historyIndex - 1;
        while (index >= 0) {
            const entry = getEntry(index);
            if (entry === null || getScreen(entry.pathname) !== screen) {
                break;
            }
            index--;
        }
        if (index >= 0) {
            return { type: 'navigate', to: index - historyIndex, replace: false };
        }
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
// - getEntry(index): the app's history entry at that index, or null (createHistoryStack().get);
// - getFallbackPath(location): getBackFallback() of src/router;
// - findPageBackButton(): the streams list back button, or null;
// - navigate(to, options): the router's navigate;
// - openExitDialog(): shows the quit dialog.
const createRouteBackHandler = ({ getLocation, getHistoryIndex, getEntry, getFallbackPath, findPageBackButton, navigate, openExitDialog, now = () => Date.now() }) => {
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
            getEntry,
        });
        if (action.type === 'exit') {
            context.detail = 'exit-dialog';
            openExitDialog();
            return true;
        }

        context.detail = `navigate:${action.to}`;
        markPending(location);
        if (typeof action.to === 'number') {
            navigate(action.to);
        } else {
            navigate(action.to, { replace: action.replace });
        }
        return true;
    };
};

module.exports = {
    PENDING_MS,
    createHistoryStack,
    createRouteBackHandler,
    ROOT_PATHS,
    getScreen,
    isRootPath,
    isMetaDetailsPath,
    resolveRouteBack,
};
