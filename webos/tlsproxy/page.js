// The page's tlsproxy instance (webOS build only). Prefixed to the `main` entry by
// webos/webpack/tlsproxy.js, so it starts before the app renders, and imported by the webOS
// overrides that show images (src/components/Image/Image.webos.tsx). The core worker reaches it
// through the page Bridge as window.__webosTlsProxy (webos/tlsproxy/worker.js).

import { createTlsProxy } from './client';

// The detection is kept per firmware: platform version and model from PalmSystem, plus the UA.
const firmwareId = () => {
    let info = {};
    try {
        info = JSON.parse(window.PalmSystem.deviceInfo) || {};
    } catch {
        // not on webOS (or no deviceInfo): the user agent alone
    }
    return [info.platformVersion, info.modelName, navigator.userAgent].join('|');
};

const tlsProxy = createTlsProxy({
    storage: window.localStorage,
    fetch: (url, init) => window.fetch(url, init),
    getWebOS: () => window.webOS,
    firmware: firmwareId(),
    online: () => navigator.onLine !== false,
});

window.__webosTlsProxy = tlsProxy.bridge;
tlsProxy.start();

export default tlsProxy;
