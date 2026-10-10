// webOS TV 4.x build only (resolved instead of device.ts by webos/webpack/app.js).
//
// The platform name is 'webOS' (capital O): it is what stremio-video compares against to pick
// WebOsVideo, and Bowser would give 'webos'. Everything else keeps the upstream values for a
// non-mobile, non-Linux-WebKit device. Also starts the (deferred) read of the TV capabilities.

const Bowser = require('bowser');
const { PLATFORM_NAME, isWebOS, startCapabilitiesRead } = require('../../../webos/lib/platform');

const { userAgent } = globalThis.navigator;

const name = isWebOS(globalThis) ?
    PLATFORM_NAME
    :
    Bowser.getParser(userAgent).getOSName().toLowerCase() || 'unknown';
const isMobile = false;
const supportsViewTransitions = true;

startCapabilitiesRead(globalThis, name);

module.exports = {
    name,
    isMobile,
    supportsViewTransitions,
};
