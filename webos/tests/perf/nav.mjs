#!/usr/bin/env node
// Navigation times and memory per screen, one boot (F7.1). Packaged app on the emulator, a remote
// key (webos/tools/remote.mjs) or a click from the page for each step; every step is timed on the page's
// own clock from the input event to the first frame where the screen is ready (lib.mjs PAGE_TIMER), so
// the CDP latency never enters the number. No media (the player has its own scenario: play.mjs).
//
//   webos/tools/emu-run --profile c8 --timeout 40 -- node webos/tests/perf/nav.mjs --ipk <ipk> --out <dir> [--quiet 30] [--variant wasm|wasm2js]
//
// Steps: Board -> Details (OK on the focused item), Back, Discover (click on the side bar link: the bar
// is not reachable with the arrows yet), Back, Search (click on the search bar) and a search for
// "matrix" (Enter; the catalog comes from the network, Cinemeta), then a tour of Library, Calendar,
// Addons, Settings, and Details again. Writes <dir>/nav.json and <dir>/phases.jsonl (mem-analyze.mjs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, PAGE_MEMORY, layerStats, PAGE_TIMER, REPO, connect, parseArgs, phaseWriter, remoteKey, sleep, statusSnapshot, waitResult } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const IPK = path.resolve(args.ipk || '');
const OUT = path.resolve(args.out || 'perf-nav');
const QUIET_S = Number(args.quiet || 30);
const VARIANT = args.variant || 'default';
const { EMU_DEVICE: DEVICE, EMU_CDP_PORT: CDP_PORT } = process.env;
if (!DEVICE || !CDP_PORT) {
    console.error('run inside webos/tools/emu-run');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const phase = phaseWriter(path.join(OUT, 'phases.jsonl'));
const context = (ref) => JSON.parse(execFileSync(path.join(REPO, 'webos/tests/perf/context.sh'), ref ? [] : ['--no-ref'], { encoding: 'utf8' }));
const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a);

// Screen conditions: function sources evaluated each frame in the page (cheap queries only).
const ROUTE = `document.querySelector('.routes-container > .route-container:last-child')`;
const itemsIn = (selector, min = 1) => `function () {
    var route = ${ROUTE}; if (!route) return false;
    var scope = route.querySelector('${selector}'); if (!scope) return false;
    var items = scope.querySelectorAll('[class*="meta-item-container"]'), n = 0;
    for (var i = 0; i < items.length && n < ${min}; i++) { var r = items[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) n++; }
    return n >= ${min};
}`;
const COND = {
    board: `function () { var h = location.hash; if (h !== '' && h !== '#/') return false; var route = ${ROUTE}; return !!route && !!route.querySelector('[class*="board-content"] [class*="meta-item-container"]'); }`,
    detailsShell: `function () { var route = ${ROUTE}; return /^#\\/detail\\//.test(location.hash) && !!route && !!route.querySelector('[class*="metadetails-container"] [class*="metadetails-content"]'); }`,
    detailsPreview: `function () { var route = ${ROUTE}; return /^#\\/detail\\//.test(location.hash) && !!route && !!route.querySelector('[class*="meta-preview-container"] [class*="logo"], [class*="meta-preview-container"] [class*="title"], [class*="meta-preview-container"] [class*="name"]'); }`,
    discoverShell: `function () { var route = ${ROUTE}; return /^#\\/discover/.test(location.hash) && !!route && !!route.querySelector('[class*="discover-container"]'); }`,
    discoverItems: itemsIn('[class*="meta-items-container"]', 6),
    searchShell: `function () { var route = ${ROUTE}; return /^#\\/search/.test(location.hash) && !!route && !!route.querySelector('[class*="search-container"]'); }`,
    searchResults: itemsIn('[class*="search-content"]', 3),
    library: `function () { var route = ${ROUTE}; return /^#\\/library/.test(location.hash) && !!route && !!route.querySelector('[class*="library-container"]'); }`,
    calendar: `function () { var route = ${ROUTE}; return /^#\\/calendar/.test(location.hash) && !!route && !!route.querySelector('[class^="calendar-"]'); }`,
    addons: `function () { var route = ${ROUTE}; return /^#\\/addons/.test(location.hash) && !!route && !!route.querySelector('[class*="addons-container"]'); }`,
    settings: `function () { var route = ${ROUTE}; return /^#\\/settings/.test(location.hash) && !!route && !!route.querySelector('[class*="settings-container"]'); }`,
};

// Page-side helpers: link clicks from the page (timed from the click), typing in the search field, and
// the quiet detector (last DOM mutation, to tell "first ready" from "settled").
const HELPERS = `(function () {
    var f = window.__f71; if (f.nav) return 'ok';
    f.lastMutation = performance.now();
    new MutationObserver(function () { f.lastMutation = performance.now(); }).observe(document.body, { childList: true, subtree: true, attributes: true });
    f.nav = true;
    f.click = function (href) { var a = document.querySelector('a[href="' + href + '"]'); if (!a) return false; f.start(); a.click(); return true; };
    f.type = function (text) {
        var input = document.querySelector('input[type="text"]'); if (!input) return false;
        input.focus();
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    };
    f.enter = function () {
        var input = document.querySelector('input[type="text"]'); if (!input) return false;
        ['keydown', 'keyup'].forEach(function (type) {
            var e = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true });
            Object.defineProperty(e, 'keyCode', { get: function () { return 13; } });
            Object.defineProperty(e, 'which', { get: function () { return 13; } });
            input.dispatchEvent(e);
        });
        return true;
    };
    f.heap = function () { return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10 : null; };
    f.nodes = function () { return document.getElementsByTagName('*').length; };
    return 'ok';
})()`;

const steps = [];
const snapshots = [];
// If the run dies half way (the renderer killed by the OOM, a CDP timeout), what was measured so far is kept.
let finished = false;
process.on('exit', (code) => {
    if (finished) return;
    fs.writeFileSync(path.join(OUT, 'nav.json'), `${JSON.stringify({ ipk: path.basename(IPK), profile: process.env.EMU_PROFILE || null, instance: process.env.EMU_INSTANCE, variant: VARIANT, incomplete: true, exitCode: code, steps, snapshots }, null, 2)}\n`);
});
let session;
// Where the memory is at a phase: the renderer's RSS by kind (anon, file, shmem; /proc/pid/status) and what the page reports.
async function snap(label) {
    const page = JSON.parse(await session.evaluate(PAGE_MEMORY, 30000).catch(() => 'null'));
    const core = await session.evaluate('window.core.getCoreLoaderStatus().then(function(s){ return s && s.memoryBytes; })', 20000).catch(() => null);
    const proc = statusSnapshot();
    snapshots.push({ label, at: Date.now(), page, layers: await layerStats(session), coreMemoryMB: core ? Math.round(core / 104857.6) / 10 : null, proc });
    log('snapshot', label, proc.error || `${proc.rssMB} MB (anon ${proc.anonMB}, file ${proc.fileMB}, shmem ${proc.shmemMB})`, `core ${core ? Math.round(core / 104857.6) / 10 : null} MB`, page && `heap ${page.usedHeapMB}/${page.totalHeapMB} MB, ${page.domNodes} nodes, ${page.imagesLoaded} images ~${page.imagesDecodedEstMB} MB`);
}
const evaluate = (expr, ms) => session.evaluate(expr, ms);

// Arms a measurement (plus `also` ones that share its t0), runs the input, waits for the results and
// the settle time (the last DOM mutation after the screen was ready).
async function step(name, condition, input, { also = [], settleMs = 4000, timeoutMs = 150000 } = {}) {
    for (const [n, c] of [[name, condition], ...also]) await evaluate(`window.__f71.arm(${JSON.stringify(n)}, ${JSON.stringify(c)}, { timeoutMs: ${timeoutMs} })`);
    await sleep(300);
    const heapBefore = await evaluate('window.__f71.heap()').catch(() => null);
    const inputAt = Date.now();
    await input();
    const result = await waitResult(session, name, timeoutMs + 15000);
    const extras = {};
    for (const [n] of also) extras[n] = await waitResult(session, n, timeoutMs + 15000);
    // Quiet: no DOM mutation for settleMs. `settledMs` = last mutation relative to the same t0.
    let settledMs = null;
    if (!result.timeout) {
        const t0 = result.at - result.ms;
        for (let i = 0; i < 40; i++) {
            await sleep(settleMs / 4);
            const q = JSON.parse(await evaluate('JSON.stringify({ now: performance.now(), last: window.__f71.lastMutation })'));
            if (q.now - q.last >= settleMs) { settledMs = Math.round((q.last - t0) * 10) / 10; break; }
        }
    }
    const info = JSON.parse(await evaluate('JSON.stringify({ hash: location.hash, heap: window.__f71.heap(), nodes: window.__f71.nodes() })'));
    const entry = { name, ms: result.ms, timeout: !!result.timeout, frames: result.frames, settledMs, hash: info.hash, heapMB: info.heap, heapBeforeMB: heapBefore, domNodes: info.nodes, hostMs: Date.now() - inputAt };
    steps.push(entry);
    for (const [n, r] of Object.entries(extras)) steps.push({ name: n, ms: r.ms, timeout: !!r.timeout, frames: r.frames });
    log(name, result.timeout ? 'TIMEOUT' : `${result.ms} ms (settled ${settledMs} ms)`, Object.entries(extras).map(([n, r]) => `${n} ${r.timeout ? 'TIMEOUT' : r.ms + ' ms'}`).join(' '), info.hash);
    return entry;
}

const key = (...k) => () => remoteKey(...k);
const click = (href) => async () => { if (!(await evaluate(`window.__f71.click(${JSON.stringify(href)})`))) throw new Error(`no link ${href}`); };

log(`install ${path.basename(IPK)}`);
execFileSync('ares-install', ['-d', DEVICE, IPK], { stdio: 'ignore' });
try { execFileSync('ares-launch', ['-d', DEVICE, '--close', APP_ID], { stdio: 'ignore' }); } catch (e) { /* not running */ }
await sleep(6000);
const ctxStart = context(true);
async function boot() {
    execFileSync('ares-launch', ['-d', DEVICE, APP_ID], { stdio: 'ignore' });
    session = await connect(CDP_PORT, APP_ID, 90000);
    // Board ready (one row with an item on screen: enough here, the boot scenario has the strict definition).
    const start = Date.now();
    for (;;) {
        try {
            await evaluate(PAGE_TIMER, 15000);
            await evaluate('window.__f71.monitor(4000)', 15000);
            await evaluate(HELPERS, 15000);
            if (await evaluate(`(${COND.board})()`, 15000)) break;
        } catch (e) { /* the document is being replaced */ }
        if (Date.now() - start > 360000) throw new Error('the Board never showed up');
        await sleep(1000);
    }
    return start;
}
phase('launch');
let bootStart = await boot();
if (VARIANT !== 'default') {
    // The core loader reads webos.coreVariant when the worker starts: set the key and boot again.
    await evaluate(`localStorage.setItem('webos.coreVariant', ${JSON.stringify(VARIANT)}); true`, 15000);
    await sleep(3000);
    session.close();
    try { execFileSync('ares-launch', ['-d', DEVICE, '--close', APP_ID], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
    await sleep(8000);
    phase('launch-variant');
    bootStart = await boot();
}
const clockOffsetMs = (await evaluate('Date.now()')) - Date.now();
log(`Board up after ${Math.round((Date.now() - bootStart) / 1000)} s`);
phase('board-settle');
await sleep(QUIET_S * 1000);
phase('board-idle');
await sleep(QUIET_S * 1000);
await snap('board-idle');
await evaluate("(function(){ var a = document.activeElement; return a ? a.tagName + '.' + String(a.className).slice(0, 30) : 'none'; })()").then((a) => log('focus on the Board:', a));

phase('details');
await step('details-open', COND.detailsShell, key('OK'), { also: [['details-preview', COND.detailsPreview]] });
await sleep(5000);
phase('details-idle');
await sleep(10000);
await snap('details');
await step('details-back-to-board', COND.board, key('BACK'));
phase('discover');
await step('discover-open', COND.discoverShell, click('#/discover'), { also: [['discover-items', COND.discoverItems]] });
await sleep(8000);
await snap('discover');
await step('discover-back-to-board', COND.board, key('BACK'));
phase('search');
await step('search-open', COND.searchShell, async () => { await evaluate("(function(){ var b = document.querySelector('[class*=\"search-bar-container\"]'); if (b) { window.__f71.start(); b.click(); } return !!b; })()"); });
await evaluate('window.__f71.type("matrix")');
await sleep(1500);
await step('search-results', COND.searchResults, async () => { await evaluate('window.__f71.enter()'); }, { timeoutMs: 120000 });
await sleep(6000);
await snap('search');
await step('search-back-to-board', COND.board, key('BACK'));
for (const [name, href, cond] of [['library', '#/library', COND.library], ['calendar', '#/calendar', COND.calendar], ['addons', '#/addons', COND.addons], ['settings', '#/settings', COND.settings]]) {
    phase(name);
    await step(`${name}-open`, cond, click(href));
    await sleep(8000);
    await snap(name);
}
phase('board-again');
await step('board-from-settings', COND.board, click('#/'));
await sleep(5000);
phase('details-2');
await step('details-open-2', COND.detailsShell, key('OK'));
await sleep(8000);
await step('details-back-2', COND.board, key('BACK'));
phase('final-idle');
await sleep(QUIET_S * 1000);
await snap('final-idle');
phase('end');

const finalInfo = JSON.parse(await evaluate('JSON.stringify({ heap: window.__f71.heap(), nodes: window.__f71.nodes(), errors: window.__f71.errors, hash: location.hash })'));
const ctxEnd = context(true);
fs.writeFileSync(path.join(OUT, 'nav.json'), `${JSON.stringify({ ipk: path.basename(IPK), profile: process.env.EMU_PROFILE || null, instance: process.env.EMU_INSTANCE, variant: VARIANT, ctxStart, ctxEnd, steps, snapshots, timeline: JSON.parse(await evaluate('JSON.stringify(window.__f71.timeline)')), clockOffsetMs, final: finalInfo }, null, 2)}\n`);
finished = true;
session.close();
log('done');
