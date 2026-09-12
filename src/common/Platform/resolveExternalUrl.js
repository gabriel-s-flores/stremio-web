// Copyright (C) 2017-2026 Smart code 203358507

const resolveExternalUrl = (url, whitelistedHosts) => {
    try {
        if (typeof url !== 'string' || !url) return null;
        const { hostname } = new URL(url);
        const allowed = whitelistedHosts.some((host) => hostname === host || hostname.endsWith('.' + host));
        return allowed ? url : `https://www.stremio.com/warning#${encodeURIComponent(url)}`;
    } catch (_error) {
        return null;
    }
};

module.exports = resolveExternalUrl;
