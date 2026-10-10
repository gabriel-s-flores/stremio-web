#!/usr/bin/env node
/* eslint-disable no-console */
// Builds the smoke IPK: bundles the header probe for Chromium 53 (babel preset-env, the same
// loader the app uses) as the global `HeaderProbe`, copies the page and packages it with ares-package.
//   node build.mjs [outDir]      (default: ./out)  ->  <outDir>/app/ and <outDir>/*.ipk
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const webpack = require('webpack');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, 'out'));
const APP = path.join(OUT, 'app');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });
for (const file of fs.readdirSync(path.join(HERE, 'app'))) {
    fs.copyFileSync(path.join(HERE, 'app', file), path.join(APP, file));
}

const config = {
    mode: 'production',
    target: ['web', 'es5'],
    entry: path.join(HERE, '..', 'index.js'),
    output: { path: APP, filename: 'probe.bundle.js', library: { name: 'HeaderProbe', type: 'var' } },
    module: {
        rules: [{
            test: /\.js$/,
            use: {
                loader: require.resolve('babel-loader'),
                options: { babelrc: false, configFile: false, presets: [[require.resolve('@babel/preset-env'), { targets: { chrome: '53' } }]] },
            },
        }],
    },
    optimization: { minimize: false },
    devtool: false,
};

webpack(config, (error, stats) => {
    if (error || stats.hasErrors()) {
        console.error(error || stats.toString('errors-only'));
        process.exit(1);
    }
    execFileSync('ares-package', [APP, '-o', OUT], { stdio: 'inherit' });
    console.log('smoke app built in ' + OUT);
});
