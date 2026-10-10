#!/usr/bin/env node
/* eslint-disable no-console */
// Builds the smoke IPK: bundles the C8 rules for Chromium 53 (babel preset-env, the same loader
// the app uses) as the global `C8Rules`, checks the bundle syntax, and ships a list of cases
// (real probe outputs + stream names) with the result the same rules give in Node.
//   node build.mjs [outDir]      (default: ./out)  ->  <outDir>/app/, <outDir>/*.ipk, <outDir>/expected.json
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const webpack = require('webpack');
const acorn = createRequire(require.resolve('webpack'))('acorn');
const { probe } = require('../../header-probe');
const { loadFixture, replayReadRange, bufferReadRange } = require('../../header-probe/test/replay');
const { evaluate, sortStreams } = require('../index.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, 'out'));
const APP = path.join(OUT, 'app');
const FIXTURES = path.join(HERE, '..', '..', 'header-probe', '__fixtures__');
const HEADERS = path.join(HERE, '..', '..', '..', 'tests', 'media', 'headers');

// Every probe fixture and catalogued header, plus name-only and ambiguous cases.
const NAMED = [
    ['name: WEB-DL DV DDP Atmos (mkv)', null, 'Movie.2160p.WEB-DL.DV.H265.DDP5.1.Atmos.mkv'],
    ['name: REMUX DV P7 FEL TrueHD', null, 'Movie.2160p.BluRay.REMUX.DV.P7.FEL.HEVC.TrueHD.7.1.Atmos'],
    ['name: DV P5 mp4', null, { name: 'Addon 4k DV', behaviorHints: { filename: 'Movie.2160p.DV.P5.mp4' } }],
    ['name: AV1', null, 'Movie.2160p.AV1.Opus.mkv'],
    ['name: DTS-HD MA', null, 'Movie.1080p.BluRay.x264.DTS-HD.MA.5.1.mkv'],
    ['dv-p5-nobam-mkv no-sniff + "DV"', ['dv-p5-nobam-mkv', { sniffFrames: false }], 'Movie 2160p WEB-DL DV'],
    ['kit-hevc10-mkv + "DV HDR10"', ['kit-hevc10-mkv', {}], 'Movie 2160p DV HDR10'],
];

const buildCases = async () => {
    const cases = [];
    const fixtureIds = fs.readdirSync(FIXTURES).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5)).sort();
    for (const id of fixtureIds) {
        const fixture = loadFixture(id);
        cases.push({ id, probe: await probe(replayReadRange(fixture), fixture.meta.options), stream: null, preferences: { audioLanguages: ['por', 'eng'] } });
    }
    const headers = fs.readdirSync(HEADERS).filter((file) => /\.(mkv|mka|mp4|mov)$/.test(file)).sort();
    for (const file of headers) {
        const bytes = new Uint8Array(fs.readFileSync(path.join(HEADERS, file)));
        cases.push({ id: file, probe: await probe(bufferReadRange(bytes)), stream: null, preferences: { audioLanguages: ['jpn', 'eng'] } });
    }
    for (const [id, fixtureSpec, stream] of NAMED) {
        let probeResult = null;
        if (fixtureSpec) {
            const fixture = loadFixture(fixtureSpec[0]);
            probeResult = await probe(replayReadRange(fixture), Object.assign({}, fixture.meta.options, fixtureSpec[1]));
        }
        cases.push({ id, probe: probeResult, stream, preferences: { audioLanguages: ['por'] } });
    }
    return cases;
};

const bundle = () => new Promise((resolve, reject) => {
    webpack({
        mode: 'production',
        target: ['web', 'es5'],
        entry: path.join(HERE, '..', 'index.js'),
        output: { path: APP, filename: 'c8-rules.bundle.js', library: { name: 'C8Rules', type: 'var' } },
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
    }, (error, stats) => {
        if (error || stats.hasErrors()) reject(error || new Error(stats.toString('errors-only')));
        else resolve();
    });
});

// Chromium 53 parses ES2016; the sources themselves already stay inside it (no transpilation needed).
const checkSyntax = (file) => {
    acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 2016, sourceType: 'script' });
    return path.relative(OUT, file);
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });
for (const file of fs.readdirSync(path.join(HERE, 'app'))) {
    fs.copyFileSync(path.join(HERE, 'app', file), path.join(APP, file));
}

const cases = await buildCases();
const expected = cases.map((entry) => ({ id: entry.id, result: evaluate(entry) }));
const sorted = sortStreams(expected, (entry) => entry.result).map((entry) => entry.id);
fs.writeFileSync(path.join(APP, 'cases.js'), 'window.SMOKE_CASES = ' + JSON.stringify(cases) + ';\n');
fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify({ results: expected, sorted }, null, 1));
await bundle();
const checked = [checkSyntax(path.join(APP, 'c8-rules.bundle.js'))];
for (const file of ['index.js', 'name.js', 'languages.js']) {
    acorn.parse(fs.readFileSync(path.join(HERE, '..', file), 'utf8'), { ecmaVersion: 2016, sourceType: 'script' });
    checked.push('webos/lib/c8-rules/' + file);
}
fs.writeFileSync(path.join(OUT, 'syntax.txt'), 'ES2016 (acorn) OK: ' + checked.join(', ') + '\n');
execFileSync('ares-package', [APP, '-o', OUT], { stdio: 'inherit' });
console.log('smoke app built in ' + OUT + ' (' + cases.length + ' cases)');
