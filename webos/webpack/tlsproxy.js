// tlsproxy for hosts with Let's Encrypt certificates (owner: F3.7; webos/tlsproxy/README.md).
//
// Prepends webos/tlsproxy/page.js to the page entry (decides direct or proxy mode and keeps the
// service started, before the app renders) and webos/tlsproxy/worker-entry.js to the core worker
// entry (wraps self.fetch before the core glue). Contract: runs after core.js (the worker entry
// is then the vendored worker.js path) and before polyfills.js, which prepends its modules to
// both entries, so the polyfills still run first. The tlsproxy service itself is not bundled:
// webos/scripts/ares.sh packages webos/tlsproxy/service/ next to build-webos/ in the IPK.

const path = require('path');
const { ROOT } = require('./utils');

const TLSPROXY_DIR = path.join(ROOT, 'webos', 'tlsproxy');

const prefix = (entry, ...modules) => [...modules, ...[].concat(entry)];

module.exports = (config) => {
    config.entry.main = prefix(config.entry.main, path.join(TLSPROXY_DIR, 'page.js'));
    config.entry.worker = prefix(config.entry.worker, path.join(TLSPROXY_DIR, 'worker-entry.js'));
    return config;
};
