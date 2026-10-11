// Bundle trimming for webOS (F1.5): heavy modules the TV does not use are replaced by small
// stubs in webos/stubs/, through aliases (the upstream code and node_modules are untouched).
//   hls.js              the TV plays the debrid link natively; HLS is reported as unsupported.
//   @stremio/libass-wasm  ASS/SSA falls back to the plain subtitles path (8.5 MB less).
//   @sentry/browser     Sentry is off, whatever SENTRY_DSN says.
//   workbox-window      dead code: the service worker is off in the packaged app.
//   stremio-translations  only en-US in main.js, the other languages load on demand (F7.2, 6.3 MB).

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
    'stremio-translations$': 'stremio-translations.js',
};

// The folder of the real package, for the stub's on-demand chunks (stremio-translations is the stub).
const TRANSLATIONS_DIR = path.dirname(require.resolve('stremio-translations/package.json', { paths: [ROOT] }));

module.exports = (config) => {
    config.resolve.alias = { ...config.resolve.alias };
    Object.entries(STUBS).forEach(([request, stub]) => {
        config.resolve.alias[request] = path.join(STUBS_DIR, stub);
    });
    config.resolve.alias['stremio-translations-languages'] = TRANSLATIONS_DIR;

    return config;
};
