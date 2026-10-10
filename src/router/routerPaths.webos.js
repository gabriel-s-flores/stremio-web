// webOS TV 4.x build only (resolved instead of routerPaths.tsx by webos/webpack/app.js, F3.6).
// The upstream routes, plus:
//   - #/webos-diagnostics: the diagnostics screen, a lazy chunk (nothing of it loads at boot);
//   - boot marks on the Board route (webos/lib/diagnostics/registry.js): when its element mounted
//     and when the first catalog item showed up.
// The remote shortcut (RED GREEN YELLOW BLUE) is webos/lib/diagnostics/ShortcutHandler.js, mounted
// inside the Router in src/App/index.webos.js: it opens the screen with the router's navigate().

import React from 'react';
// The explicit extension resolves to the upstream file, not to this one.
import upstreamPaths from './routerPaths.tsx';
import { mark, markWhenFound } from '../../webos/lib/diagnostics/registry';

const WebosDiagnostics = React.lazy(() => import('stremio/routes/WebosDiagnostics'));

const DIAGNOSTICS_PATH = '/webos-diagnostics';
// The class names of the CSS modules are `[local]-[hash]`; the F1.4/F1.6 probes match the same way.
const FIRST_ITEM_SELECTOR = '[class*="meta-item-container"]';

const BoardBootMarks = ({ children }) => {
    React.useEffect(() => {
        mark('boardMounted');
        return markWhenFound(document.querySelector('.routes-container'), FIRST_ITEM_SELECTOR, 'boardFirstItem');
    }, []);
    return children;
};

const diagnosticsRoute = {
    path: DIAGNOSTICS_PATH,
    // Above every upstream route, the Player (view 4) included: Routes.tsx replaces the route of the same
    // view, so the screen opened during playback must not take the Player's layer (it would unmount the
    // <video>). The routes below stay mounted for the way back. A test keeps this above them.
    view: 5,
    element: (
        <React.Suspense fallback={null}>
            <WebosDiagnostics />
        </React.Suspense>
    ),
};

const routes = upstreamPaths.map((route) => (
    route.path === '/' ? { ...route, element: <BoardBootMarks>{route.element}</BoardBootMarks> } : route
));

// Before the catch-all ('*'): routes match in order.
const catchAll = routes.findIndex((route) => route.path === '*');
export default catchAll === -1 ?
    [...routes, diagnosticsRoute]
    :
    [...routes.slice(0, catchAll), diagnosticsRoute, ...routes.slice(catchAll)];
