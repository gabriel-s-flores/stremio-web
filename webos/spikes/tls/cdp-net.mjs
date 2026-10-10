#!/usr/bin/env node
// Grava o log de rede (DevTools Protocol, domínio Network) do app de teste da F0.7: recarrega a
// página com a captura ligada e espera window.__tls.complete. Saída: JSON com uma entrada por
// requisição (url, status, mimeType, errorText, tempo) e o window.__tls final.
// Com --go não recarrega: só libera o app aberto em modo hold (window.__tlsGo()).
//
//   node cdp-net.mjs --port $EMU_CDP_PORT --target io.github.gabrielsflores.webostls --out net.json [--go]
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opts = { host: '127.0.0.1', port: Number(process.env.CDP_PORT || 9998), target: 'webostls', out: 'net.json', timeout: 180, go: false };
for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'go') opts.go = true;
    else opts[k] = k === 'port' || k === 'timeout' ? Number(argv[++i]) : argv[++i];
}

const targets = await (await fetch(`http://${opts.host}:${opts.port}/json`)).json();
const target = targets.find((t) => t.webSocketDebuggerUrl && ((t.url || '').includes(opts.target) || (t.title || '').includes(opts.target)));
if (!target) throw new Error(`alvo ${opts.target} não encontrado: ${JSON.stringify(targets.map((t) => t.url))}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const pending = new Map();
const requests = new Map();
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
        return;
    }
    const p = msg.params || {};
    switch (msg.method) {
        case 'Network.requestWillBeSent':
            requests.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type, start: p.timestamp, redirectedFrom: p.redirectResponse ? p.redirectResponse.status : undefined });
            break;
        case 'Network.responseReceived': {
            const r = requests.get(p.requestId) || {};
            Object.assign(r, { status: p.response.status, mimeType: p.response.mimeType, protocol: p.response.protocol, remote: p.response.remoteIPAddress, securityState: p.response.securityState });
            requests.set(p.requestId, r);
            break;
        }
        case 'Network.loadingFinished': {
            const r = requests.get(p.requestId) || {};
            Object.assign(r, { finished: true, encodedDataLength: p.encodedDataLength, ms: r.start ? Math.round((p.timestamp - r.start) * 1000) : undefined });
            break;
        }
        case 'Network.loadingFailed': {
            const r = requests.get(p.requestId) || {};
            Object.assign(r, { failed: true, errorText: p.errorText, canceled: p.canceled, ms: r.start ? Math.round((p.timestamp - r.start) * 1000) : undefined });
            break;
        }
        default:
    }
};
const send = (method, params = {}) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
});

await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.enable');
if (!opts.go) await send('Page.reload', { ignoreCache: true });
const deadline = Date.now() + opts.timeout * 1000;
let tls = null;
if (!opts.go) await new Promise((r) => setTimeout(r, 2000));
while (Date.now() < deadline) {
    // O reload mantém os parâmetros de lançamento, então o app pode voltar ao modo hold: libera.
    const res = await send('Runtime.evaluate', {
        expression: '(function(){if(window.__tlsGo&&!window.__tlsGoCalled){window.__tlsGoCalled=true;window.__tlsGo();}return JSON.stringify(window.__tls||null);})()',
        returnByValue: true,
    });
    tls = JSON.parse(res.result.result.value || 'null');
    if (tls && tls.complete) break;
    await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 500));
ws.close();

const list = [...requests.values()].map(({ start, ...r }) => r);
fs.writeFileSync(opts.out, JSON.stringify({ target: target.url, capturedAt: new Date().toISOString(), requests: list, tls }, null, 2));
const short = (u) => u.replace(/([?&]t=)[0-9a-f]+/, '$1…').slice(0, 150);
for (const r of list) console.log(`${r.failed ? 'FAIL ' + r.errorText : r.status} ${r.ms ?? '?'}ms ${r.method} ${short(r.url)}`);
console.log(tls && tls.complete ? 'complete' : 'INCOMPLETO');
