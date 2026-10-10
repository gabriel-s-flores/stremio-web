// Empacota o app do spike de init (F0.11) para uma variante do core (build/variants/NOME):
//   npx webpack --config webos/spikes/core-init/webpack.config.js --env variant=NOME
// Saída: build/app-NOME (pasta do IPK). Como o webos/tests/core-smoke da F0.6: o require do .wasm no
// worker.js vendorizado aponta para o carregador (webos/core/wasm-module.js), e a glue vendorizada é
// trocada pela da variante (cada build do cargo tem a sua).
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (env = {}) => {
    const name = env.variant;
    if (!name) throw new Error('use --env variant=NOME (pasta em build/variants)');
    const variant = path.join(__dirname, 'build', 'variants', name);
    const out = path.join(__dirname, 'build', 'app-' + name);
    const vendor = path.join(__dirname, '..', '..', 'vendor', 'stremio-core-web');
    const core = path.join(__dirname, '..', '..', 'core');
    const common = {
        mode: 'production',
        context: __dirname,
        devtool: false,
        optimization: { minimize: false },
        performance: { hints: false }
    };
    return [
        {
            ...common,
            name: 'page',
            target: ['web', 'es5'],
            entry: { main: './page.js' },
            output: { path: out, filename: '[name].js', publicPath: '' },
            plugins: [new CopyWebpackPlugin({ patterns: [{ from: 'app', to: out }] })]
        },
        {
            ...common,
            name: 'worker',
            target: ['webworker', 'es5'],
            entry: { worker: './worker.js' },
            output: { path: out, filename: '[name].js', publicPath: '' },
            resolve: {
                alias: {
                    [path.join(vendor, 'stremio_core_web_bg.wasm')]: path.join(core, 'wasm-module.js'),
                    [path.join(vendor, 'stremio_core_web.js')]: path.join(variant, 'stremio_core_web.js')
                }
            },
            plugins: [
                new CopyWebpackPlugin({
                    patterns: [
                        { from: path.join(variant, 'stremio_core_web_bg.wasm'), to: out },
                        { from: path.join(variant, 'stremio_core_web_bg.wasm2js.js'), to: out, info: { minimized: true } },
                        { from: path.join(variant, 'variant.json'), to: out }
                    ]
                })
            ]
        }
    ];
};
