// Copyright (C) 2017-2026 Smart code 203358507

const safeOpenExternal = (url, whitelistedHosts, windowObject) => {
    try {
        const { hostname } = new URL(url);
        const isWhitelisted = whitelistedHosts.some((host) => (
            hostname === host || hostname.endsWith('.' + host)
        ));
        const finalUrl = !isWhitelisted ? `https://www.stremio.com/warning#${encodeURIComponent(url)}` : url;

        if (!windowObject || typeof windowObject.open !== 'function') {
            return false;
        }

        windowObject.open(finalUrl, '_blank');
        return true;
    } catch (_error) {
        return false;
    }
};

module.exports = safeOpenExternal;
