// :focus-visible and :focus-within for webOS TV 4.x (Chromium 53), which drops any rule whose
// selector contains them. webos/webpack/postcss.js rewrites the selectors to attributes these
// polyfills set (attributes, not classes: CSS modules would hash a class name):
//   :focus-visible  ->  [data-focus-visible-added]   (WICG focus-visible)
//   :focus-within   ->  [focus-within]               (postcss-focus-within/browser)
// Imported by webos/polyfills/index.js.

import 'focus-visible';
import focusWithin from 'postcss-focus-within/browser';

focusWithin();
