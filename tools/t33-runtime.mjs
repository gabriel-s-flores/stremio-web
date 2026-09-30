import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { connect } from './t33-cdp.mjs';
const mode = process.argv[2] || 'hosted';
const errors = [];
const resourceRole = value => {
    try {
        const url = new URL(value);
        if (['127.0.0.1', 'localhost'].includes(url.hostname)) return 'unavailable-local-service';
        if (url.hostname === '10.0.2.2' && url.port === '8093') return 'synthetic-media-server';
        return 'other-resource';
    } catch { return 'unknown'; }
};
const c = await connect(mode === 'hosted' ? 'http:' : 'com.stremio.webos.t33.fixture', process.argv[3], event => {
    if (event.method === 'Runtime.exceptionThrown') errors.push({ type: 'exception', text: event.params.exceptionDetails.exception?.description?.split('\n')[0] || event.params.exceptionDetails.text });
    if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') errors.push({ type: 'log', text: event.params.entry.text, resource: resourceRole(event.params.entry.url) });
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        const args = event.params.args;
        const text = args.map(arg => arg.value || arg.description || '').join(' ');
        const signatures = ['Player', 'Video:', 'Failed to initialize core:', 'Chromecast', 'Failed to fetch', 'Failed to load', 'NetworkError', 'ERR_CONNECTION_REFUSED', 'Luna', 'webOS', 'ServiceWorker', 'NotSupportedError', 'MediaSession', 'WebSocket', 'SecurityError'].filter(signature => text.includes(signature));
        errors.push({ type: 'console', text: '[arguments omitted; no user data captured]', signatures, argumentTypes: args.map(arg => arg.className || arg.type), locations: (event.params.stackTrace?.callFrames || []).slice(0, 3).map(frame => ({ functionName: frame.functionName, line: frame.lineNumber, column: frame.columnNumber })) });
    }
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
    await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
    const version = await c.send('Browser.getVersion');
    await c.send('Log.clear');
    await c.send('Runtime.discardConsoleEntries');
    errors.length = 0;
    if (mode === 'hosted') {
        await c.send('Page.navigate', { url: (process.argv[4] || 'http://10.0.2.2:8090') + '/?t33=' + Date.now() + '#/debug' });
        await delay(1000);
    } else await c.send('Page.reload', { ignoreCache: true });
    let ready = false;
    for (let i = 0; i < 40; i++) {
        ready = await c.evaluate(mode === 'hosted' ? '!!window.core && !!window.__stremioWebosDebug' : '!!window.__t33Run');
        if (ready) break;
        await delay(500);
    }
    if (!ready) throw Error('Runtime did not initialize');
    const before = await c.evaluate(`(function(){
        var metrics={}; Array.prototype.forEach.call(document.querySelectorAll('dt'),function(dt){metrics[dt.textContent]=dt.nextElementSibling.textContent});
        return { platformName:metrics['platform.name'] || null, bridge:typeof window.webOS.service.request === 'function',
        shellActive:!!(window.chrome && window.chrome.webview), userAgent:navigator.userAgent,
        scripts:Array.prototype.map.call(document.scripts,function(s){return s.getAttribute('src')}).filter(Boolean), capturedAt:new Date().toISOString() };
    })()`);
    const results = [];
    const device = await c.evaluate('new Promise(function(resolve){window.webOS.deviceInfo(function(info){resolve({modelName:info.modelName,sdkVersion:info.sdkVersion})})})');
    const guestMode = mode === 'hosted' ? await c.evaluate("window.core.getState('ctx').then(function(state){return state.profile ? !state.profile.auth : null})") : null;
    if (mode === 'hosted') {
        await c.evaluate(`window.__t33Observed=[]; (function(){var original=window.__stremioWebosDebug.recordPlayerImplementation; window.__stremioWebosDebug.recordPlayerImplementation=function(name){window.__t33Observed.push({manifest:name,at:new Date().toISOString(),bridge:typeof window.webOS.service.request === 'function'});return original.apply(this,arguments);};})()`);
        await c.evaluate(`window.core.encodeStream({name:'T3.3 synthetic test',url:'http://10.0.2.2:8093/t33-test.mp4'}).then(function(encoded){location.hash='#/player/'+encodeURIComponent(encoded);return true;})`);
        for (let i = 0; i < 30; i++) {
            if (await c.evaluate('window.__t33Observed.length > 0')) break;
            await delay(500);
        }
        await delay(2500);
        results.push(await c.evaluate(`({events:window.__t33Observed,player:window.__stremioWebosDebug.getSnapshot().player,realPlayerRoute:location.hash.indexOf('#/player/')===0,video:document.querySelector('video')?{readyState:document.querySelector('video').readyState,currentTime:document.querySelector('video').currentTime,error:document.querySelector('video').error && document.querySelector('video').error.code}:null})`));
    } else {
        for (const server of [false, true]) {
            await c.evaluate(`window.__t33Run(${server})`);
            await delay(3000);
        }
        results.push(...await c.evaluate('window.__t33Fixture.results'));
    }
    const cleanErrors = errors.map(e => ({ ...e, text: e.text.replace(/https?:\/\/[^\s)]+/g, '[URL redacted]') }));
    const report = { date: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirtyCheckout: true, packageVersion: '0.0.96', mode, version, device, guestMode, before, results, errors: cleanErrors };
    fs.writeFileSync(`tests/webos/t33-runtime-${mode}.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally { c.close(); setTimeout(() => process.exit(), 100); }
