// Launch parameters of the webOS app (F3.3): what the system hands over on a cold start
// (PalmSystem.launchParams, a JSON string) and on a relaunch (event.detail of webOSRelaunch).
//
// The only parameter the app understands is a deep link into one of its own screens, under the
// keys LG uses for content launches (`contentTarget`) plus `deepLink`/`route`. Anything else is
// ignored, and a target that is not one of the allowed in-app routes is dropped, so a launch
// parameter can never open an external URL or the player with a made-up stream.
//
// The query string and the fragment are dropped, except `search` on the search route. Screens read
// settings from the query (`?streamingServerUrl=` saves and activates a streaming server,
// `/addons?addon=` opens an addon by URL): anything that launches the app could change them without
// a confirmation. The most conservative rule is an allowlist of parameters per route, here one.

const routesRegexp = require('../../src/common/routesRegexp');

const DEEP_LINK_KEYS = ['contentTarget', 'deepLink', 'deeplink', 'route'];

// Screens a launch may land on. `player` needs a stream the launcher cannot name, `intro` is the
// login flow.
const ALLOWED_ROUTES = ['board', 'discover', 'library', 'calendar', 'continuewatching', 'search', 'metadetails', 'addons', 'settings'];

// Query parameters a deep link may carry, by route name of routesRegexp.
const ALLOWED_QUERY = { search: ['search'] };
const MAX_QUERY_LENGTH = 200;

const SCHEME_PATTERN = /^stremio:\/\/\/?/i;
// No `#`: a fragment is not part of a route.
const PATH_PATTERN = /^\/[A-Za-z0-9_\-.~:%@!$&'()*+,;=/?]*$/;

const parseLaunchParams = (raw) => {
    let value = raw;
    if (typeof raw === 'string') {
        if (raw.trim() === '') {
            return {};
        }
        try {
            value = JSON.parse(raw);
        } catch (_) {
            return {};
        }
    }
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
};

// "." and ".." as the router would see them, percent-encoded or not.
const isDotSegment = (segment) => {
    let decoded = segment;
    try {
        decoded = decodeURIComponent(segment);
    } catch (_) {
        return true;
    }
    return decoded === '.' || decoded === '..';
};

// "?search=matrix" for the routes that take one, nothing otherwise.
const allowedQuery = (route, query) => {
    const names = ALLOWED_QUERY[route] || [];
    const kept = query.split('&').map((pair) => pair.split('=')).filter(([name, value]) => names.includes(name) && value !== undefined && value !== '' && value.length <= MAX_QUERY_LENGTH);
    return kept.length === 0 ? '' : `?${kept.slice(0, 1).map(([name, value]) => `${name}=${value}`).join('')}`;
};

// "stremio:///detail/movie/tt0111161", "#/discover" and "/discover" all name a hash route.
const toRoutePath = (target) => {
    if (typeof target !== 'string') {
        return null;
    }
    let path = target.trim().replace(SCHEME_PATTERN, '/');
    if (path === '') {
        return null;
    }
    if (path.startsWith('#')) {
        path = path.slice(1);
    }
    if (!path.startsWith('/')) {
        path = `/${path}`;
    }
    if (!PATH_PATTERN.test(path)) {
        return null;
    }
    const queryStart = path.indexOf('?');
    const pathname = queryStart === -1 ? path : path.slice(0, queryStart);
    const query = queryStart === -1 ? '' : path.slice(queryStart + 1);
    if (pathname.includes('//') || pathname.split('/').some(isDotSegment)) {
        return null;
    }
    const route = ALLOWED_ROUTES.find((name) => routesRegexp[name].regexp.test(pathname));
    if (route === undefined) {
        return null;
    }
    return pathname + allowedQuery(route, query);
};

// The route a set of launch parameters asks for, or null (no deep link, or not an allowed one).
const resolveDeepLink = (raw) => {
    const params = parseLaunchParams(raw);
    for (const key of DEEP_LINK_KEYS) {
        if (params[key] !== undefined) {
            const path = toRoutePath(params[key]);
            if (path !== null) {
                return path;
            }
        }
    }
    return null;
};

module.exports = {
    ALLOWED_ROUTES,
    parseLaunchParams,
    toRoutePath,
    resolveDeepLink,
};
