// Polyfills for the core worker on webOS TV 4.x (Chromium 53), prefixed to the `worker` entry by
// webos/webpack/polyfills.js. The worker has no DOM: only what the core glue and fetch need.

import { install as installQueueMicrotask } from './queue-microtask';
import './abort-controller';

installQueueMicrotask(self);
