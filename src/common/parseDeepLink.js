// Convert only complete Stremio URIs to HashRouter paths.
const parseDeepLink = (value) => {
    if (typeof value !== 'string' || !/^stremio:\/\//i.test(value) || /[\s\\]/.test(value) || /%(?![\da-f]{2})/i.test(value)) return null;
    try {
        // Chromium 68 treats custom schemes as opaque (pathname includes "///").
        // Split the scheme ourselves and use the consistent HTTPS URL parser.
        const target = value.slice(value.indexOf('://') + 3);
        const internal = target.startsWith('/');
        if (!target || target.startsWith('//') || /^[?#]/.test(target)) return null;
        const url = new URL(internal ? `https://stremio.invalid${target}` : `https://${target}`);
        if (url.username || url.password) return null;
        if (!internal) return `/addons?addon=${encodeURIComponent(url.href)}`;
        return `${url.pathname}${url.search}${url.hash}`;
    } catch (_error) { return null; }
};

const parseLaunchDeepLink = (params) => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
    if (Object.prototype.hasOwnProperty.call(params, 'url')) return parseDeepLink(params.url);
    for (const key of ['uri', 'contentTarget', 'contentId']) {
        const path = parseDeepLink(params[key]);
        if (path !== null) return path;
    }
    return null;
};

module.exports = { parseDeepLink, parseLaunchDeepLink };
