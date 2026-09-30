import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { connect } from './t33-cdp.mjs';
import { startSink } from './t37-sentry-sink.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
    console.log('node tools/t37-observability.mjs --target EXACT_URL_OR_ID --cdp ENDPOINT --origin URL --mode hosted|packaged --dsn on|off --sink-port PORT --release RELEASE --dist COMMIT --output FILE [--device DEVICE --app-id ID] [--reject]\nUse an isolated t37 fixture/app and a local origin. Packaged requires device/app-id and verifies close/relaunch. No raw events or network URLs are recorded.');
    process.exit(0);
}
const get = key => args[args.indexOf('--' + key) + 1];
for (const key of ['target', 'cdp', 'origin', 'mode', 'dsn', 'sink-port', 'release', 'dist', 'output']) if (!args.includes('--' + key)) throw Error('Missing ' + key);
const mode = get('mode'), configured = get('dsn') === 'on', origin = get('origin');
if (!['hosted', 'packaged'].includes(mode) || !['on', 'off'].includes(get('dsn'))) throw Error('Invalid mode/DSN switch');
const url = new URL(origin);
if (mode === 'hosted' && !/^http:\/\/(?:127\.0\.0\.1|10\.0\.2\.2):\d+/.test(origin)) throw Error('Local fixture origin required');
if (mode === 'packaged' && (url.protocol !== 'file:' || !args.includes('--device') || !args.includes('--app-id'))) throw Error('Packaged requires file URL, device and app-id');
const report = { mode, configured, status: 'incomplete', passed: false, wasmBlocked: false, samples: [] };
const sink = await startSink({ port: Number(get('sink-port')), host: '0.0.0.0', origin: mode === 'packaged' ? 'null' : url.origin, release: get('release'), dist: get('dist'), mode, reject: args.includes('--reject') });
let c, targetUrl;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let sinkCalls = 0;
const onEvent = event => {
    if (event.method === 'Network.requestIntercepted') {
        const requestUrl = new URL(event.params.request.url);
        const local = ['file:', 'data:', 'blob:'].includes(requestUrl.protocol)
            || (requestUrl.protocol === 'http:' && ['10.0.2.2', '127.0.0.1'].includes(requestUrl.hostname)
                && (requestUrl.origin === url.origin || requestUrl.port === get('sink-port')));
        c.send('Network.continueInterceptedRequest', { interceptionId: event.params.interceptionId, ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {});
    }
    if (event.method === 'Network.requestWillBeSent' && event.params.request.url.includes('/api/37/envelope/')) sinkCalls++;
    if (event.method === 'Runtime.exceptionThrown' && /wasm|WebAssembly/i.test(JSON.stringify(event.params))) report.wasmBlocked = true;
    if (['Runtime.consoleAPICalled', 'Log.entryAdded'].includes(event.method)) {
        const diagnostic = JSON.stringify(event.params);
        if (/wasm|WebAssembly/i.test(diagnostic) && /error|fail|not allowed|denied/i.test(diagnostic)) report.wasmBlocked = true;
    }
};
try {
    for (let cycle = 0; cycle < (mode === 'packaged' ? 2 : 1); cycle++) {
        if (cycle) {
            report.phase = 'close-relaunch';
            c.close(); c = null;
            const launch = extra => execFileSync(process.execPath, [path.join(process.env.APPDATA, 'npm/node_modules/@webos-tools/cli/bin/ares-launch.js'), '-d', get('device'), ...extra, get('app-id')], { timeout: 30000, stdio: 'pipe' });
            launch(['--close']); launch([]);
        }
        report.phase = 'connect';
        for (let retry = 0; retry < 20; retry++) {
            let targets;
            try { targets = await (await fetch(get('cdp') + '/json', { signal: AbortSignal.timeout(5000) })).json(); }
            catch { await delay(250); continue; }
            const matches = targets.filter(t => t.type === 'page' && (cycle ? t.url === targetUrl : t.id === get('target') || t.url === get('target')));
            if (matches.length === 1) { targetUrl = matches[0].url; c = await connect(targetUrl, get('cdp'), onEvent); break; }
            await delay(250);
        }
        if (!c) throw Error('Target unavailable');
        report.phase = 'instrument';
        await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Network.enable'); await c.send('Log.enable');
        // Block non-local service calls before navigation, including any app data APIs.
        await c.send('Network.setRequestInterception', { patterns: [{ urlPattern: '*' }] });
        if (cycle === 0) {
            await c.send('Page.navigate', { url: origin });
            await c.send('Page.reload', { ignoreCache: true });
        }
        let sample;
        report.phase = 'boot';
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
            sample = await c.evaluate(`({chromium68:/Chrome\\/68\\./.test(navigator.userAgent),protocol:location.protocol,atOrigin:location.href===${JSON.stringify(origin)},mounted:!!(document.getElementById('app')&&document.getElementById('app').children.length),reactRootCreated:!!document.getElementById('app')&&Object.keys(document.getElementById('app')).some(function(k){return k.indexOf('__reactContainer$')===0}),coreReady:!!window.core,fixture:!!window.__t37Fixture,observability:window.__t37Fixture?window.__t37Fixture.snapshot():null})`);
            if (sample.fixture && sample.mounted) break;
            await delay(200);
        }
        const route = await c.evaluate('location.hash');
        if (sample.fixture) {
            report.phase = 'capture-flush';
            report.flushed = await c.evaluate('window.__t37Fixture.emit()');
            sample.observability = await c.evaluate('window.__t37Fixture.snapshot()');
            sample.routePreserved = await c.evaluate('location.hash') === route;
        }
        report.samples.push(sample);
    }
    report.sinkCalls = sinkCalls;
    report.sink = sink.summary;
    report.reactMountPassed = report.samples.every(s => s.mounted);
    report.coreReady = report.samples.every(s => s.coreReady);
    report.entryReachedReact = report.samples.every(s => s.reactRootCreated && s.fixture);
    // Packaged core/WASM readiness is a separate result, never called a full mount.
    const boot = report.samples.every(s => s.chromium68 && s.atOrigin && s.reactRootCreated && (mode === 'packaged' || s.mounted) && s.fixture && s.routePreserved);
    const state = report.samples[report.samples.length - 1].observability;
    if (state?.initState === 'sdk-runtime-failed') report.status = 'sdk-runtime-failed';
    else if (!configured) {
        report.status = 'not-configured';
        report.passed = boot && sinkCalls === 0 && sink.summary.requests === 0 && report.samples.every(s => !s.observability.sentryEnabled && s.observability.initState === 'not-configured' && !s.observability.failureKind);
    } else if (state?.transportState === 'transport-blocked') {
        report.status = 'transport-blocked';
        report.passed = boot && args.includes('--reject') && state.failureKind === 'transport';
    } else {
        report.passed = boot && state?.sentryEnabled && state.transportState === 'accepted' && sink.summary.events >= report.samples.length && sink.summary.privacyPassed && sink.summary.identityPassed && (mode !== 'packaged' || sink.summary.nullOrigin);
        report.status = report.passed ? 'passed' : 'incomplete';
    }
} catch (error) { report.infrastructureError = true; report.failureKind = /timeout|ETIMEDOUT/i.test(error.message) ? 'timeout' : /Target unavailable/.test(error.message) ? 'target-unavailable' : 'probe-error'; }
finally {
    if (c) { await c.send('Network.setRequestInterception', { patterns: [] }).catch(() => {}); c.close(); }
    await sink.close(); fs.writeFileSync(get('output'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ status: report.status, passed: report.passed, infrastructureError: report.infrastructureError }));
process.exitCode = report.passed ? 0 : 1;
