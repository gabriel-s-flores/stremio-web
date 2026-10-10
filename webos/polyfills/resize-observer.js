// ResizeObserver for Chromium 53 (webOS TV 4.x; native since 64): Popup, Player and the Discover
// and Live TV viewports use it. Page only.
// resize-observer-polyfill is MIT, compatible with the app's GPL-2.0 in the distributed IPK.
// The app only reads contentRect (no borderBoxSize/contentBoxSize), which it provides.

import ResizeObserver from 'resize-observer-polyfill';

export const install = (global) => {
    if (typeof global.ResizeObserver === 'function') {
        return;
    }
    Object.defineProperty(global, 'ResizeObserver', {
        value: ResizeObserver,
        writable: true,
        configurable: true,
        enumerable: false
    });
};
