// stremio-core-web for webOS (owner: F1.4).
//
// Extension point: alias the core package to the vendored MVP build and point the worker
// entry at it, e.g.
//   config.resolve.alias['@stremio/stremio-core-web'] = path.join(ROOT, 'webos', 'vendor', ...);
//   config.entry.worker = ...;
// Today it is a no-op: the upstream package from node_modules is bundled.

module.exports = (config) => {
    return config;
};
