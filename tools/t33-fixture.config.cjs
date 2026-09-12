const path = require('path');
const os = require('os');
const CopyPlugin = require('copy-webpack-plugin');
module.exports = {
    mode: 'development', devtool: false, target: ['web', 'es2018'],
    entry: './tools/t33-video-fixture.js',
    output: { path: path.join(os.tmpdir(), 'stremio-t33-fixture'), filename: 'fixture.js' },
    module: { rules: [{ test: /\.js$/, use: { loader: 'babel-loader', options: { presets: [['@babel/preset-env', { targets: { chrome: '68' } }]] } } }] },
    resolve: { fallback: { fs: false, path: false } },
    plugins: [new CopyPlugin({ patterns: [
        { from: 'webos/lib/webOSTVjs-1.2.10/webOSTV.js', to: 'webOSTV.js' },
        { from: 'webos/hello/packaged/icon.png', to: 'icon.png' },
        { from: 'tools/t33-fixture.html', to: 'index.html' },
        { from: 'tools/t33-fixture-appinfo.json', to: 'appinfo.json' }
    ] })]
};
