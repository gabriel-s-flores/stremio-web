// Installs the console filter (F3.7b) in the page and in the core worker: imported first by
// webos/tlsproxy/page.js and webos/tlsproxy/worker-entry.js, which webos/webpack/tlsproxy.js puts at the
// start of the `main` and `worker` entries, so it runs before the app and the core log anything.
const { installConsoleFilter } = require('./index');

if (typeof console !== 'undefined') installConsoleFilter(console);
