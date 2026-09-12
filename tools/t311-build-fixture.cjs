const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const HtmlPlugin = require('html-webpack-plugin');
const MiniCss = require('mini-css-extract-plugin');
const output = process.argv[2];
if (!output || fs.existsSync(output)) throw Error('Provide a new output directory');
webpack({
    mode: 'production', devtool: 'source-map', target: ['web', 'es2018'],
    entry: path.resolve(__dirname, 't311-fixture.js'),
    output: { path: path.resolve(output), filename: 'fixture.js', publicPath: '' },
    resolve: { extensions: ['.tsx', '.ts', '.js', '.json', '.less'], alias: {
        stremio: path.resolve(__dirname, '../src'), '/assets': path.resolve(__dirname, '../assets')
    } },
    module: { rules: [
        { test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.resolve(__dirname, 't311-loader.cjs') },
        { test: /\.[cm]?js$/, include: /node_modules/, use: { loader: 'babel-loader', options: {
            babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { chrome: '68' }, modules: false }]]
        } } },
        { test: /\.less$/, use: [{ loader: MiniCss.loader, options: { esModule: false } },
            { loader: 'css-loader', options: { esModule: false, importLoaders: 1, modules: { namedExport: false, localIdentName: '[local]' } } },
            { loader: 'less-loader', options: { lessOptions: { modifyVars: { webos: 'true' } } } }
        ] },
        { test: /\.(png|svg)$/, type: 'asset/inline' }
    ] },
    plugins: [new MiniCss({ filename: 'fixture.css' }), new HtmlPlugin({ template: path.resolve(__dirname, 't311-fixture.html') }),
        new webpack.NormalModuleReplacementPlugin(/.*/, resource => {
            if (['stremio/common', 'stremio/components', 'stremio/core', 'react-i18next', 'stremio/common/useRouteFocused'].includes(resource.request)) resource.request = path.resolve(__dirname, 't311-stubs.js');
            else if (resource.request === 'stremio/router/Modal') resource.request = path.resolve(__dirname, 't311-modal.js');
            else if (resource.request === 'stremio/components/ExternalLink') resource.request = path.resolve(__dirname, 't311-link.js');
        })]
}, (error, stats) => {
    if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; }
    else {
        fs.writeFileSync(path.join(output, 'appinfo.json'), JSON.stringify({
            id: 'com.stremio.t311.fixture', version: '1.0.0', vendor: 'Stremio test fixture', type: 'web',
            main: 'index.html', title: 'T3.11 fixture', icon: 'icon.png', resolution: '1920x1080'
        }, null, 2) + '\n');
        fs.copyFileSync(path.resolve(__dirname, '../assets/images/logo.png'), path.join(output, 'icon.png'));
        console.log(stats.toString({ all: false, assets: true }));
    }
});
