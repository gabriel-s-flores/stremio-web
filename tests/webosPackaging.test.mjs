import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lgVersion, appInfo } from '../scripts/webos-appinfo.mjs';

const hash = 'a'.repeat(40);
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webos-package-test-'));
    for (const dir of ['scripts', 'webos']) fs.cpSync(dir, path.join(root, dir), { recursive: true });
    fs.copyFileSync('package.json', path.join(root, 'package.json'));
    for (const file of ['manifest.json', 'webos/webOSTV.js', `${hash}/scripts/main.js`, `${hash}/scripts/worker.js`, `${hash}/binaries/core.wasm`]) {
        const target = path.join(root, 'build', file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, '{}');
    }
    fs.writeFileSync(path.join(root, 'build', hash, 'scripts/main.js.map'), JSON.stringify({ sources: ['webpack://stremio/src/index.js'] }));
    fs.writeFileSync(path.join(root, 'build/index.html'), `<script src="webos/webOSTV.js"></script><script src="${hash}/scripts/main.js"></script>`);
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'ares-package'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
if (args[0] !== '--no-minify') process.exit(9);
const info = JSON.parse(fs.readFileSync(path.join(args[1], 'appinfo.json')));
fs.writeFileSync(path.join(args[3], info.id + '_' + info.version + '_all.ipk'), 'fixture');
`, { mode: 0o755 });
    return { root, run: (...args) => spawnSync(process.execPath, ['scripts/package-webos.mjs', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } }) };
}

test('LG version and final manifest preserve platform policy', () => {
    assert.equal(lgVersion('5.0.0-beta.39'), '5.0.0');
    assert.equal(lgVersion('12.3.45+abc'), '12.3.45');
    assert.throws(() => lgVersion('01.2.3'));
    assert.throws(() => lgVersion('5.0'));
    assert.equal(appInfo().disableBackHistoryAPI, true);
    assert.equal(appInfo().main, 'index.html');
});

test('packaging preserves commit assets, omits maps and leaves source build unchanged', () => {
    const f = fixture();
    try {
        const result = f.run();
        assert.equal(result.status, 0, result.stderr);
        const stage = path.join(f.root, 'dist-webos/packaged');
        assert.equal(fs.readFileSync(path.join(stage, hash, 'scripts/main.js'), 'utf8'), '{}');
        assert.ok(!fs.existsSync(path.join(stage, hash, 'scripts/main.js.map')));
        assert.ok(fs.existsSync(path.join(f.root, 'build', hash, 'scripts/main.js.map')));
        assert.equal(JSON.parse(fs.readFileSync(path.join(stage, 'appinfo.json'))).version, '5.0.0');
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('invalid packaged build fails before staging and hosted URL is validated', () => {
    const f = fixture();
    try {
        fs.writeFileSync(path.join(f.root, 'build/service-worker.js'), '{}');
        assert.notEqual(f.run().status, 0);
        assert.ok(!fs.existsSync(path.join(f.root, 'dist-webos')));
        for (const url of ['file:///tmp/', 'https://user:secret@example.com/', 'https://example.com/app', 'https://example.com/?a=1']) assert.notEqual(f.run('--hosted', url).status, 0);
        assert.equal(f.run('--hosted', 'https://example.com/app/').status, 0);
        const stage = path.join(f.root, 'dist-webos/hosted');
        assert.equal(JSON.parse(fs.readFileSync(path.join(stage, 'appinfo.json'))).id, 'com.stremio.webos.hosted');
        assert.ok(fs.readFileSync(path.join(stage, 'index.html'), 'utf8').includes('location.replace("https://example.com/app/")'));
        assert.ok(!fs.existsSync(path.join(stage, hash)));
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('packaged verifier rejects absolute assets and desktop remote scripts', () => {
    const f = fixture();
    try {
        const index = path.join(f.root, 'build/index.html');
        const valid = fs.readFileSync(index, 'utf8');
        for (const bad of ['<script src="https://example.com/extra.js"></script>', '<script src="//www.gstatic.com/cast_sender.js"></script>', '<link href="/manifest.json">']) {
            fs.writeFileSync(index, valid + bad);
            assert.notEqual(f.run().status, 0, bad);
            assert.ok(!fs.existsSync(path.join(f.root, 'dist-webos')));
        }
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
