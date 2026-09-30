import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assess, budgets, bundleSize } from '../tools/webos-quality.mjs';
test('missing and invalid measurements never pass; exact budgets pass', () => {
    assert.ok(Object.values(assess({})).every(x => x === 'unmeasured'));
    assert.ok(Object.values(assess(budgets)).every(x => x === 'pass'));
    assert.equal(assess({ scrollFps: 44 }).scrollFps, 'fail');
    assert.equal(assess({ bootHeapBytes: budgets.bootHeapBytes + 1 }).bootHeapBytes, 'fail');
    assert.equal(assess({ bootInteractiveMs: -1 }).bootInteractiveMs, 'unmeasured');
});
test('bundle totals include nested scripts, CSS, WASM and exclude maps', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webos-quality-'));
    try {
        fs.mkdirSync(path.join(root, 'scripts'));
        fs.writeFileSync(path.join(root, 'scripts/a.js'), 'x'.repeat(1000));
        fs.writeFileSync(path.join(root, 'a.css'), 'abc');
        fs.writeFileSync(path.join(root, 'a.wasm'), 'abcd');
        fs.writeFileSync(path.join(root, 'a.js.map'), 'ignored');
        const report = bundleSize(root);
        assert.equal(report.bytes, 1007);
        assert.equal(report.files.length, 3);
        assert.ok(report.gzipBytes < report.bytes);
    } finally { fs.rmSync(root, { recursive: true }); }
});
test('unreachable CDP writes blocked evidence and exits unsuccessfully', async () => {
    const { spawnSync } = await import('node:child_process');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webos-blocked-'));
    try {
        const output = path.join(root, 'result.json');
        const result = spawnSync(process.execPath, ['tools/webos-phase7.mjs', 'collect',
            'http://127.0.0.1:1', 'target', output], { encoding: 'utf8', timeout: 10000 });
        assert.equal(result.status, 1);
        const report = JSON.parse(fs.readFileSync(output));
        assert.equal(report.status, 'blocked');
        assert.equal(report.samples.length, 0);
    } finally { fs.rmSync(root, { recursive: true }); }
});
