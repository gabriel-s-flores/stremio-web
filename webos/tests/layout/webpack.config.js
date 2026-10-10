// Layout page (F2.3): real components with fixed data, to capture the layout of screens that
// need an account or add-ons (Calendar, Live TV) or an open player (statistics), and to compare
// the webOS build with the desktop one. Two targets from the same harness.js:
//   webos/tools/build-run -- npx webpack --config webos/tests/layout/webpack.config.js --env target=webos
//   webos/tools/build-run -- npx webpack --config webos/tests/layout/webpack.config.js --env target=desktop
// Output: webos/tests/layout/build/<target>. The webOS one is an app folder (appinfo.json) for
// ares-package; the desktop one is opened by the browser (webos/tests/layout/run).
// Run from the repository root (the root webpack config reads the git commit from there).

const path = require('path');
const webpack = require('webpack');
const HtmlWebPackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HARNESS = path.join(__dirname, 'harness.js');
const USE_PROFILE_STUB = path.join(__dirname, 'stubs', 'useProfile.js');
const CREATE_TRANSPORT_STUB = path.join(__dirname, 'stubs', 'createTransport.js');

const without = (config, name) => {
    config.plugins = config.plugins.filter((plugin) => plugin.constructor.name !== name);
};

module.exports = (env) => {
    const target = env && env.target;
    if (target !== 'webos' && target !== 'desktop') {
        throw new Error('layout: pass --env target=webos or --env target=desktop');
    }
    const argv = { mode: 'production' };
    const factory = target === 'webos' ? require('../../webpack/webpack.config.js') : require('../../../webpack.config.js');
    const config = factory({}, argv);

    // Same entry as the app (polyfills before, webOS styles after), with the harness instead of the app.
    config.entry = {
        main: [].concat(config.entry.main).map((entry) => entry === './src/index.js' ? HARNESS : entry),
    };
    config.output = { ...config.output, path: path.join(__dirname, 'build', target), publicPath: 'auto' };
    config.devtool = false;
    config.optimization = { ...config.optimization, minimize: false };
    config.performance = { hints: false };

    // CoreArtifactsGuard: the layout page has no core.
    ['CopyPlugin', 'HtmlWebpackPlugin', 'GenerateSW', 'CoreArtifactsGuard'].forEach((name) => without(config, name));
    const patterns = [];
    if (target === 'webos') {
        patterns.push({ from: path.join(__dirname, 'app', '*.{json,png}'), to: '[name][ext]' });
    }
    config.plugins.push(
        new HtmlWebPackPlugin({ template: path.join(__dirname, 'app', 'index.html'), inject: false, scriptLoading: 'blocking' }),
        // The core is not started: the worker and the profile hook are replaced.
        new webpack.NormalModuleReplacementPlugin(/^\.\/createTransport$/, (resource) => {
            if (path.resolve(resource.context) === path.join(ROOT, 'src', 'core')) {
                resource.request = CREATE_TRANSPORT_STUB;
            }
        }),
        new webpack.NormalModuleReplacementPlugin(/^\.\/useProfile$/, (resource) => {
            if (path.resolve(resource.context) === path.join(ROOT, 'src', 'common')) {
                resource.request = USE_PROFILE_STUB;
            }
        }),
    );
    if (patterns.length > 0) {
        config.plugins.push(new CopyWebpackPlugin({ patterns }));
    }
    return config;
};
