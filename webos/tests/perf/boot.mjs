#!/usr/bin/env node
// Cold boots of the packaged app on the emulator (F7.1): N launches in one reservation, each with
//   - the F3.6/F1.6 probe marks on the page clock: coreReadyAt (window.core assigned), firstRowAt (first
//     frame with a Board catalog item inside the screen), screenFullAt (two Board rows with items). Same
//     hooks and definitions as webos/tests/diagnostics/boot-probe.mjs, so the numbers compare with the
//     ones of F1.6, F3.5, F3.6 and F4.2;
//   - the host wall time from the ares-launch call to screenFull (adds what happens before the page
//     exists: WAM spawning the renderer);
//   - after a quiet window on the Board, the diagnostics report (#/webos-diagnostics): the app's own boot
//     marks (core init start, core ready, Board mounted, first Board item), DOMContentLoaded/load and the
//     core loader status (variant and compile/instantiate timings);
//   - the host state before and after (context.sh) and a phase mark per launch for the memory analysis.
//
//   webos/tools/emu-run --profile c8 --timeout 40 -- node webos/tests/perf/boot.mjs --ipk <ipk> --out <dir> \
//       [--launches 5] [--warmup 1] [--variant default|wasm|wasm2js] [--quiet 25] [--no-diag]
// --warmup N: N extra launches first, recorded with warmup:true and left out of the medians (the first launch
// after an install runs without the Chromium code cache; see BASELINE-C8.md).
// Writes <dir>/boot.jsonl (one line per launch) and <dir>/phases.jsonl (for mem-analyze.mjs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, REPO, connect, parseArgs, phaseWriter, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const IPK = path.resolve(args.ipk || '');
const OUT = path.resolve(args.out || 'perf-boot');
const LAUNCHES = Number(args.launches || 5);
const VARIANT = args.variant || 'default';
const QUIET_S = Number(args.quiet || 25);
// The first launch after an install runs without the Chromium code cache: it is recorded but never counted.
const WARMUP = Number(args.warmup ?? 1);
const { EMU_DEVICE: DEVICE, EMU_CDP_PORT: CDP_PORT } = process.env;
if (!DEVICE || !CDP_PORT) {
    console.error('run inside webos/tools/emu-run');
    process.exit(2);
}
if (!fs.existsSync(IPK)) {
    console.error(`--ipk ${IPK} not found`);
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'boot.jsonl'), ''); // a fresh round, not the lines of an earlier one
process.on('SIGTERM', () => process.exit(143));
const phase = phaseWriter(path.join(OUT, 'phases.jsonl'));
const ares = (...a) => { try { return execFileSync('ares-launch', ['-d', DEVICE, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return String(e.stderr || e.message); } };
const context = (ref) => JSON.parse(execFileSync(path.join(REPO, 'webos/tests/perf/context.sh'), ref ? [] : ['--no-ref'], { encoding: 'utf8' }));

// Same hooks as webos/tests/diagnostics/boot-probe.mjs (F3.6). Installed repeatedly until the page is up.
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
const STATE = 'JSON.stringify({ hooks: window.__f36 || null, now: performance.now() })';

// The diagnostics screen is a lazy route: open it, wait for the report and read the sections.
const READ_DIAGNOSTICS = `(function(){
  if (!window.__f71diag) {
    window.__f71diag = { started: performance.now() };
    location.hash = '#/webos-diagnostics';
  }
  var d = window.__webos && window.__webos.diagnostics;
  if (!d || !d.sections) return null;
  var pick = function(id){ var s = d.sections.filter(function(x){ return x.id === id; })[0]; return s ? s.data : null; };
  return JSON.stringify({ boot: pick('boot'), core: pick('core'), memory: pick('memory'), waitedMs: Math.round(performance.now() - window.__f71diag.started) });
})()`;

async function oneLaunch(k) {
    ares('--close', APP_ID);
    await sleep(8000);
    const ctxBefore = context(true);
    const record = { k, variant: VARIANT, warmup: k <= WARMUP, ctxBefore };
    phase(`launch-${k}`, { k });
    const launchedAt = Date.now();
    ares(APP_ID);
    // The probe races the page: connect as soon as the target exists, as boot-probe.mjs does (the core
    // takes >= 10 s to come up on the c8 profile, so the hooks are in place long before).
    const session = await connect(CDP_PORT, APP_ID, 90000);
    const deadline = Date.now() + 240000;
    let state = null;
    let firstRowSeenMs = null;
    while (Date.now() < deadline) {
        try {
            await session.evaluate(HOOKS, 15000);
            state = JSON.parse(await session.evaluate(STATE, 15000));
            if (firstRowSeenMs === null && state.hooks && state.hooks.firstRowAt !== null) firstRowSeenMs = Date.now() - launchedAt;
            if (state.hooks && state.hooks.screenFullAt !== null) break;
        } catch (e) { /* the document is being replaced */ }
        await sleep(500);
    }
    const hooks = (state && state.hooks) || {};
    const round = (v) => (typeof v === 'number' ? Math.round(v) : v);
    record.ok = !!(state && hooks.screenFullAt !== null);
    record.coreReadyAt = round(hooks.coreReadyAt);
    record.firstRowAt = round(hooks.firstRowAt);
    record.screenFullAt = round(hooks.screenFullAt);
    record.hostLaunchToScreenFullMs = Date.now() - launchedAt;
    // Host wall time from the ares-launch call to the first Board item (polled every 0.5 s, so up to ~0.5 s late).
    record.hostLaunchToFirstRowMs = firstRowSeenMs;
    // Quiet window on the Board: the steady memory of this launch.
    phase(`idle-${k}`, { k });
    await sleep(QUIET_S * 1000);
    if (!args['no-diag']) {
        phase(`diag-${k}`, { k });
        let report = null;
        const diagDeadline = Date.now() + 150000;
        while (Date.now() < diagDeadline && !report) {
            try { report = await session.evaluate(READ_DIAGNOSTICS, 30000); } catch (e) { /* retry */ }
            if (!report) await sleep(1500);
        }
        if (report) {
            const parsed = JSON.parse(report);
            record.marks = parsed.boot;
            record.core = parsed.core && { variant: parsed.core.variant, reason: parsed.core.reason, requested: parsed.core.requested, timings: parsed.core.timings, memoryBytes: parsed.core.memoryBytes, error: parsed.core.error };
            record.jsHeap = parsed.memory && parsed.memory.jsHeap;
        } else {
            record.diagnostics = 'unavailable';
        }
    }
    session.close();
    phase(`end-${k}`, { k });
    ares('--close', APP_ID);
    await sleep(3000);
    record.ctxAfter = context(true);
    fs.appendFileSync(path.join(OUT, 'boot.jsonl'), `${JSON.stringify(record)}\n`);
    console.log(`launch ${k}/${LAUNCHES + WARMUP}${record.warmup ? ' (warm-up)' : ''} [${VARIANT}] core ${record.coreReadyAt} ms · first row ${record.firstRowAt} ms · screen full ${record.screenFullAt} ms · load ${ctxBefore.load1} -> ${record.ctxAfter.load1} · ref ${ctxBefore.hostRefMs} ms`);
}

console.log(`install ${path.basename(IPK)} on ${DEVICE}`);
// A clean install: the previous build of the A/B is removed first (installing over a different build
// sometimes fails with exit 255 on the emulator), retried once.
for (let attempt = 0; ; attempt++) {
    try { execFileSync('ares-install', ['-d', DEVICE, '--remove', APP_ID], { stdio: 'ignore' }); } catch (e) { /* not installed */ }
    try { execFileSync('ares-install', ['-d', DEVICE, IPK], { stdio: 'ignore' }); break; } catch (e) { if (attempt >= 2) throw e; await sleep(5000); }
}
fs.writeFileSync(path.join(OUT, 'info.json'), `${JSON.stringify({ ipk: path.basename(IPK), variant: VARIANT, launches: LAUNCHES, warmup: WARMUP, quietS: QUIET_S, profile: process.env.EMU_PROFILE || null, instance: process.env.EMU_INSTANCE, startedAt: new Date().toISOString() }, null, 2)}\n`);
if (VARIANT !== 'default') {
    // The loader reads webos.coreVariant from the page's localStorage when the worker starts.
    ares(APP_ID);
    const session = await connect(CDP_PORT, APP_ID, 90000);
    for (let i = 0; i < 60; i++) {
        try { if (await session.evaluate('document.readyState === "complete"', 10000)) break; } catch (e) { /* retry */ }
        await sleep(2000);
    }
    await session.evaluate(`localStorage.setItem('webos.coreVariant', ${JSON.stringify(VARIANT)}); localStorage.getItem('webos.coreVariant')`, 15000);
    await sleep(3000);
    session.close();
}
for (let k = 1; k <= LAUNCHES + WARMUP; k++) await oneLaunch(k);
