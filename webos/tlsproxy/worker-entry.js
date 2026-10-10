// Prefixed to the core `worker` entry by webos/webpack/tlsproxy.js, before the vendored worker.js.
import { install } from './worker';

install(self);
