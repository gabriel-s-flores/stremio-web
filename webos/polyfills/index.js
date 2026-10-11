// Polyfills for the page on webOS TV 4.x (Chromium 53), prefixed to the `main` entry by
// webos/webpack/polyfills.js. Each module installs its API only where it is missing.

import { install as installQueueMicrotask } from './queue-microtask';
import './abort-controller';
import { install as installPluralRules } from './plural-rules';
import { install as installResizeObserver } from './resize-observer';
import { install as installElement } from './element';
import { install as installDOMRect } from './dom-rect';
import { install as installClipboard } from './clipboard';
import './focus';
import { install as installPointerEvents } from './pointer-events';
import { install as installMagicRemote } from '../magic-remote';

installQueueMicrotask(self);
installPluralRules(self);
installResizeObserver(self);
installElement(self);
installDOMRect(self);
installClipboard(self);
installPointerEvents(self);
// Not a polyfill: the Magic Remote pointer/arrows switch (cursorStateChange), on the events above.
installMagicRemote(self);
