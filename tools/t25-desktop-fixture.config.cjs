// Test-only desktop build exposing the same real-control fixtures as WEBOS_DEBUG.
// Never used by package.json production scripts. Serve this output separately.
const path = require('path');
const os = require('os');
const webpack = require('webpack');
const createConfig = require('../webpack.config');

module.exports = (_env, argv) => {
    const config = createConfig({}, argv);
    config.output.path = path.join(os.tmpdir(), 'stremio-t25-desktop', 'focus-fixture');
    config.resolve.alias['stremio-router-base-paths$'] = path.resolve(__dirname, '../src/router/routerPaths.tsx');
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /[\\/]routerPaths$/,
        path.resolve(__dirname, '../src/router/routerPaths.webos.tsx')
    ));
    return config;
};
