import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { connect } from './t33-cdp.mjs';

const [mode, appId, hint, endpoint = 'http://localhost:51760', device = 'emulator'] = process.argv.slice(2);
if (!['hosted', 'packaged'].includes(mode) || !appId || !hint) {
    throw Error('Usage: node tools/t35-storage.mjs hosted|packaged appId targetHint [CDP URL] [device]');
}
const cli = process.env.APPDATA + '/npm/node_modules/@webos-tools/cli/bin/ares-launch.js';
const launch = (...args) => execFileSync(process.execPath, [cli, '-d', device, ...args, appId], { stdio: 'pipe', timeout: 30000 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = '__t35_storage_' + crypto.randomUUID();
const token = crypto.randomBytes(32).toString('hex');
const report = { date: new Date().toISOString(), mode, appId, device, immediate: false, closed: false, reopened: false, persisted: false, cleaned: false, passed: false };
const errors = { storage: false, wasm: false };
const onEvent = event => {
    if (!['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(event.method)) return;
    const value = JSON.stringify(event.params);
    if (/QuotaExceededError|localStorage|local_storage/i.test(value)) errors.storage = true;
    if (/wasm|WebAssembly|Failed to initialize core/i.test(value)) errors.wasm = true;
};
let c;
let phase = 'connect';
let written = false;
const attach = async () => {
    for (let i = 0; i < 30; i++) {
        try {
            const connection = await connect(hint, endpoint, onEvent);
            await connection.send('Runtime.enable');
            await connection.send('Log.enable');
            return connection;
        } catch { await delay(500); }
    }
    throw Error('Target unavailable');
};
const state = () => c.evaluate(`(function(){
    var available = false;
    try { available = typeof window.localStorage.getItem === 'function'; } catch(e) {}
    return {origin:location.origin,protocol:location.protocol,storageAvailable:available,
        coreReady:!!window.core,coreErrorVisible:!!document.querySelector('[class*="error-container"]'),
        packagedCookiesEmpty:location.protocol==='file:' ? document.cookie.length===0 : null,
        wasmResourcePresent:performance.getEntriesByType('resource').some(function(r){return /\\.wasm(?:$|\\?)/.test(r.name);})};
})()`);
try {
    c = await attach();
    report.before = await state();
    const origin = report.before.origin;
    if (mode === 'hosted' && !/^http:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(origin)) throw Error('Expected LAN origin');
    if (mode === 'packaged' && report.before.protocol !== 'file:') throw Error('Expected packaged origin');
    phase = 'write';
    written = true;
    report.immediate = await c.evaluate(`(function(){localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(token)});return localStorage.getItem(${JSON.stringify(key)})===${JSON.stringify(token)};})()`);
    if (!report.immediate) throw Error('Immediate read failed');
    // A JS global proves that relaunch created a new page, rather than a visibility change.
    await c.evaluate('window.__t35SamePage = true');
    phase = 'close';
    launch('--close');
    report.closed = true;
    c.close(); c = null;
    await delay(1000);
    phase = 'reopen';
    launch();
    c = await attach();
    report.reopened = await c.evaluate('window.__t35SamePage !== true');
    report.after = await state();
    if (report.after.origin !== origin) throw Error('Origin changed');
    phase = 'read';
    report.persisted = await c.evaluate(`localStorage.getItem(${JSON.stringify(key)})===${JSON.stringify(token)}`);
    phase = 'core';
    for (let i = 0; i < 45 && !report.after.coreReady && !(mode === 'packaged' && errors.wasm); i++) {
        await delay(1000);
        report.after = await state();
    }
    report.coreStatus = report.after.coreReady ? 'initialized' : 'not-initialized';
    report.packagedWasmLimitation = mode === 'packaged' && !report.after.coreReady && errors.wasm;
} catch {
    // Do not serialize CDP exceptions, console output, URLs, storage values or CLI output.
    report.failurePhase = phase;
} finally {
    if (written) {
        try {
            if (c) c.close();
            c = await attach();
            if ((await state()).origin === report.before.origin) {
                report.cleaned = await c.evaluate(`(function(){localStorage.removeItem(${JSON.stringify(key)});return localStorage.getItem(${JSON.stringify(key)})===null;})()`);
            }
        } catch { report.cleanupFailed = true; }
    }
    if (c) c.close();
    report.errors = errors;
    report.passed = !report.failurePhase && report.immediate && report.closed && report.reopened && report.persisted && report.cleaned &&
        (mode === 'packaged' || (report.after?.coreReady === true && !errors.storage));
    fs.writeFileSync(`tests/webos/t35-storage-${mode}.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode), 100);
}
