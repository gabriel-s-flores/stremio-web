// AbortController/AbortSignal for Chromium 53 (webOS TV 4.x; native since 66), and fetch that
// honours `signal` (the polyfill patches fetch only when it had to install AbortController).
// Page and worker: the package picks the global (self) itself and does nothing where it is native.

import 'abortcontroller-polyfill/dist/polyfill-patch-fetch';
