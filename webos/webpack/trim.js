// Bundle trimming for webOS (F1.5): heavy modules the TV does not use are replaced by small
// stubs in webos/stubs/, through aliases (the upstream code and node_modules are untouched).
//   hls.js              the TV plays the debrid link natively; HLS is reported as unsupported.
//   @stremio/libass-wasm  ASS/SSA falls back to the plain subtitles path (8.5 MB less).
//   @sentry/browser     Sentry is off, whatever SENTRY_DSN says.
//   workbox-window      dead code: the service worker is off in the packaged app.

const path = require('path');
const { ROOT } = require('./utils');

const STUBS_DIR = path.join(ROOT, 'webos', 'stubs');

// `$` makes the alias match the exact request only: the libass assets live in a subpath.
const STUBS = {
    'hls.js$': 'hls.js',
    '@stremio/libass-wasm$': 'libass-wasm.js',
    '@stremio/libass-wasm/dist/js/subtitles-octopus-assets$': 'libass-wasm-assets.js',
    '@sentry/browser$': 'sentry.js',
    'workbox-window$': 'workbox-window.js',
};

module.exports = (config) => {
    config.resolve.alias = { ...config.resolve.alias };
    Object.entries(STUBS).forEach(([request, stub]) => {
        config.resolve.alias[request] = path.join(STUBS_DIR, stub);
    });

    return config;
};
