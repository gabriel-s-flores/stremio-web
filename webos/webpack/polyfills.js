// Polyfills only for the webOS build (owner: F1.3).
//
// Prepends webos/polyfills/index.js to the page entry and webos/polyfills/worker.js to the core
// worker entry. Contract: runs after core.js and only prepends to whatever main and worker
// already are (the core glue in the worker uses queueMicrotask). The desktop build never loads
// these modules, so it is unchanged.

const path = require('path');
const { ROOT } = require('./utils');

const POLYFILLS_DIR = path.join(ROOT, 'webos', 'polyfills');

const prefix = (entry, ...modules) => [...modules, ...[].concat(entry)];

module.exports = (config) => {
    config.entry.main = prefix(config.entry.main, path.join(POLYFILLS_DIR, 'index.js'));
    config.entry.worker = prefix(config.entry.worker, path.join(POLYFILLS_DIR, 'worker.js'));
    return config;
};
