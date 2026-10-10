// Launch parameters of the webOS app (F3.3): what the system hands over on a cold start
// (PalmSystem.launchParams, a JSON string) and on a relaunch (event.detail of webOSRelaunch).
//
// The only parameter the app understands is a deep link into one of its own screens, under the
// keys LG uses for content launches (`contentTarget`) plus `deepLink`/`route`. Anything else is
// ignored, and a target that is not one of the allowed in-app routes is dropped, so a launch
// parameter can never open an external URL or the player with a made-up stream.

const routesRegexp = require('../../src/common/routesRegexp');

const DEEP_LINK_KEYS = ['contentTarget', 'deepLink', 'deeplink', 'route'];

// Screens a launch may land on. `player` needs a stream the launcher cannot name, `intro` is the
// login flow.
const ALLOWED_ROUTES = ['board', 'discover', 'library', 'calendar', 'continuewatching', 'search', 'metadetails', 'addons', 'settings'];

const SCHEME_PATTERN = /^stremio:\/\/\/?/i;
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
    if (!PATH_PATTERN.test(path) || path.includes('//') || path.split('/').includes('..')) {
        return null;
    }
    const [pathname] = path.split(/[?#]/);
    const allowed = ALLOWED_ROUTES.some((name) => routesRegexp[name].regexp.test(pathname));
    return allowed ? path : null;
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
