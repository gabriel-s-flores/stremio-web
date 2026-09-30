const path = require('path');
const os = require('os');
const webpack = require('webpack');
const createConfig = require('../webpack.config');
module.exports = (env, argv) => {
    const config = createConfig({ WEBOS: '1', WEBOS_DEBUG: '1' }, argv);
    config.output.path = path.join(os.tmpdir(), 'stremio-t26', 'fixture');
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /[\\/]FocusDebugPage$/, path.resolve(__dirname, 't26-row-fixture.js')
    ));
    return config;
};
