#!/usr/bin/env node
// Boot cost probe (F3.6): one cold launch, measured the way the F1.6 probe did, so a build with and
// without the diagnostics code can be compared. Connects as soon as the page shows up, installs
// hooks, waits for the Board and prints one JSON line:
//   coreReadyAt  window.core assigned (the F1.4 definition), ms on the page's performance.now()
//   firstRowAt   first frame (rAF) with a Board catalog item that has a box inside the screen
//   screenFullAt two Board rows with items on screen
//   scripts      the .js files the page had loaded by then, from Page.getResourceTree (the diagnostics
//                chunk must not be there)
//
//   node boot-probe.mjs --port <cdp> [--timeout s]
const argv = process.argv.slice(2);
const opts = { port: Number(process.env.CDP_PORT || 9998), timeout: 150, target: 'io.github.gabrielsflores.stremio' };
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') opts.port = Number(argv[++i]);
    else if (argv[i] === '--timeout') opts.timeout = Number(argv[++i]);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HOOKS = `(function(){
  if (window.__f36) return 'installed';
  var f = window.__f36 = { hookedAt: performance.now(), coreReadyAt: null, firstRowAt: null, screenFullAt: null };
  var current = window.core;
  if (current) f.coreReadyAt = 'before-hooks';
  Object.defineProperty(window, 'core', { configurable: true, get: function(){ return current; },
    set: function(v){ current = v; if (f.coreReadyAt === null) f.coreReadyAt = performance.now(); } });
  function visibleItems(row){
    var items = row.querySelectorAll('[class*="meta-item-container"]'), n = 0;
    for (var i = 0; i < items.length; i++) { var r = items[i].getBoundingClientRect(); if (r.height > 0 && r.width > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth) n++; }
    return n;
  }
  function check(){
    var t = performance.now();
    if (document.documentElement.getBoundingClientRect().height > 0) {
      var rows = document.querySelectorAll('[class*="board-row"]'), withItems = 0;
      for (var i = 0; i < rows.length; i++) if (visibleItems(rows[i])) withItems++;
      if (f.firstRowAt === null && withItems > 0) f.firstRowAt = t;
      if (f.screenFullAt === null && withItems >= 2) f.screenFullAt = t;
    }
    if (f.screenFullAt === null && t < 240000) requestAnimationFrame(check);
  }
  requestAnimationFrame(check);
  return 'ok';
})()`;

const STATE = `JSON.stringify({ hooks: window.__f36 || null,
  heap: performance.memory ? { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10, totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576 * 10) / 10 } : null,
  now: performance.now() })`;

async function connect() {
    const deadline = Date.now() + 60000;
    let target = null;
    while (Date.now() < deadline && !target) {
        try {
            const targets = await (await fetch(`http://127.0.0.1:${opts.port}/json`)).json();
            target = targets.find((t) => (t.url || '').includes(opts.target) && t.webSocketDebuggerUrl);
        } catch (e) { /* inspector not up yet */ }
        if (!target) await sleep(100);
    }
    if (!target) throw new Error('the app page never showed up');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        }
    });
    const evaluate = (expression) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: (r) => resolve(r.result && r.result.value), reject });
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    const send = (method) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method }));
    });
    return { evaluate, send, close: () => ws.close() };
}

const session = await connect();
const deadline = Date.now() + opts.timeout * 1000;
let state = null;
while (Date.now() < deadline) {
    try {
        await session.evaluate(HOOKS);
        state = JSON.parse(await session.evaluate(STATE));
        if (state.hooks && state.hooks.screenFullAt !== null) break;
    } catch (e) { /* the document is being replaced */ }
    await sleep(500);
}
let scripts = null;
try {
    const tree = await session.send('Page.getResourceTree');
    scripts = (tree.frameTree.resources || []).filter((r) => /\.js(\?|$)/.test(r.url)).map((r) => r.url.split('/').pop());
} catch (e) { /* not available */ }
session.close();
const round = (value) => (typeof value === 'number' ? Math.round(value) : value);
const hooks = (state && state.hooks) || {};
console.log(JSON.stringify({
    coreReadyAt: round(hooks.coreReadyAt),
    firstRowAt: round(hooks.firstRowAt),
    screenFullAt: round(hooks.screenFullAt),
    heap: state && state.heap,
    scripts,
    ok: !!(state && hooks.screenFullAt !== null),
}));
