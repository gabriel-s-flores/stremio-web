#!/usr/bin/env node
// Acceptance probe of the tlsproxy in the app (F3.7), over one CDP session (Chromium 53 takes one
// client at a time). Run by run.sh right after the app is launched:
//   node accept.mjs --port $EMU_CDP_PORT --out <dir>
// Steps (each one waits for its condition and writes a screenshot):
//   1. boot: Board with posters through the proxy (first launch: mode detection);
//   2. reload with the network log on from the start (mode already stored);
//   3. Discover and a detail page (poster, background and logo of images.metahub.space);
//   4. a Let's Encrypt addon (GitHub Pages) installed and its catalog listed by the core worker;
//   5. the service killed (its built-in Luna `quit`): the app starts it again without reloading,
//      for the images and for the worker;
//   6. latency of posters through the proxy.
// Network: every request of the page (Network domain), with ERR_INSECURE_RESPONSE counted.
// Output: <dir>/accept.json, <dir>/network.json, <dir>/*.png. Exit 1 if a step fails.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opts = { host: '127.0.0.1', port: Number(process.env.CDP_PORT || 9998), out: '.', target: 'io.github.gabrielsflores.stremio', timeout: 180 };
for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    opts[key] = key === 'port' || key === 'timeout' ? Number(argv[++i]) : argv[++i];
}
fs.mkdirSync(opts.out, { recursive: true });

const ADDON = 'https://victorgveloso.github.io/animes-season-addon/manifest.json';
const ADDON_HOST = 'victorgveloso.github.io';
const PROBE_URL = 'https://images.metahub.space/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.error('[accept]', ...args);

async function connect() {
    for (let attempt = 0; attempt < 120; attempt++) {
        try {
            const targets = await (await fetch(`http://${opts.host}:${opts.port}/json`)).json();
            const target = targets.find((t) => t.webSocketDebuggerUrl && (t.url || '').includes(opts.target));
            if (target) {
                const ws = new WebSocket(target.webSocketDebuggerUrl);
                await new Promise((resolve, reject) => {
                    ws.onopen = resolve;
                    ws.onerror = reject;
                });
                return ws;
            }
        } catch {
            // inspector not up yet
        }
        await sleep(500);
    }
    throw new Error('app target not found');
}

const ws = await connect();
let nextId = 1;
const pending = new Map();
const requests = new Map();
let phase = 'boot';
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
    }
    const p = msg.params || {};
    switch (msg.method) {
        case 'Network.requestWillBeSent':
            requests.set(p.requestId, { phase, url: p.request.url, method: p.request.method, type: p.type, start: p.timestamp });
            break;
        case 'Network.responseReceived': {
            const r = requests.get(p.requestId);
            if (r) Object.assign(r, { status: p.response.status, mimeType: p.response.mimeType });
            break;
        }
        case 'Network.loadingFinished': {
            const r = requests.get(p.requestId);
            if (r) Object.assign(r, { finished: true, ms: Math.round((p.timestamp - r.start) * 1000) });
            break;
        }
        case 'Network.loadingFailed': {
            const r = requests.get(p.requestId);
            if (r) Object.assign(r, { errorText: p.errorText, canceled: p.canceled, ms: Math.round((p.timestamp - r.start) * 1000) });
            break;
        }
        default:
            break;
    }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
});

// Expressions are ES5 for Chromium 53; promises are polled through a global (no awaitPromise).
async function evaluate(expression, timeoutMs = 60000) {
    const slot = `__accept_${nextId}`;
    const wrapped = `(function(){try{var v=(${expression});if(v&&typeof v.then==='function'){window['${slot}']={done:false};` +
        `v.then(function(r){window['${slot}']={done:true,ok:true,value:r};},function(e){window['${slot}']={done:true,ok:false,value:String(e&&e.stack||e)};});` +
        `return JSON.stringify({pending:true});}return JSON.stringify({value:v});}catch(e){return JSON.stringify({error:String(e&&e.stack||e)});}})()`;
    const first = JSON.parse((await send('Runtime.evaluate', { expression: wrapped, returnByValue: true })).result.value);
    if (first.error) throw new Error(first.error);
    if (!first.pending) return first.value;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const state = (await send('Runtime.evaluate', { expression: `JSON.stringify(window['${slot}'])`, returnByValue: true })).result.value;
        const parsed = state ? JSON.parse(state) : null;
        if (parsed && parsed.done) {
            if (!parsed.ok) throw new Error(parsed.value);
            return parsed.value;
        }
        await sleep(200);
    }
    throw new Error('timeout waiting for a promise');
}

async function waitFor(name, expression, timeoutS = opts.timeout) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutS * 1000) {
        try {
            last = await evaluate(expression);
            if (last && last.ok) return { ...last, waitedMs: Date.now() - t0 };
        } catch (error) {
            last = { error: error.message };
        }
        await sleep(500);
    }
    return { ...(last || {}), ok: false, timeout: true, name };
}

async function screenshot(name) {
    try {
        const { data } = await send('Page.captureScreenshot', {});
        fs.writeFileSync(path.join(opts.out, name), Buffer.from(data, 'base64'));
    } catch (error) {
        log(`screenshot ${name}: ${error.message}`);
    }
}

// Images in the page: total, through the proxy (and loaded), and https ones of metahub loaded
// directly (should be none in proxy mode).
const IMAGES = `(function(){
  var imgs=[].slice.call(document.images), proxied=0, loaded=0, direct=0, token=null;
  imgs.forEach(function(i){
    if (i.src.indexOf('http://127.0.0.1:')===0){ proxied++; if(i.complete&&i.naturalWidth>0){ loaded++; token=(/[?&]t=([0-9a-f]+)/.exec(i.src)||[])[1]; } }
    else if (i.src.indexOf('https://images.metahub.space/')===0) direct++;
  });
  return { total: imgs.length, proxied: proxied, loaded: loaded, directMetahub: direct, token: token, hash: location.hash };
})()`;
const imagesAtLeast = (n, extra = 'true') => `(function(){var s=${IMAGES};s.ok=s.loaded>=${n}&&(${extra});s.status=window.__webosTlsProxy&&window.__webosTlsProxy.status();return s;})()`;
const STATUS = 'window.__webosTlsProxy.status()';
const go = (hash) => evaluate(`(function(){location.hash=${JSON.stringify(hash)};return location.hash;})()`);

const result = { startedAt: new Date().toISOString(), steps: {} };
const step = (name, value) => {
    result.steps[name] = value;
    log(name, JSON.stringify(value).slice(0, 300));
    return value;
};

await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');

// 1. First launch.
step('boot', await waitFor('boot', imagesAtLeast(12, "location.hash==='' || location.hash==='#/'")));
await screenshot('1-board-first-launch.png');

// 2. Reload with the network log from the start; the mode comes from localStorage now.
phase = 'reload';
await send('Page.reload', { ignoreCache: false });
await sleep(1000);
const reload = step('reload', await waitFor('reload', imagesAtLeast(12)));
reload.boardMs = await evaluate('performance.now()');
await screenshot('2-board.png');

// 3. Discover and a detail page.
phase = 'discover';
await go('#/discover');
step('discover', await waitFor('discover', imagesAtLeast(12, "location.hash.indexOf('#/discover')===0")));
await sleep(1500);
await screenshot('3-discover.png');

phase = 'detail';
await go('#/detail/movie/tt0111161');
step('detail', await waitFor('detail', `(function(){var s=${IMAGES};var bg=[].slice.call(document.images).filter(function(i){return /background%2F|logo%2F/.test(i.src)&&i.complete&&i.naturalWidth>0;}).length;s.backgroundOrLogo=bg;s.ok=bg>0;return s;})()`));
await sleep(1500);
await screenshot('4-detail.png');

// 4. A Let's Encrypt addon: manifest and catalog fetched by the core worker.
phase = 'addon';
await go(`#/addons?addon=${encodeURIComponent(ADDON)}`);
const modal = step('addon-modal', await waitFor('addon-modal', `(function(){var b=document.querySelector('[class*="install-button"]');return {ok:!!b, text:b&&b.textContent};})()`, 90));
await screenshot('5-addon-details.png');
if (modal.ok) await evaluate(`(function(){document.querySelector('[class*="install-button"]').click();return true;})()`);
step('addon-installed', await waitFor('addon-installed', `window.core.getState('ctx').then(function(ctx){var a=(ctx.profile.addons||[]).filter(function(x){return x.transportUrl===${JSON.stringify(ADDON)};});return {ok:a.length===1, name:a[0]&&a[0].manifest.name, learned:window.__webosTlsProxy.status().learned};})`, 60));
await go(`#/discover/${encodeURIComponent(ADDON)}/series/latest_anime_seasons`);
step('addon-catalog', await waitFor('addon-catalog', `(function(){var n=document.querySelectorAll('[class*="meta-item-container"]').length;return {ok:n>0, items:n, hash:location.hash, learned:window.__webosTlsProxy.status().learned};})()`, 120));
await sleep(3000);
await screenshot('6-addon-catalog.png');
step('addon-learned', { ok: (await evaluate(STATUS)).learned.indexOf(ADDON_HOST) !== -1, status: await evaluate(STATUS) });

// 5. The service dies; the page notices through a failing image (or the worker through a
// failing fetch), starts it again and the images re-render with the new port/token.
phase = 'recovery';
const before = await evaluate(STATUS);
const oldToken = (await evaluate(IMAGES)).token;
step('quit', await evaluate(`new Promise(function(resolve){webOS.service.request('luna://io.github.gabrielsflores.stremio.tlsproxy',{method:'quit',parameters:{},onSuccess:function(r){resolve(r);},onFailure:function(e){resolve(e);}});})`));
await sleep(1500);
await go('#/detail/series/tt0903747');
const recovered = step('recovery-images', await waitFor('recovery-images', `(function(){var s=${IMAGES};var st=window.__webosTlsProxy.status();s.status=st;s.ok=st.ready&&st.starts>${before.starts}&&s.loaded>0&&s.token!==${JSON.stringify(oldToken)};return s;})()`, 60));
await sleep(1500);
await screenshot('7-recovery-detail.png');
step('recovery-worker', await (async () => {
    await go(`#/discover/${encodeURIComponent(ADDON)}/movie/latest_anime_seasons`);
    return waitFor('recovery-worker', `(function(){var n=document.querySelectorAll('[class*="meta-item-container"]').length;return {ok:n>0, items:n, hash:location.hash};})()`, 90);
})());
await screenshot('8-recovery-addon-catalog.png');
result.recovery = { before, after: recovered.status, oldToken };

// 6. Latency: 10 posters in sequence and 12 in parallel through the proxy (cache busted).
phase = 'latency';
await go('#/');
await sleep(2000);
result.latency = await evaluate(`(function(){
  var p=window.__webosTlsProxy, ids=['tt0111161','tt0068646','tt0468569','tt0071562','tt0050083','tt0108052','tt0167260','tt0110912','tt0060196','tt0120737','tt0109830','tt0137523'];
  var bust=Date.now();
  return p.config().then(function(c){
    function px(id,i){return 'http://127.0.0.1:'+c.port+'/proxy?t='+c.token+'&url='+encodeURIComponent('https://images.metahub.space/poster/small/'+id+'/img?b='+bust+'-'+i);}
    function one(id,i){var t0=performance.now();return fetch(px(id,i)).then(function(r){return r.arrayBuffer().then(function(b){return {ms:Math.round(performance.now()-t0),status:r.status,bytes:b.byteLength,upstreamMs:Number(r.headers.get('X-Proxy-Upstream-Ms'))};});});}
    var seq=[], chain=Promise.resolve();
    ids.slice(0,10).forEach(function(id,i){chain=chain.then(function(){return one(id,i).then(function(x){seq.push(x);});});});
    return chain.then(function(){var t0=performance.now();return Promise.all(ids.map(function(id,i){return one(id,100+i);})).then(function(par){return {sequential:seq,parallel:par,parallelTotalMs:Math.round(performance.now()-t0)};});});
  });
})()`, 120000);
const ms = result.latency.sequential.map((x) => x.ms).sort((a, b) => a - b);
result.latency.sequentialMedianMs = ms[Math.floor(ms.length / 2)];
result.latency.sequentialP90Ms = ms[Math.floor(ms.length * 0.9)];
const resources = await evaluate(`performance.getEntriesByType('resource').filter(function(e){return e.name.indexOf('http://127.0.0.1:')===0&&e.initiatorType==='img';}).map(function(e){return Math.round(e.duration);})`);
resources.sort((a, b) => a - b);
result.latency.boardImages = { count: resources.length, medianMs: resources[Math.floor(resources.length / 2)], p90Ms: resources[Math.floor(resources.length * 0.9)] };
result.serviceLuna = await evaluate(`new Promise(function(resolve){webOS.service.request('luna://io.github.gabrielsflores.stremio.tlsproxy',{method:'status',parameters:{},onSuccess:resolve,onFailure:resolve});})`);
result.final = await evaluate(STATUS);

// Network summary: certificate errors outside the mode detection request.
const all = [...requests.values()];
const insecure = all.filter((r) => /ERR_INSECURE_RESPONSE|CERT/i.test(r.errorText || ''));
const detection = insecure.filter((r) => r.url === PROBE_URL);
result.network = {
    requests: all.length,
    byPhase: all.reduce((acc, r) => ({ ...acc, [r.phase]: (acc[r.phase] || 0) + 1 }), {}),
    proxied: all.filter((r) => r.url.indexOf('http://127.0.0.1:') === 0).length,
    proxiedFailed: all.filter((r) => r.url.indexOf('http://127.0.0.1:') === 0 && r.errorText && !r.canceled).map((r) => ({ phase: r.phase, url: r.url.replace(/t=[0-9a-f]+/, 't=…').slice(0, 160), errorText: r.errorText })),
    insecure: insecure.map((r) => ({ phase: r.phase, method: r.method, url: r.url.slice(0, 160) })),
    insecureOutsideDetection: insecure.length - detection.length,
    failedOther: all.filter((r) => r.errorText && !r.canceled && !/ERR_INSECURE_RESPONSE/.test(r.errorText) && r.url.indexOf('http://127.0.0.1:') !== 0).map((r) => ({ phase: r.phase, url: r.url.slice(0, 160), errorText: r.errorText })),
};
fs.writeFileSync(path.join(opts.out, 'network.json'), JSON.stringify(all.map((r) => ({ ...r, url: r.url.replace(/t=[0-9a-f]+/, 't=…') })), null, 1));

const checks = {
    'Board com pôsteres do metahub pelo proxy (1º lançamento)': result.steps.boot.ok,
    'Board com pôsteres pelo proxy após reload': result.steps.reload.ok,
    'Discover com pôsteres pelo proxy': result.steps.discover.ok,
    'Detalhe com fundo/logo do metahub pelo proxy': result.steps.detail.ok,
    'Addon Let\'s Encrypt instalado pelo worker': result.steps['addon-installed'].ok,
    'Catálogo do addon Let\'s Encrypt listado': result.steps['addon-catalog'].ok,
    'Host do addon aprendido (emissor Let\'s Encrypt)': result.steps['addon-learned'].ok,
    'Serviço morto: imagens voltam sem recarregar': result.steps['recovery-images'].ok,
    'Serviço morto: worker volta sem recarregar': result.steps['recovery-worker'].ok,
    'Nenhum ERR_INSECURE_RESPONSE fora da detecção': result.network.insecureOutsideDetection === 0,
};
result.checks = checks;
result.ok = Object.values(checks).every(Boolean);
fs.writeFileSync(path.join(opts.out, 'accept.json'), JSON.stringify(result, null, 2));
Object.entries(checks).forEach(([name, ok]) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`));
console.log(JSON.stringify({ latency: { sequentialMedianMs: result.latency.sequentialMedianMs, sequentialP90Ms: result.latency.sequentialP90Ms, parallelTotalMs: result.latency.parallelTotalMs, boardImages: result.latency.boardImages }, network: { requests: result.network.requests, proxied: result.network.proxied, insecure: result.network.insecure.length, insecureOutsideDetection: result.network.insecureOutsideDetection } }));
ws.close();
process.exit(result.ok ? 0 : 1);
