#!/usr/bin/env node
// Memory of the Details + streams list, cycle after cycle, no playback (F7.1): the case where the
// renderer of the app grew by 250-300 MB within seconds and the kernel killed it (OOM) on the C8 profile.
// The test addon (webos/tests/addon) answers the streams of any movie; each cycle opens the Details of the
// same movie (location.hash: opens the route like a link), waits, goes back to the Board and waits again.
// Options: --cycles N (4), --on-details S (25), --on-board S (15), --variant wasm|wasm2js (webos.coreVariant),
// --no-addon (the control: the same cycles without the addon, so without streams).
//
//   webos/tools/emu-run --profile c8 --timeout 45 -- webos/tests/perf/run.sh <out> streams-cycle --ipk <ipk> [options]
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, PAGE_MEMORY, layerStats, PAGE_TIMER, REPO, connect, parseArgs, phaseWriter, sleep, statusSnapshot } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const IPK = path.resolve(args.ipk || '');
const OUT = path.resolve(args.out || 'perf-streams-cycle');
const CYCLES = Number(args.cycles || 4);
const ON_DETAILS = Number(args['on-details'] || 25);
const ON_BOARD = Number(args['on-board'] || 15);
const VARIANT = args.variant || 'default';
const MOVIE = args.movie || 'tt0111161';
const { EMU_DEVICE: DEVICE, EMU_CDP_PORT: CDP_PORT } = process.env;
if (!DEVICE || !CDP_PORT) { console.error('run inside webos/tools/emu-run'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const phase = phaseWriter(path.join(OUT, 'phases.jsonl'));
const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a);
const ares = (...a) => { try { return execFileSync('ares-launch', ['-d', DEVICE, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return String(e.stderr || e.message); } };

execFileSync('ares-install', ['-d', DEVICE, IPK], { stdio: 'ignore' });
ares('--close', APP_ID);
let addon = null;
let manifestUrl = null;
if (!args['no-addon']) {
    const info = path.join(OUT, 'addon.json');
    fs.rmSync(info, { force: true });
    addon = spawn('node', [path.join(REPO, 'webos/tests/addon/server.mjs'), '--host', '10.0.2.2', '--info', info], { stdio: ['ignore', fs.openSync(path.join(OUT, 'addon-server.log'), 'w'), 'inherit'] });
    process.on('exit', () => addon.kill());
    for (let i = 0; i < 100 && !fs.existsSync(info); i++) await sleep(200);
    manifestUrl = JSON.parse(fs.readFileSync(info, 'utf8')).manifestUrl;
}
await sleep(6000);

async function boot() {
    ares(APP_ID);
    const session = await connect(CDP_PORT, APP_ID, 90000);
    const start = Date.now();
    for (;;) {
        try {
            await session.evaluate(PAGE_TIMER, 15000);
            await session.evaluate('window.__f71.monitor(2000)', 15000);
            if (await session.evaluate("!!(window.core && window.core.dispatch) && !!document.querySelector('[class*=\"board-content\"] [class*=\"meta-item-container\"]')", 15000)) break;
        } catch (e) { /* the document is being replaced */ }
        if (Date.now() - start > 360000) throw new Error('the Board never showed up');
        await sleep(1000);
    }
    return session;
}

phase('launch');
let session = await boot();
if (VARIANT !== 'default') {
    // The variant is read when the worker starts: set the key, then boot again.
    await session.evaluate(`localStorage.setItem('webos.coreVariant', ${JSON.stringify(VARIANT)}); true`, 15000);
    await sleep(3000);
    session.close();
    ares('--close', APP_ID);
    await sleep(8000);
    phase('launch-variant');
    session = await boot();
}
const status = await session.evaluate('window.core.getCoreLoaderStatus().then(function(s){ return JSON.stringify(s); })', 30000).catch(() => null);
log('core:', status);
await sleep(15000);
if (manifestUrl) {
    await session.evaluate(`fetch(${JSON.stringify(manifestUrl)}).then(function(r){ return r.json(); }).then(function(manifest){
        window.core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ${JSON.stringify(manifestUrl)}, manifest: manifest, flags: { official: false, protected: false } } } });
        return manifest.id; })`, 60000);
    log('addon installed');
}
phase('board-idle');
await sleep(15000);
const snapshots = [];
const snap = async (label) => {
    const page = JSON.parse(await session.evaluate(PAGE_MEMORY, 30000).catch(() => 'null'));
    const proc = statusSnapshot();
    snapshots.push({ label, at: Date.now(), page, layers: await layerStats(session), proc });
    log(label, proc.error || `${proc.rssMB} MB (anon ${proc.anonMB}, file ${proc.fileMB}, shmem ${proc.shmemMB})`, page && `heap ${page.usedHeapMB}/${page.totalHeapMB} MB, ${page.domNodes} nodes`);
};
await snap('board-idle');
const hash = `#/detail/movie/${MOVIE}/${MOVIE}`;
for (let c = 1; c <= CYCLES; c++) {
    phase(`cycle-${c}-details`);
    await session.evaluate(`location.hash = ${JSON.stringify(hash)}; true`, 15000);
    await sleep(ON_DETAILS * 1000);
    await snap(`cycle-${c}-details`);
    phase(`cycle-${c}-board`);
    await session.evaluate('location.hash = "#/"; true', 15000);
    await sleep(ON_BOARD * 1000);
    await snap(`cycle-${c}-board`);
}
phase('end');
const timeline = JSON.parse(await session.evaluate('JSON.stringify(window.__f71.timeline)', 30000).catch(() => '[]'));
fs.writeFileSync(path.join(OUT, 'streams-cycle.json'), `${JSON.stringify({ ipk: path.basename(IPK), variant: VARIANT, addon: !!manifestUrl, core: status, cycles: CYCLES, snapshots, timeline }, null, 2)}\n`);
session.close();
if (addon) addon.kill();
log('done');
