#!/usr/bin/env node
// boot-bench.js on the JavaScript engine of the TV (F8.7): Node 8.2 has V8 5.8.283, the TV's LG V8 is 5.8.301.
// The TV runs the app with the v8ExtraFlags of webos/app/appinfo.json ("--no-crankshaft", F7.2: nothing of the
// wasm2js core is optimized there, which a current Node, where the core is ~45 times faster, does not show;
// "--no-flush-code", F8.7).
//
//   node webos/tests/perf/v58.mjs [--node <node 8 binary>] [--v8 "<V8 flags>"] [--prof <out.cpuprofile>] -- <boot-bench.js args>
//
// - --node: default ~/webos-tv-sdk/tools/node8/node-v8.2.1-linux-x64/bin/node;
// - --v8: default the v8ExtraFlags of webos/app/appinfo.json; "" for the default V8 5.8 pipeline (Crankshaft);
// - --prof: a CPU profile of the whole run through the inspector module of Node 8 (1 ms), for symbolize.mjs.
// The bench and what it requires are transpiled to Node 8 with the repo's Babel into a temporary folder;
// the vendored core (ES5) is loaded as is. Node 8 has no fetch: run with --offline (the network cache of a
// previous run of boot-bench.js under the current Node).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split === -1 ? argv : argv.slice(0, split);
const rest = split === -1 ? [] : argv.slice(split + 1);
const option = (name, fallback) => {
    const index = own.indexOf(`--${name}`);
    return index !== -1 && index + 1 < own.length ? own[index + 1] : fallback;
};
const NODE = option('node', path.join(os.homedir(), 'webos-tv-sdk/tools/node8/node-v8.2.1-linux-x64/bin/node'));
const APP_FLAGS = JSON.parse(fs.readFileSync(path.join(REPO, 'webos/app/appinfo.json'), 'utf8')).v8ExtraFlags || '';
const FLAGS = option('v8', APP_FLAGS).split(' ').filter(Boolean);
const PROF = option('prof', null);

// The files of the bench, same relative paths under OUT.
const FILES = [
    'webos/tests/perf/boot-bench.js',
    'webos/tests/perf/library-fixture.js',
    'webos/tests/addon/torrentio.js',
    'webos/core/loader.js',
    'webos/lib/catalog-trim/index.js',
    'webos/lib/meta-first/index.js',
];
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'v58-'));
for (const file of FILES) {
    const { code } = babel.transformFileSync(path.join(REPO, file), {
        babelrc: false,
        configFile: false,
        presets: [[require.resolve('@babel/preset-env'), { targets: { node: '8.2' }, modules: 'commonjs' }]],
    });
    fs.mkdirSync(path.dirname(path.join(OUT, file)), { recursive: true });
    fs.writeFileSync(path.join(OUT, file), code);
}
fs.cpSync(path.join(REPO, 'webos/tests/perf/fixtures'), path.join(OUT, 'webos/tests/perf/fixtures'), { recursive: true });
// What Node 8 lacks for the core's glue and the bench (ES5, run before the bench).
fs.writeFileSync(path.join(OUT, 'prelude.js'), `
var start = process.hrtime();
if (!Object.fromEntries) Object.fromEntries = function (entries) { var o = {}; Array.from(entries).forEach(function (e) { o[e[0]] = e[1]; }); return o; };
global.performance = { now: function () { var t = process.hrtime(start); return t[0] * 1e3 + t[1] / 1e6; }, mark: function () {}, measure: function () {}, clearMarks: function () {}, clearMeasures: function () {} };
global.TextDecoder = function () {};
global.TextDecoder.prototype.decode = function (u8) { return u8 ? Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('utf8') : ''; };
global.TextEncoder = function () {};
global.TextEncoder.prototype.encode = function (s) { var b = Buffer.from(String(s), 'utf8'); return new Uint8Array(b.buffer, b.byteOffset, b.length); };
global.Response = function (body, init) { this._body = String(body); this.status = (init && init.status) || 200; this.statusText = ''; this.headers = (init && init.headers) || {}; };
global.Response.prototype.text = function () { return Promise.resolve(this._body); };
global.URL = require('url').URL;
global.Request = function (url, init) { this.url = url; this.method = (init && init.method) || 'GET'; this.headers = (init && init.headers) || {}; this.body = init && init.body; };
global.fetch = function () { return Promise.reject(new TypeError('no fetch in Node 8: run boot-bench.js --offline')); };
var prof = process.env.V58_PROF;
if (prof) {
    var inspector = require('inspector');
    var session = new inspector.Session();
    session.connect();
    session.post('Profiler.enable');
    session.post('Profiler.setSamplingInterval', { interval: 1000 });
    session.post('Profiler.start');
    var exit = process.exit;
    process.exit = function (code) {
        session.post('Profiler.stop', function (error, result) {
            if (!error) require('fs').writeFileSync(prof, JSON.stringify(result.profile));
            exit.call(process, code);
        });
    };
}
`);
const vendorIndex = rest.indexOf('--vendor');
// The vendored core's glue requires @babel/runtime: from the repo.
const env = Object.assign({}, process.env, { NODE_PATH: path.join(REPO, 'node_modules'), V58_PROF: PROF ? path.resolve(PROF) : '' });
const args = [...FLAGS, '-r', path.join(OUT, 'prelude.js'), path.join(OUT, 'webos/tests/perf/boot-bench.js'),
    ...(vendorIndex === -1 ? ['--vendor', path.join(REPO, 'webos/vendor/stremio-core-web')] : []), ...rest];
const run = spawnSync(NODE, args, { stdio: 'inherit', env });
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(run.status === null ? 1 : run.status);
