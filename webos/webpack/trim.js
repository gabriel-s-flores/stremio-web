// Bundle trimming for webOS (owner: F1.5).
//
// Extension point: replace heavy modules with stubs and drop what the TV does not use, e.g.
//   config.resolve.alias['hls.js'] = path.join(__dirname, '..', 'stubs', 'hls.js');
//   config.resolve.alias['@stremio/libass-wasm'] = ...;
// and turn Sentry off. Today it is a no-op.

module.exports = (config) => {
    return config;
};
