// Polyfills only for the webOS build (owner: F1.3).
//
// Extension point: prepend the polyfills module to the page entry, e.g.
//   config.entry.main = [path.join(__dirname, '..', 'polyfills', 'index.js'), config.entry.main];
// (and to config.entry.worker if the core worker needs any). Today it is a no-op.

module.exports = (config) => {
    return config;
};
