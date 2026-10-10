// Probe bundle for the emulator: only the F1.3 polyfills and a script that measures them, built
// through the real webos/webpack/polyfills.js (so the prefixing contract is what is tested).
//   NO_POLYFILLS=1  same probe without the polyfills: shows what Chromium 53 lacks.
//   pnpm exec webpack --config webos/tests/polyfills/emulator/webpack.config.js

const path = require('path');
const webpack = require('webpack');
const withPolyfills = require('../../../webpack/polyfills');
const { ROOT } = require('../../../webpack/utils');

const locales = Object.keys(require('stremio-translations')());

const config = {
    mode: 'production',
    devtool: false,
    target: ['web', 'es5'],
    entry: {
        main: path.join(__dirname, 'page.js'),
        worker: path.join(__dirname, 'worker.js'),
    },
    output: {
        path: path.join(__dirname, 'dist'),
        filename: '[name].js',
        clean: true,
    },
    plugins: [
        new webpack.DefinePlugin({ APP_LOCALES: JSON.stringify(locales) }),
    ],
    performance: false,
};

module.exports = () => {
    if (process.env.NO_POLYFILLS) {
        return config;
    }
    return withPolyfills(config, { env: {}, argv: { mode: 'production' } }, ROOT);
};
