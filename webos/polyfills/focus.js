// :focus-visible and :focus-within for webOS TV 4.x (Chromium 53), which drops any rule whose
// selector contains them. webos/webpack/postcss.js rewrites the selectors to attributes these
// polyfills set (attributes, not classes: CSS modules would hash a class name):
//   :focus-visible  ->  [data-focus-visible-added]   (WICG focus-visible)
//   :focus-within   ->  [focus-within]               (./focus-within.js, F8.2: postcss-focus-within/browser
//                                                     rewrote the whole chain on every focus)
// Imported by webos/polyfills/index.js.

import 'focus-visible';
import { install as installFocusWithin } from './focus-within';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installFocusWithin(self));
} else {
    installFocusWithin(self);
}
