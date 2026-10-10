// Empacota o smoke do core: a página (main.js) e o worker vendorizado (worker.js), como o webpack
// do app faz com o worker do @stremio/stremio-core-web. Saída: build/app (pasta do IPK).
//   npx webpack --config webos/tests/core-smoke/webpack.config.js
// O require('./stremio_core_web_bg.wasm') do worker.js vendorizado aponta para o carregador de
// webos/core (wasm-module.js), que escolhe WASM ou wasm2js em runtime; o .wasm e o .wasm2js.js vão
// copiados para a pasta do worker. O .wasm do npm (pós-MVP) vai junto para o cenário {"wasm":"npm"}.
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const out = path.join(__dirname, 'build', 'app');
const vendor = path.join(__dirname, '..', '..', 'vendor', 'stremio-core-web');
const core = path.join(__dirname, '..', '..', 'core');
const npmWasm = path.join(__dirname, '..', '..', '..', 'node_modules', '@stremio', 'stremio-core-web', 'stremio_core_web_bg.wasm');

const common = {
    mode: 'production',
    context: __dirname,
    devtool: false,
    optimization: { minimize: false },
    performance: { hints: false }
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
        output: { path: out, filename: '[name].js', publicPath: '' },
        resolve: {
            alias: { [path.join(vendor, 'stremio_core_web_bg.wasm')]: path.join(core, 'wasm-module.js') }
        },
        plugins: [
            new CopyWebpackPlugin({
                patterns: [
                    { from: path.join(vendor, 'stremio_core_web_bg.wasm'), to: out },
                    // 32,7 MB de JS: só copiado, sem minificar.
                    { from: path.join(vendor, 'stremio_core_web_bg.wasm2js.js'), to: out, info: { minimized: true } },
                    { from: npmWasm, to: path.join(out, 'npm_stremio_core_web_bg.wasm') }
                ]
            })
        ]
    }
];
