// ResizeObserver for Chromium 53 (webOS TV 4.x; native since 64): Popup, Player and the Discover
// and Live TV viewports use it. Page only.

import { ResizeObserver } from '@juggle/resize-observer';

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

