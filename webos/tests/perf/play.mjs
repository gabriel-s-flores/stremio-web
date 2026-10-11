#!/usr/bin/env node
// Details -> Player times and memory during and after playback, with stream switches (F7.1). One media
// scenario per boot (the emulator plays reliably only the first media after boot), so this is its own
// reservation. The local test addon (webos/tests/addon, F6.2) gives the streams: H.264 files of the
// kit, served with a 302 like a debrid link. Real remote keys for everything but the first navigation.
//
//   webos/tools/emu-run --profile c8 --timeout 45 -- webos/tests/perf/run.sh <out> play --ipk <ipk> [--switches 5] [--hold 30] [--variant wasm|wasm2js]
//
// Steps (each timed on the page clock from the key event): open the streams of a movie (location.hash:
// the Board has no movie with streams otherwise), OK on a stream until the video is playing
// (readyState >= 3, currentTime > 0, not paused), hold --hold seconds, Back to the streams list, OK on
// another stream... --switches times, then Back out of the Player and 30 s idle (memory after
// playback). A switch that does not reach "playing" within 120 s is recorded as failed; two failures in
// a row end the run (the pipeline is stuck: the known emulator limit, see F5.6).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, PAGE_MEMORY, layerStats, PAGE_TIMER, REPO, connect, parseArgs, phaseWriter, remoteKey, sleep, statusSnapshot, waitResult } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const IPK = path.resolve(args.ipk || '');
const OUT = path.resolve(args.out || 'perf-play');
const SWITCHES = Number(args.switches ?? 5);
const HOLD_S = Number(args.hold || 30);
const VARIANT = args.variant || 'default';
const MOVIE = args.movie || 'tt0111161';
const { EMU_DEVICE: DEVICE, EMU_CDP_PORT: CDP_PORT, EMU_INSTANCE: INSTANCE } = process.env;
if (!DEVICE || !CDP_PORT) {
    console.error('run inside webos/tools/emu-run');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const phase = phaseWriter(path.join(OUT, 'phases.jsonl'));
// ref: with the CPU reference loop (2 s of one host core: only between steps); without it a state is not "calm".
const context = (ref = false) => JSON.parse(execFileSync(path.join(REPO, 'webos/tests/perf/context.sh'), ref ? [] : ['--no-ref'], { encoding: 'utf8' }));
const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a);

// The streams of the movie, as the list shows them (file name = first line of the description).
const LIST = `(function(){
  var items = document.querySelectorAll('[class*="streams-container"] [class*="stream-container"]');
  return JSON.stringify(Array.prototype.map.call(items, function(item, i){
    var d = item.querySelector('[class*="description-container"]');
    return { i: i, file: d ? d.textContent.split('\\n')[0] : null, focused: item === document.activeElement };
  }));
})()`;
const PLAYING = `function () { var v = document.querySelector('video'); return !!v && !v.paused && v.readyState >= 3 && v.currentTime > 0; }`;
const PLAYER_SHELL = `function () { return /^#\\/player\\//.test(location.hash) && !!document.querySelector('video'); }`;
const LIST_SHOWN = `function () { return /^#\\/detail\\//.test(location.hash) && document.querySelectorAll('[class*="streams-container"] [class*="stream-container"]').length >= 3; }`;
const VIDEO_STATE = `JSON.stringify((function(){ var v = document.querySelector('video'); return v ? { t: Math.round(v.currentTime * 10) / 10, paused: v.paused, ready: v.readyState, net: v.networkState, err: v.error ? v.error.code : null, dropped: v.webkitDroppedFrameCount, decoded: v.webkitDecodedFrameCount, w: v.videoWidth, h: v.videoHeight, dur: v.duration } : null; })())`;
const HEAP = `(function(){ return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10 : null; })()`;

const events = [];
const snapshots = [];
process.on('SIGTERM', () => process.exit(143)); // the emu-run timeout: the exit handler below still writes what was measured
// If the run dies half way (the renderer killed by the OOM, a CDP timeout), what was measured so far is kept.
let finished = false;
process.on('exit', (code) => {
    if (finished) return;
    fs.writeFileSync(path.join(OUT, 'play.json'), `${JSON.stringify({ ipk: path.basename(IPK), profile: process.env.EMU_PROFILE || null, instance: INSTANCE, variant: VARIANT, incomplete: true, exitCode: code, events, snapshots }, null, 2)}\n`);
});
let session;
// Where the memory is at a moment: the renderer's RSS by kind (anon, file, shmem; /proc/pid/status) and what the page reports.
async function snap(label) {
    const page = JSON.parse(await session.evaluate(PAGE_MEMORY, 30000).catch(() => 'null'));
    const core = await session.evaluate('window.core.getCoreLoaderStatus().then(function(s){ return s && s.memoryBytes; })', 20000).catch(() => null);
    const proc = statusSnapshot();
    snapshots.push({ label, at: Date.now(), page, layers: await layerStats(session), coreMemoryMB: core ? Math.round(core / 104857.6) / 10 : null, proc });
    log('snapshot', label, proc.error || `${proc.rssMB} MB (anon ${proc.anonMB}, file ${proc.fileMB}, shmem ${proc.shmemMB})`, `core ${core ? Math.round(core / 104857.6) / 10 : null} MB`, page && `heap ${page.usedHeapMB}/${page.totalHeapMB} MB, ${page.domNodes} nodes, ${page.imagesLoaded} images ~${page.imagesDecodedEstMB} MB, routes ${page.routeContainers}`);
}
const evaluate = (expr, ms) => session.evaluate(expr, ms);

async function armed(name, cond, input, timeoutMs) {
    await evaluate(`window.__f71.arm(${JSON.stringify(name)}, ${JSON.stringify(cond)}, { timeoutMs: ${timeoutMs} })`);
    await sleep(300);
    await input();
    return waitResult(session, name, timeoutMs + 15000);
}

// DOWN on the remote until a stream item has the focus, then to `target`; returns false if it never gets there.
async function focusStream(target) {
    for (let guard = 0; guard < 40; guard++) {
        const list = JSON.parse(await evaluate(LIST));
        const at = list.findIndex((x) => x.focused);
        if (at === target) return true;
        await remoteKey(at < 0 || at < target ? 'DOWN' : 'UP');
        await sleep(350);
    }
    return false;
}

async function playOnce(label, pattern) {
    const list = JSON.parse(await evaluate(LIST));
    const target = list.findIndex((x) => pattern.test(x.file || ''));
    if (target < 0) throw new Error(`no stream matching ${pattern} in ${JSON.stringify(list.map((x) => x.file))}`);
    if (!(await focusStream(target))) throw new Error(`could not focus stream ${target}`);
    phase(`${label}-start`);
    await evaluate(`window.__f71.arm(${JSON.stringify(`${label}-player`)}, ${JSON.stringify(PLAYER_SHELL)}, { timeoutMs: 120000 })`);
    const playing = await armed(`${label}-playing`, PLAYING, () => remoteKey('OK'), 120000);
    const shell = await waitResult(session, `${label}-player`, 5000);
    const state = JSON.parse((await evaluate(VIDEO_STATE).catch(() => 'null')) || 'null');
    const entry = { label, file: list[target].file, playerShellMs: shell.ms ?? null, playingMs: playing.timeout ? null : playing.ms, failed: !!playing.timeout, video: state, heapMB: await evaluate(HEAP).catch(() => null), ctx: context() };
    events.push(entry);
    log(label, playing.timeout ? 'FAILED to play within 120 s' : `playing after ${playing.ms} ms (player shell ${shell.ms} ms)`, JSON.stringify(state));
    return entry;
}

log(`install ${path.basename(IPK)}`);
execFileSync('ares-install', ['-d', DEVICE, IPK], { stdio: 'ignore' });
try { execFileSync('ares-launch', ['-d', DEVICE, '--close', APP_ID], { stdio: 'ignore' }); } catch (e) { /* not running */ }

// The test addon: media root with the kit files, 10.0.2.2 is the host as the emulator sees it.
const info = path.join(OUT, 'addon.json');
fs.rmSync(info, { force: true });
const addon = spawn('node', [path.join(REPO, 'webos/tests/addon/server.mjs'), '--host', '10.0.2.2', '--info', info], { stdio: ['ignore', fs.openSync(path.join(OUT, 'addon-server.log'), 'w'), 'inherit'] });
process.on('exit', () => addon.kill());
for (let i = 0; i < 100 && !fs.existsSync(info); i++) await sleep(200);
if (!fs.existsSync(info)) throw new Error('the test addon did not start');
const { manifestUrl } = JSON.parse(fs.readFileSync(info, 'utf8'));

const ctxStart = context(true);
await sleep(6000);
async function boot() {
    execFileSync('ares-launch', ['-d', DEVICE, APP_ID], { stdio: 'ignore' });
    session = await connect(CDP_PORT, APP_ID, 90000);
    const bootStart = Date.now();
    for (;;) {
        try {
            await evaluate(PAGE_TIMER, 15000);
            await evaluate('window.__f71.monitor(4000)', 15000);
            if (await evaluate("(function(){ return !!(window.core && window.core.dispatch) && !!document.querySelector('[class*=\"board-content\"] [class*=\"meta-item-container\"]'); })()", 15000)) break;
        } catch (e) { /* the document is being replaced */ }
        if (Date.now() - bootStart > 360000) throw new Error('the Board never showed up');
        await sleep(1000);
    }
    return bootStart;
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
// The page's memory timeline, copied to timeline.jsonl every 10 s: a run killed by the OOM keeps it.
let timelineSent = 0;
const timelineFile = path.join(OUT, 'timeline.jsonl');
const dumpTimeline = setInterval(async () => {
    try {
        const part = JSON.parse(await session.evaluate(`JSON.stringify(window.__f71.timeline.slice(${timelineSent}))`, 5000));
        timelineSent += part.length;
        for (const e of part) fs.appendFileSync(timelineFile, `${JSON.stringify(e)}\n`);
    } catch (e) { /* the page is busy or gone */ }
}, 10000);
dumpTimeline.unref();
log(`Board up after ${Math.round((Date.now() - bootStart) / 1000)} s`);
await sleep(15000);
const installed = await evaluate(`fetch(${JSON.stringify(manifestUrl)}).then(function(r){ return r.json(); }).then(function(manifest){
    window.core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ${JSON.stringify(manifestUrl)}, manifest: manifest, flags: { official: false, protected: false } } } });
    return manifest.id; })`, 60000);
log('addon installed:', installed);
await sleep(3000);
phase('board-idle');
await sleep(15000);
await snap('board-idle');

phase('details');
const hash = `#/detail/movie/${MOVIE}/${MOVIE}`;
const listShown = await armed('streams-list', LIST_SHOWN, () => evaluate(`window.__f71.start(); location.hash = ${JSON.stringify(hash)}; true`), 120000);
log('streams list:', listShown.timeout ? 'TIMEOUT' : `${listShown.ms} ms`);
await sleep(8000);
await snap('details-streams');

const plan = [/H264\.AAC-GRP\.mp4/, /H264\.MULTI/];
let failures = 0;
for (let n = 0; n <= SWITCHES; n++) {
    const label = n === 0 ? 'play-1' : `switch-${n}`;
    let entry;
    try {
        entry = await playOnce(label, plan[n % plan.length]);
    } catch (e) {
        log(label, 'ERROR', e.message);
        events.push({ label, error: e.message });
        failures++;
        if (failures >= 2) break;
        continue;
    }
    failures = entry.failed ? failures + 1 : 0;
    if (failures >= 2) { log('two failures in a row: the pipeline is stuck, stopping'); break; }
    phase(`${label}-hold`);
    for (let s = 0; s < HOLD_S; s += 10) {
        await sleep(10000);
        entry.samples = entry.samples || [];
        entry.samples.push(JSON.parse((await evaluate(VIDEO_STATE).catch(() => 'null')) || 'null'));
    }
    await snap(`${label}-hold-end`);
    if (n === SWITCHES) break;
    // Back to the streams list (the previous route), as the user does to pick another stream.
    phase(`${label}-back`);
    const back = await armed(`${label}-back-to-list`, LIST_SHOWN, () => remoteKey('BACK'), 60000);
    events.push({ label: `${label}-back`, ms: back.timeout ? null : back.ms, hash: await evaluate('location.hash') });
    log(`${label} back to the list:`, back.timeout ? 'TIMEOUT' : `${back.ms} ms`);
    if (back.timeout) await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
    await sleep(4000);
}

phase('after-playback-leave');
await snap('before-leave');
await remoteKey('BACK');
await sleep(4000);
await snap('leave-1-details');
await remoteKey('BACK').catch(() => {});
await sleep(2000);
await snap('leave-2-board+2s');
await sleep(6000);
await snap('leave-2-board+8s');
phase('after-playback-idle');
await sleep(30000);
await snap('leave-2-board+38s');
phase('end');
const final = JSON.parse(await evaluate('JSON.stringify({ hash: location.hash, errors: window.__f71.errors })'));
const ctxEnd = context(true);
fs.writeFileSync(path.join(OUT, 'play.json'), `${JSON.stringify({ ipk: path.basename(IPK), profile: process.env.EMU_PROFILE || null, instance: INSTANCE, switches: SWITCHES, holdS: HOLD_S, variant: VARIANT, streamsList: listShown, ctxStart, ctxEnd, events, snapshots, timeline: JSON.parse(await evaluate('JSON.stringify(window.__f71.timeline)')), clockOffsetMs, final }, null, 2)}\n`);
finished = true;
session.close();
addon.kill();
log('done');
