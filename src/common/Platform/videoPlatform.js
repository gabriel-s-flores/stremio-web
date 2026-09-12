// Copyright (C) 2017-2023 Smart code 203358507

const toVideoPlatform = (name) => name === 'webos' ? 'webOS' : name;

const getVideoPlatformError = (platform, host) => {
    if (platform === 'webOS' && typeof host?.webOS?.service?.request !== 'function') {
        return {
            code: 10000,
            critical: true,
            message: 'webOS video bridge unavailable: window.webOS.service.request must be loaded before video playback.'
        };
    }
    return null;
};

module.exports = { toVideoPlatform, getVideoPlatformError };
