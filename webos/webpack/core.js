// stremio-core-web for webOS (owner: F1.4).
//
// Extension point: alias the core package to the vendored MVP build and point the worker
// entry at it, e.g.
//   config.resolve.alias['@stremio/stremio-core-web'] = path.join(ROOT, 'webos', 'vendor', ...);
//   config.entry.worker = path.join(ROOT, 'webos', 'vendor', ..., 'worker.js');
// Contract: runs before polyfills.js and only replaces the worker entry path (a string); it
// must not add other modules to config.entry. Today it is a no-op: the upstream package from
// node_modules is bundled.

module.exports = (config) => {
    return config;
};
