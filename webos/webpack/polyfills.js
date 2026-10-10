// Polyfills only for the webOS build (owner: F1.3).
//
// Extension point: prepend the polyfills module to the page and worker entries, e.g.
//   config.entry.main = [polyfills, ...[].concat(config.entry.main)];
//   config.entry.worker = [workerPolyfills, ...[].concat(config.entry.worker)];
// Contract: runs after core.js and only prepends to whatever main and worker already are
// (the core glue in the worker uses queueMicrotask). Today it is a no-op.

module.exports = (config) => {
    return config;
};
