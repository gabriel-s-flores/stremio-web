#!/usr/bin/env node
// Endurance, long playback (F7.3): one boot, one media (a 60-minute H.264 file with three audio tracks and
// embedded subtitles, webos/tests/soak/make-media.sh), played for N minutes with the controls used as a
// viewer does (pause/play, seek, the control bar, the pointer over the Player, the add-on subtitle in the HTML
// overlay), and the memory sampled every few minutes. One media scenario per boot is the emulator's limit
// (docs/PESQUISA.md, section 7), so this is its own reservation; stream switches are the `play` scenario of F7.1.
//
//   webos/tools/emu-run --profile c8 --timeout 100 -- webos/tests/perf/run.sh <out> soak-play --ipk <ipk> --minutes 50 [--no-subtitle] [--sampling] [--worker-heap]
//
// Output: samples.jsonl (every --sample-every minutes, default 3, after a GC), video.jsonl (the element's state
// every 30 s: currentTime against the wall clock, paused, readyState, dropped frames), steps.jsonl (the
// interactions and whether the video kept playing after each), events.jsonl (restarts), soak.json.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, parseArgs, phaseWriter } from '../perf/lib.mjs';
import { APP_ID, createSoak, log, minutesSince, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const IPK = path.resolve(args.ipk || '');
const OUT = path.resolve(args.out || 'soak-play');
const MINUTES = Number(args.minutes || 50);
const SAMPLE_EVERY = Number(args['sample-every'] || 3);
const MOVIE = args.movie || 'tt0111161';
const MEDIA_DIR = args['media-dir'] || process.env.E2E_MEDIA_DIR || path.join(process.env.HOME, 'webos-tv-sdk/media-tests/e2e-long');
const SLOW = process.env.EMU_PROFILE === 'c8' ? 2 : 1;
fs.mkdirSync(OUT, { recursive: true });
const phase = phaseWriter(path.join(OUT, 'phases.jsonl'));
const soak = createSoak({ ipk: IPK, out: OUT });
const stepsFile = path.join(OUT, 'steps.jsonl');
const videoFile = path.join(OUT, 'video.jsonl');

const LIST = `(function(){
  var items = document.querySelectorAll('[class*="streams-container"] [class*="stream-container"]');
  return JSON.stringify(Array.prototype.map.call(items, function(item, i){
    var d = item.querySelector('[class*="description-container"]');
    return { i: i, file: d ? d.textContent.split('\\n')[0] : null, focused: item === document.activeElement };
  }));
})()`;
const VIDEO = `JSON.stringify((function(){ var v = document.querySelector('video'); return v ? { t: Math.round(v.currentTime * 10) / 10, paused: v.paused, ready: v.readyState, net: v.networkState, err: v.error ? v.error.code : null, dropped: v.webkitDroppedFrameCount, decoded: v.webkitDecodedFrameCount, w: v.videoWidth, h: v.videoHeight, dur: v.duration, hash: location.hash } : null; })())`;
const PLAYING = `(function(){ var v = document.querySelector('video'); return !!v && !v.paused && v.readyState >= 3 && v.currentTime > 0; })()`;
// The add-on subtitle overlay: the centered div next to the <video> (withHTMLSubtitles); a cue lasts 0.9 s every 2 s.
const OVERLAY = `(function(){ var v = document.querySelector('video'); if (!v || !v.parentElement) return null; var o = null; Array.prototype.forEach.call(v.parentElement.children, function(c){ if (c.tagName === 'DIV' && c.style.textAlign === 'center') o = c; }); return o ? o.textContent.trim() : null; })()`;
const video = async () => JSON.parse((await soak.evaluate(VIDEO, 15000).catch(() => 'null')) || 'null');

let step = 0;
const record = (name, extra) => {
    const entry = { n: ++step, name, min: Math.round(minutesSince(startedAt) * 10) / 10, ...extra };
    fs.appendFileSync(stepsFile, `${JSON.stringify(entry)}\n`);
    log(name, JSON.stringify(extra).slice(0, 200));
    return entry;
};
let startedAt = Date.now();

// After an interaction the video must play on: currentTime moves by at least 2 s in 6 s of wall clock.
async function keepsPlaying(name, tolerateSeek = false) {
    const before = await video();
    await sleep(6000);
    const after = await video();
    const moved = before && after ? after.t - before.t : null;
    const ok = !!after && !after.paused && (tolerateSeek ? true : moved >= 2) && after.err === null;
    record(name, { ok, moved, before, after });
    return ok;
}

// ---- run -----------------------------------------------------------------------------------------
log(`install ${path.basename(IPK)}, ${MINUTES} min, media ${MEDIA_DIR}`);
execFileSync('ares-install', ['-d', process.env.EMU_DEVICE, IPK], { stdio: 'ignore' });
try { execFileSync('ares-launch', ['-d', process.env.EMU_DEVICE, '--close', APP_ID], { stdio: 'ignore' }); } catch (e) { /* not running */ }

const info = path.join(OUT, 'addon.json');
fs.rmSync(info, { force: true });
const addon = spawn('node', [path.join(REPO, 'webos/tests/addon/server.mjs'), '--set', 'e2e', '--host', '10.0.2.2', '--info', info],
    { stdio: ['ignore', fs.openSync(path.join(OUT, 'addon-server.log'), 'w'), 'inherit'], env: { ...process.env, E2E_MEDIA_DIR: MEDIA_DIR } });
process.on('exit', () => addon.kill());
process.on('SIGTERM', () => process.exit(143));
for (let i = 0; i < 100 && !fs.existsSync(info); i++) await sleep(200);
const { manifestUrl } = JSON.parse(fs.readFileSync(info, 'utf8'));

let finished = false;
const summary = { scenario: 'play', playedMinutes: 0 };
process.on('exit', (code) => {
    if (finished) return;
    fs.writeFileSync(path.join(OUT, 'soak.json'), `${JSON.stringify({ ...summary, incomplete: true, exitCode: code, restarts: soak.restarts }, null, 2)}\n`);
});

await sleep(6000);
phase('launch');
await soak.launch();
phase('board-settle');
await sleep(45000);
await soak.evaluate(`fetch(${JSON.stringify(manifestUrl)}).then(function(r){ return r.json(); }).then(function(manifest){
    window.core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ${JSON.stringify(manifestUrl)}, manifest: manifest, flags: { official: false, protected: false } } } });
    return manifest.id; })`, 60000);
await sleep(8000);
phase('baseline');
await soak.sample('baseline-board');

// Details with the streams of the test addon.
phase('details');
await soak.evaluate(`location.hash = ${JSON.stringify(`#/detail/movie/${MOVIE}/${MOVIE}`)}; true`);
if (!(await soak.waitFor(`document.querySelectorAll('[class*="streams-container"] [class*="stream-container"]').length >= 3`, 120 * SLOW, 500))) throw new Error('the stream list never showed up');
await sleep(8000);
await soak.sample('details-streams');

// The long file: "720p ... MULTI" (three audio tracks, embedded subtitles, 3600 s).
const list = JSON.parse(await soak.evaluate(LIST));
const target = list.findIndex((x) => /720p.*MULTI/i.test(x.file || ''));
if (target < 0) throw new Error(`no 720p MULTI stream in ${JSON.stringify(list.map((x) => x.file))}`);
for (let guard = 0; guard < 40; guard++) {
    const now = JSON.parse(await soak.evaluate(LIST));
    const at = now.findIndex((x) => x.focused);
    if (at === target) break;
    await soak.key(at < 0 || at < target ? 'DOWN' : 'UP');
    await sleep(400);
}
phase('play-start');
startedAt = Date.now();
await soak.key('OK');
const playing = await soak.waitFor(PLAYING, 150 * SLOW, 1000);
record('play-start', { ok: playing, video: await video() });
if (!playing) throw new Error('the video never played');
phase('playing');
await sleep(10000);
const mediaStart = Date.now();

// The add-on subtitle in the HTML overlay (a new cue every 2 s for the whole run): the subtitles menu by the
// Player shortcut (S), the "exclusive" variant by a click on the option.
let overlayOn = false;
try {
    if (args['no-subtitle']) throw new Error('--no-subtitle: the A/B without the add-on subtitle overlay');
    await soak.domKey(83);
    await sleep(2500);
    const picked = await soak.evaluate(`(function(){ var o = Array.prototype.filter.call(document.querySelectorAll('[class*=subtitles-menu-container] [class*=variant-option]'), function(v){ return /xclusiv/i.test(v.textContent); })[0]; if (o) { o.click(); return true; } return false; })()`);
    await sleep(2000);
    await soak.key('BACK');
    await sleep(1500);
    for (let i = 0; i < 12 && !overlayOn; i++) { overlayOn = !!(await soak.evaluate(OVERLAY).catch(() => null)); await sleep(500); }
    record('subtitle-overlay', { ok: overlayOn, picked, text: await soak.evaluate(OVERLAY).catch(() => null) });
} catch (e) {
    record('subtitle-overlay', { ok: false, error: String(e.message).slice(0, 120) });
}
const inPlayer = await soak.evaluate(`/^#\\/player\\//.test(location.hash)`).catch(() => false);
if (!inPlayer) record('left-player-by-subtitle-step', { ok: false });
await soak.sample('play+1', { video: await video() });
// --sampling: the sampling heap profiler on the page during the whole playback: what it reports at the end is the
// allocations still alive (who holds the JS heap that grows), with the call stack of each.
let sampling = false;
if (args.sampling) {
    sampling = await soak.send('HeapProfiler.startSampling', { samplingInterval: 4096 }, 20000).then(() => true, (e) => { log('sampling heap profiler unavailable:', e.message); return false; });
}
if (args['worker-heap']) await soak.workerSnapshot('start').then((r) => { if (r.error) log('worker snapshot failed', r.error); }, (e) => log('worker snapshot failed', e.message));

// The interactions, in turn. Each one is followed by a check that the video plays on.
const INTERACTIONS = [
    ['pause-resume', async () => { await soak.key('PAUSE'); await sleep(4000); await soak.key('PLAY'); }, false],
    ['seek-forward', async () => { await soak.key('RIGHT'); }, true],
    ['bar-show-hide', async () => { await soak.key('DOWN'); await sleep(5000); }, false],
    ['seek-back', async () => { await soak.key('LEFT'); }, true],
    ['pointer-over-player', async () => {
        const w = 960; const h = 540;
        await soak.moveTo({ x: w - 200, y: h });
        await sleep(300);
        await soak.moveTo({ x: w + 200, y: h + 100 });
        await sleep(2500);
        await soak.moveTo({ x: w, y: h });
        await sleep(500);
        await soak.key('UP');
    }, false],
    ['pause-resume-keys', async () => { await soak.key('PAUSE'); await sleep(2000); await soak.key('PLAY'); }, false],
    ['fast-forward', async () => { await soak.key('FASTFORWARD'); await sleep(2500); await soak.key('PLAY'); }, true],
];
let turn = 0;
let lastSample = Date.now();
let nextInteraction = Date.now() + 60000;
let stalls = 0;
while (minutesSince(mediaStart) < MINUTES) {
    await soak.ensure('playing');
    const state = await video();
    fs.appendFileSync(videoFile, `${JSON.stringify({ t: Date.now(), min: Math.round(minutesSince(mediaStart) * 10) / 10, ...state })}\n`);
    if (state && (state.paused || state.err !== null)) stalls++;
    if (Date.now() >= nextInteraction) {
        const [name, run, tolerateSeek] = INTERACTIONS[turn++ % INTERACTIONS.length];
        try { await run(); } catch (e) { record(`${name}-error`, { error: String(e.message).slice(0, 120) }); }
        await keepsPlaying(name, tolerateSeek);
        nextInteraction = Date.now() + 90000;
    }
    if (minutesSince(lastSample) >= SAMPLE_EVERY) {
        phase(`sample-${Math.round(minutesSince(mediaStart))}`);
        await soak.sample(`play+${Math.round(minutesSince(mediaStart))}`, { video: await video(), overlay: await soak.evaluate(OVERLAY).catch(() => null) });
        lastSample = Date.now();
    }
    await sleep(30000);
}
summary.playedMinutes = Math.round(minutesSince(mediaStart) * 10) / 10;
summary.stalls = stalls;

if (sampling) {
    await soak.send('HeapProfiler.collectGarbage', {}, 30000).catch(() => {});
    const profile = await soak.send('HeapProfiler.stopSampling', {}, 60000).catch((e) => ({ error: String(e.message) }));
    fs.writeFileSync(path.join(OUT, 'heap-sampling.json'), JSON.stringify(profile));
    log('sampling profile saved', profile.error || '');
}
phase('leave');
await soak.sample('before-leave', { video: await video() });
await soak.key('BACK'); // the first Back hides the bar if it is shown (F5.7)
await sleep(3000);
if (/^#\/player\//.test(await soak.evaluate('location.hash').catch(() => ''))) await soak.key('BACK');
await sleep(5000);
await soak.sample('leave-1');
await soak.key('BACK');
await sleep(6000);
await soak.sample('leave-2-board');
phase('after-playback-idle');
await sleep(60000);
await soak.sample('leave-2-board+60s');
if (args['worker-heap']) await soak.workerSnapshot('end').then((r) => { if (r.error) log('worker snapshot failed', r.error); }, (e) => log('worker snapshot failed', e.message));
phase('end');
const final = await soak.evaluate('JSON.stringify({ hash: location.hash, errors: window.__soak.errors })').then(JSON.parse).catch(() => null);
fs.writeFileSync(path.join(OUT, 'soak.json'), `${JSON.stringify({
    scenario: 'play', ipk: path.basename(IPK), profile: process.env.EMU_PROFILE || 'normal', instance: process.env.EMU_INSTANCE,
    ...summary, overlayOn, restarts: soak.restarts, final,
}, null, 2)}\n`);
finished = true;
log('done');
process.exit(0);
