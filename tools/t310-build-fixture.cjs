const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const HtmlPlugin = require('html-webpack-plugin');
const output = process.argv[2];
if (!output || fs.existsSync(output)) throw Error('Provide a new output directory');
const stub = path.resolve(__dirname, 't310-stubs.js');
webpack({
    mode: 'production', devtool: 'source-map', target: ['web', 'es2018'],
    entry: path.resolve(__dirname, 't310-fixture.js'),
    output: { path: path.resolve(output), filename: 'fixture.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js', '.json'], alias: { stremio: path.resolve(__dirname, '../src') } },
    module: { rules: [
        { test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.resolve(__dirname, 't310-loader.cjs') },
        { test: /\.less$/, type: 'javascript/auto', use: path.resolve(__dirname, 't310-style-loader.cjs') },
    ] },
    plugins: [
        new webpack.DefinePlugin({ 'process.env.VERSION': JSON.stringify('T3.10 fixture'), 'process.env.COMMIT_HASH': JSON.stringify('isolated') }),
        new HtmlPlugin({ template: path.resolve(__dirname, 't310-fixture.html') }),
        new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }),
        new webpack.NormalModuleReplacementPlugin(/.*/, resource => {
            const context = resource.context.replace(/\\/g, '/');
            const request = resource.request;
            if (['stremio/common', 'stremio/components', 'react-i18next', 'react-router'].includes(request)
                || request === '../Platform' && /\/src\/common\/(FileDrop|Discord)$/.test(context)
                || request === '../components' && /\/src\/routes\/Settings\//.test(context)) resource.request = stub;
            else if (request === '../useProfile' && context.endsWith('/src/common/Discord')) resource.request = path.resolve(__dirname, 't310-profile.js');
            else if (/^\.\/use(Interface|Player)Options$/.test(request)) resource.request = path.resolve(__dirname, 't310-options.js');
            else if (/^\.\/(General|Streaming|Info)$/.test(request) && context.endsWith('/src/routes/Settings')) resource.request = path.resolve(__dirname, 't310-empty.js');
        }),
    ],
}, (error, stats) => {
    if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; }
    else { console.log(stats.toString({ all: false, assets: true })); }
});
