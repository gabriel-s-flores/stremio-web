// Polyfills for the page on webOS TV 4.x (Chromium 53), prefixed to the `main` entry by
// webos/webpack/polyfills.js. Each module installs its API only where it is missing.

import { install as installQueueMicrotask } from './queue-microtask';
import './abort-controller';
import { install as installPluralRules } from './plural-rules';
import { install as installResizeObserver } from './resize-observer';
import { install as installElement } from './element';
import './focus';

installQueueMicrotask(self);
installPluralRules(self);
installResizeObserver(self);
installElement(self);
