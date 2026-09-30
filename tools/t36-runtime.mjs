import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { connect } from './t33-cdp.mjs';
const [mode, appId, hint, endpoint, device] = process.argv.slice(2);
if (!['packaged', 'http'].includes(mode) || !device) throw Error('Usage: node tools/t36-runtime.mjs packaged|http appId targetHint CDP_URL device');
const launch = (...args) => execFileSync(process.execPath, [path.join(process.env.APPDATA, 'npm/node_modules/@webos-tools/cli/bin/ares-launch.js'), '-d', device, ...args, appId], { timeout: 30000 });
const report = { mode, device, passed: false, registrationError: false, wasmError: false, samples: [] };
const delay = ms => new Promise(r => setTimeout(r, ms));
const onEvent = e => {
    if (!['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(e.method)) return;
    const text = JSON.stringify(e.params);
    if (/SW registration failed/.test(text)) report.registrationError = true;
    if (/wasm|WebAssembly|Failed to initialize core/i.test(text)) report.wasmError = true;
};
let c;
try {
    for (let cycle = 0; cycle < 2; cycle++) {
        if (cycle) { launch('--close'); c.close(); c = null; launch(); }
        for (let n = 0; n < 20; n++) {
            try { c = await connect(hint, endpoint, onEvent); break; } catch { await delay(500); }
        }
        if (!c) throw Error('Target unavailable');
        report.phase = 'enable'; await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
        report.phase = 'instrument'; await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__t36RegisterCalls=0; if(navigator.serviceWorker){var original=navigator.serviceWorker.register;navigator.serviceWorker.register=function(){window.__t36RegisterCalls++;return original.apply(this,arguments);};}` });
        report.phase = 'reload'; await c.send('Page.reload', { ignoreCache: true });
        let sample;
        for (let n = 0; n < 40; n++) {
            await delay(500);
            report.phase = 'sample'; sample = (await c.send('Runtime.evaluate', { returnByValue: true, expression: `({protocol:location.protocol,secure:window.isSecureContext,registerCalls:window.__t36RegisterCalls,banner:!!document.querySelector('[class*="web-update-banner"],[class*="web-update-screen"]'),coreReady:!!window.core,loaded:document.readyState==='complete',chromium68:/Chrome\\/68\\./.test(navigator.userAgent)})` })).result.value;
            if (sample.loaded && n >= 10) break;
        }
        report.samples.push(sample);
    }
    report.passed = !report.registrationError && report.samples.length === 2 && report.samples.every(s => s.loaded && s.chromium68 && s.registerCalls === 0 && !s.banner && s.protocol === (mode === 'packaged' ? 'file:' : 'http:'));
} catch (error) { report.infrastructureError = true; report.failureKind = /timeout/.test(error.message) ? 'cdp-timeout' : /Target unavailable/.test(error.message) ? 'target-unavailable' : 'probe-error'; }
finally { c?.close(); fs.writeFileSync(`tests/webos/t36-runtime-${mode}.json`, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report));
process.exitCode = report.passed ? 0 : 1;
