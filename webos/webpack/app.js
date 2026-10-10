// Packaged webOS app (F1.1): output folder, index.html, appinfo.json, icons and webOSTV.js.
// No Workbox/PWA/Service Worker: the app runs from file:// inside the IPK.

const path = require('path');
const webpack = require('webpack');
const HtmlWebPackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const packageJson = require('../../package.json');
const { ROOT, findPlugin, replacePlugin, removePlugin } = require('./utils');

const OUTPUT_DIR = path.join(ROOT, 'build-webos');
const APP_DIR = path.join(ROOT, 'webos', 'app');
const WEBOSTV_DIR = path.join(ROOT, 'webos', 'vendor', 'webOSTVjs-1.2.13');

// appinfo.json only accepts numeric x.y.z versions: 5.0.0-beta.41 -> 5.0.0
const APP_VERSION = packageJson.version.split('-')[0];

module.exports = (config) => {
    config.context = ROOT;

    // 'auto' (the webpack default) resolves chunks, the worker and the wasm relative to the
    // script location, so the same build works from file:///media/developer/apps/...
    config.output = {
        ...config.output,
        path: OUTPUT_DIR,
        publicPath: 'auto',
    };

    // `require('./styles')` picks styles.webos.less over styles.less when it exists, so webOS
    // overrides live next to the upstream file without touching it. `.webos.less` comes after the
    // script extensions: `import Table from './Table'` must find Table.tsx, not Table.webos.less.
    const { extensions } = config.resolve;
    config.resolve.extensions = [
        ...extensions.filter((extension) => extension !== '.less').map((extension) => `.webos${extension}`),
        ...extensions.flatMap((extension) => extension === '.less' ? ['.webos.less', extension] : [extension]),
    ];

    removePlugin(config, 'GenerateSW');

    const environment = findPlugin(config, 'EnvironmentPlugin');
    replacePlugin(config, 'EnvironmentPlugin', new webpack.EnvironmentPlugin({
        ...environment.defaultValues,
        SERVICE_WORKER_DISABLED: true,
    }));

    replacePlugin(config, 'CopyPlugin', new CopyWebpackPlugin({
        patterns: [
            {
                from: path.join(APP_DIR, 'appinfo.json'),
                to: 'appinfo.json',
                transform: (content) => {
                    const appinfo = JSON.parse(content.toString());
                    return JSON.stringify({ ...appinfo, version: APP_VERSION }, null, 4);
                },
            },
            { from: path.join(APP_DIR, 'icon.png'), to: 'icon.png' },
            { from: path.join(APP_DIR, 'largeIcon.png'), to: 'largeIcon.png' },
            // Shipped byte for byte as downloaded from LG (Terser would minify it again).
            { from: path.join(WEBOSTV_DIR, 'webOSTV.js'), to: 'webOSTV/webOSTV.js', info: { minimized: true } },
            { from: path.join(WEBOSTV_DIR, 'LICENSE-2.0.txt'), to: 'webOSTV/LICENSE-2.0.txt' },
        ]
    }));

    replacePlugin(config, 'HtmlWebpackPlugin', new HtmlWebPackPlugin({
        template: path.join(APP_DIR, 'index.html'),
        inject: false,
        scriptLoading: 'blocking',
        // The worker entry is started by createTransport; it must not run in the page.
        excludeChunks: ['worker'],
        webOSTVPath: 'webOSTV/webOSTV.js',
    }));

    return config;
};
