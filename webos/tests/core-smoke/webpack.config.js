// Empacota o smoke do core: a página (main.js) e o worker vendorizado (worker.js + .wasm), como o
// webpack do app faz com o worker do @stremio/stremio-core-web. Saída: build/app (pasta do IPK).
//   npx webpack --config webos/tests/core-smoke/webpack.config.js
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const out = path.join(__dirname, 'build', 'app');

const common = {
    mode: 'production',
    context: __dirname,
    devtool: false,
    optimization: { minimize: false },
    performance: { hints: false },
    module: {
        rules: [
            {
                test: /\.wasm$/,
                type: 'asset/resource',
                generator: { filename: '[name][ext]' }
            }
        ]
    }
};

module.exports = [
    {
        ...common,
        name: 'page',
        target: ['web', 'es5'],
        entry: { main: './smoke.js' },
        output: { path: out, filename: '[name].js', publicPath: '' },
        plugins: [new CopyWebpackPlugin({ patterns: [{ from: 'app', to: out }] })]
    },
    {
        ...common,
        name: 'worker',
        target: ['webworker', 'es5'],
        entry: { worker: './smoke-worker.js' },
        output: { path: out, filename: '[name].js', publicPath: '' }
    }
];
