// Copyright (C) 2017-2026 Smart code 203358507

const resolveExternalUrl = require('./resolveExternalUrl');

const safeOpenExternal = (url, whitelistedHosts, windowObject) => {
    try {
        const finalUrl = resolveExternalUrl(url, whitelistedHosts);

        if (finalUrl === null || !windowObject || typeof windowObject.open !== 'function') {
            return false;
        }

        windowObject.open(finalUrl, '_blank');
        return true;
    } catch (_error) {
        return false;
    }
};

module.exports = safeOpenExternal;
