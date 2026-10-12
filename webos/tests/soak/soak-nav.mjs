#!/usr/bin/env node
// Endurance, navigation (F7.3): one boot, N minutes of continuous navigation through every screen with the
// remote keys (webos/tools/remote.mjs) and the Magic Remote pointer (CDP mouse events + cursorStateChange),
// and the memory taken at the Board after every cycle.
//
//   webos/tools/emu-run --profile c8 --timeout 90 -- webos/tests/perf/run.sh <out> soak-nav --ipk <ipk> --minutes 60 [--worker-heap] [--idle] [--only catalog|local]
//   (run.sh finds this script in webos/tests/soak; it adds the guest memory sampler, the phases and the OOM check)
//
// A cycle: Board (arrows) -> Details (OK, the stream list of the test addon, arrows) -> Back -> Discover (pointer
// on the side bar, arrows, more items) -> Back -> Search (pointer, "matrix", Enter, arrows) -> Back -> Library,
// Calendar, Addons, Settings (pointer on the side bar, arrows) -> diagnostics (R-G-Y-B) -> Back -> Board (pointer
// on the logo) -> pointer sweep over the posters and the wheel -> an arrow (the pointer hides). Every step has
// an expectation (the route and the screen); a step that fails is recorded and the run goes on, after three
// in a row the run goes back to the Board by the hash. A restart of the renderer is detected and recorded.
//
// Output: samples.jsonl (one per cycle, at the Board, after a GC), steps.jsonl, events.jsonl (restarts), soak.json.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, parseArgs, phaseWriter } from '../perf/lib.mjs';
import { APP_ID, createSoak, log, minutesSince, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const IPK = path.resolve(args.ipk || '');
const OUT = path.resolve(args.out || 'soak-nav');
const MINUTES = Number(args.minutes || 60);
const ONLY = args.only || null; // 'catalog' | 'local'
const SLOW = process.env.EMU_PROFILE === 'c8' ? 2 : 1;
fs.mkdirSync(OUT, { recursive: true });
const phase = phaseWriter(path.join(OUT, 'phases.jsonl'));
const soak = createSoak({ ipk: IPK, out: OUT });
const stepsFile = path.join(OUT, 'steps.jsonl');

const ROUTE = `document.querySelector('.routes-container > .route-container:last-child')`;
const inRoute = (hashPattern, selector) => `(function(){ var route = ${ROUTE}; return /${hashPattern}/.test(location.hash) && !!route && !!route.querySelector(${JSON.stringify(selector)}); })()`;
const items = (selector, min) => `(function(){ var route = ${ROUTE}; if (!route) return false; var scope = route.querySelector(${JSON.stringify(selector)}); if (!scope) return false; return scope.querySelectorAll('[class*="meta-item-container"]').length >= ${min}; })()`;
const COND = {
    board: `(function(){ var h = location.hash; if (h !== '' && h !== '#/') return false; var route = ${ROUTE}; return !!route && !!route.querySelector('[class*="board-content"] [class*="meta-item-container"]'); })()`,
    details: inRoute('^#\\/detail\\/', '[class*="metadetails-container"] [class*="metadetails-content"]'),
    streams: `(function(){ return /^#\\/detail\\//.test(location.hash) && document.querySelectorAll('[class*="streams-container"] [class*="stream-container"]').length >= 3; })()`,
    discover: inRoute('^#\\/discover', '[class*="discover-container"]'),
    discoverItems: items('[class*="meta-items-container"]', 6),
    search: inRoute('^#\\/search', '[class*="search-container"]'),
    searchResults: items('[class*="search-content"]', 3),
    library: inRoute('^#\\/library', '[class*="library-container"]'),
    calendar: inRoute('^#\\/calendar', '[class^="calendar-"]'),
    addons: inRoute('^#\\/addons', '[class*="addons-container"]'),
    settings: inRoute('^#\\/settings', '[class*="settings-container"]'),
    diagnostics: `/^#\\/webos-diagnostics/.test(location.hash)`,
};

let cycle = 0;
const stats = { steps: 0, failed: 0, fallbacks: 0, byName: {} };
let failStreak = 0;

// One step: run `action`, then wait for `expectation`; record the time and the outcome.
async function step(name, action, expectation, seconds = 45) {
    await soak.ensure(name);
    const t0 = Date.now();
    let ok = false;
    let error = null;
    try {
        await action();
        ok = expectation ? await soak.waitFor(expectation, seconds * SLOW, 400) : true;
    } catch (e) {
        error = String(e.message).slice(0, 160);
    }
    const entry = { cycle, name, ok, ms: Date.now() - t0, error, t0, t: Date.now() }; // host clock, to line the steps up with mem.log
    // Where the page was when the expectation did not come true (a click that went nowhere, a screen that did not render).
    if (!ok) entry.where = await soak.evaluate(`JSON.stringify({ hash: location.hash, focus: window.__soak.focus(), pointer: document.documentElement.getAttribute('data-webos-pointer'), routes: document.querySelectorAll('.routes-container > .route-container').length, last: (function(){ var r = ${ROUTE}; return r ? String(r.firstElementChild && r.firstElementChild.className).slice(0, 80) : null; })() })`, 10000).then(JSON.parse).catch(() => null);
    fs.appendFileSync(stepsFile, `${JSON.stringify(entry)}\n`);
    stats.steps++;
    const by = stats.byName[name] = stats.byName[name] || { runs: 0, failed: 0, ms: [] };
    by.runs++;
    by.ms.push(entry.ms);
    if (!ok) {
        stats.failed++;
        by.failed++;
        failStreak++;
        log('STEP FAILED', name, error || '');
        if (failStreak >= 3) {
            log('three failed steps in a row: back to the Board by the hash');
            soak.note('reset-to-board', { cycle, after: name });
            await soak.evaluate("location.hash = '#/'; true").catch(() => {});
            await sleep(4000);
            await soak.waitFor(COND.board, 60 * SLOW, 500);
            failStreak = 0;
        }
    } else {
        failStreak = 0;
    }
    return ok;
}

// The side bar link, by the pointer; if the bar has no such link on screen (or no size), the DOM click, counted.
async function pointerLink(href) {
    // A click during the previous screen's transition is lost (the nav bar of the route is being replaced): 12 of 56
    // Library -> Calendar clicks in the `only-local` run, none in 40 clicks 2.5 s after the screen opened. Let it settle.
    await sleep(1500);
    if (await soak.pointerClick(`a[href="${href}"]`)) return;
    stats.fallbacks++;
    soak.note('fallback-dom-click', { href });
    await soak.evaluate(`(function(){ var a = document.querySelector('a[href="${href}"]'); if (a) a.click(); return !!a; })()`);
}

// The search field: the visible one (the top bar and the side bar both have the bar, one hidden). The route may
// still be mounting (c8 is slow) and swallow the first value: type until the field keeps it, then Enter, and again
// Enter if the route did not go to the query.
const VISIBLE_INPUT = `[].filter.call(document.querySelectorAll('input[type="text"]'), function(i){ return i.getBoundingClientRect().width > 0; })[0]`;
async function typeInSearch(text) {
    for (let attempt = 0; attempt < 4; attempt++) {
        await soak.evaluate(`(function(){
            var input = ${VISIBLE_INPUT}; if (!input) return false;
            input.focus();
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true; })()`);
        await sleep(1500 * SLOW);
        if (await soak.evaluate(`(function(){ var input = ${VISIBLE_INPUT}; return !!input && input.value === ${JSON.stringify(text)}; })()`).catch(() => false)) break;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        await soak.evaluate(`(function(){
            var input = ${VISIBLE_INPUT}; if (!input) return false;
            ['keydown', 'keyup'].forEach(function(type){
                var e = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true });
                Object.defineProperty(e, 'keyCode', { get: function(){ return 13; } });
                Object.defineProperty(e, 'which', { get: function(){ return 13; } });
                input.dispatchEvent(e); });
            return true; })()`);
        await sleep(4000 * SLOW);
        if (await soak.evaluate(`/search=${text}/.test(location.hash)`).catch(() => false)) return;
    }
}

async function wheel(selector, deltaY) {
    const point = await soak.centerOf(selector);
    if (!point) return;
    await soak.moveTo(point);
    // Chromium 53 has no mouseWheel in Input.dispatchMouseEvent: a scroll gesture from the mouse instead.
    await soak.send('Input.synthesizeScrollGesture', { x: point.x, y: point.y, yDistance: -deltaY, gestureSourceType: 'mouse', speed: 900 }, 20000).catch(() => {});
}

async function oneCycle() {
    phase(`cycle-${cycle}`);
    // --only catalog | local: the A/B of what grows (F7.3): the screens that load posters and catalogs from the network, or the local ones.
    if (ONLY !== 'local') {
        // Board: the arrows through the rows (the rows load as the focus gets there).
        await step('board-arrows', () => soak.keys(['DOWN', 'DOWN', 'RIGHT', 'RIGHT', 'RIGHT', 'UP', 'LEFT', 'DOWN', 'DOWN', 'DOWN', 'UP']), COND.board);
        // OK on a poster opens Details; with the focus anywhere else (the bar), arrows first.
        for (let i = 0; i < 4 && !(await soak.evaluate(`!!(document.activeElement && document.activeElement.closest('[class*="board-content"] [class*="meta-item-container"]'))`).catch(() => false)); i++) {
            await soak.keys(['DOWN'], 500);
        }
        await step('details-open', () => soak.key('OK'), COND.details, 60);
        await step('details-arrows', () => soak.keys(['DOWN', 'DOWN', 'DOWN', 'UP', 'DOWN', 'UP', 'UP']), COND.details);
        await step('details-back', () => soak.key('BACK'), COND.board, 45);
        await step('discover-open', () => pointerLink('#/discover'), COND.discover);
        await step('discover-items', () => sleep(500), COND.discoverItems, 60);
        await step('discover-arrows', () => soak.keys(['DOWN', 'DOWN', 'RIGHT', 'RIGHT', 'DOWN', 'UP']), COND.discover); // the grid may have two rows only: not above the first (the filters)
        // A movie of the Discover grid (the default catalog is movies): Details with the stream list of the test addon
        // (the probe on demand), and back, one screen at a time.
        for (let i = 0; i < 4 && !(await soak.evaluate(`!!(document.activeElement && document.activeElement.closest('[class*="meta-items-container"] [class*="meta-item-container"]'))`).catch(() => false)); i++) {
            await soak.keys([i % 2 ? 'RIGHT' : 'DOWN'], 500); // from the side bar RIGHT enters the grid
        }
        await step('movie-open', () => soak.key('OK'), COND.details, 60);
        await step('streams-list', () => sleep(500), COND.streams, 90);
        await step('streams-arrows', () => soak.keys(['DOWN', 'DOWN', 'DOWN', 'UP', 'DOWN', 'UP', 'UP', 'UP']), COND.details);
        await sleep(3000);
        await step('streams-back', () => soak.key('BACK'), COND.discover, 45);
        await step('discover-back', () => soak.key('BACK'), COND.board);

        await step('search-open', () => soak.pointerClick('[class*="search-bar-container"]'), COND.search);
        await step('search-results', () => typeInSearch('matrix'), COND.searchResults, 90);
        await step('search-arrows', () => soak.keys(['DOWN', 'RIGHT', 'DOWN', 'UP']), COND.search);
        await step('search-back', () => soak.key('BACK'), COND.board);

    }
    if (ONLY !== 'catalog') {
        await step('library-open', () => pointerLink('#/library'), COND.library);
        await step('calendar-open', () => pointerLink('#/calendar'), COND.calendar);
        await step('addons-open', () => pointerLink('#/addons'), COND.addons);
        await step('addons-arrows', () => soak.keys(['DOWN', 'DOWN', 'DOWN', 'UP']), COND.addons);
        await step('settings-open', () => pointerLink('#/settings'), COND.settings);
        await step('settings-arrows', () => soak.keys(['DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'UP', 'UP', 'UP', 'UP']), COND.settings);

        // The diagnostics screen by the colour keys (F3.6), and back.
        await step('diagnostics-open', () => soak.keys(['RED', 'GREEN', 'YELLOW', 'BLUE'], 500), COND.diagnostics, 30);
        await sleep(3000);
        await step('diagnostics-back', () => soak.key('BACK'), `!/^#\\/webos-diagnostics/.test(location.hash)`, 30);

    }
    if (ONLY !== 'local') {
        // Back to the Board by the pointer, then the pointer over the posters and the wheel; an arrow ends it.
        await step('board-pointer', () => pointerLink('#/'), COND.board);
        await step('pointer-sweep', async () => {
            for (let i = 0; i < 8; i++) {
                const point = await soak.centerOf('[class*="board-content"] [class*="meta-item-container"]', i * 3);
                if (point) { await soak.moveTo(point); await sleep(250); }
            }
            await wheel('[class*="board-content"]', 400);
            await sleep(400);
            await wheel('[class*="board-content"]', -400);
            await soak.key('RIGHT');
        }, COND.board);
    }
    // Back to where the cycle starts: the first poster of the first row (the rows do not keep the old focus).
    await sleep(4000);
}

// ---- run -----------------------------------------------------------------------------------------
log(`install ${path.basename(IPK)}, ${MINUTES} min`);
execFileSync('ares-install', ['-d', process.env.EMU_DEVICE, IPK], { stdio: 'ignore' });
try { execFileSync('ares-launch', ['-d', process.env.EMU_DEVICE, '--close', APP_ID], { stdio: 'ignore' }); } catch (e) { /* not running */ }

const info = path.join(OUT, 'addon.json');
fs.rmSync(info, { force: true });
const addon = spawn('node', [path.join(REPO, 'webos/tests/addon/server.mjs'), '--set', 'e2e', '--host', '10.0.2.2', '--info', info],
    { stdio: ['ignore', fs.openSync(path.join(OUT, 'addon-server.log'), 'w'), 'inherit'] });
process.on('exit', () => addon.kill());
process.on('SIGTERM', () => process.exit(143));
for (let i = 0; i < 100 && !fs.existsSync(info); i++) await sleep(200);
const { manifestUrl } = JSON.parse(fs.readFileSync(info, 'utf8'));

let finished = false;
process.on('exit', (code) => {
    if (finished) return;
    fs.writeFileSync(path.join(OUT, 'soak.json'), `${JSON.stringify({ scenario: 'nav', incomplete: true, exitCode: code, cycles: cycle, restarts: soak.restarts, stats }, null, 2)}\n`);
});

await sleep(6000);
phase('launch');
const launchedAt = Date.now();
await soak.launch();
log(`Board up after ${Math.round((Date.now() - launchedAt) / 1000)} s`);
phase('board-settle');
await sleep(45000);
const installed = await soak.evaluate(`fetch(${JSON.stringify(manifestUrl)}).then(function(r){ return r.json(); }).then(function(manifest){
    window.core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ${JSON.stringify(manifestUrl)}, manifest: manifest, flags: { official: false, protected: false } } } });
    return manifest.id; })`, 60000);
log('addon installed:', installed);
await sleep(8000);
phase('baseline');
await soak.sample('baseline-board');

const runStart = Date.now();
while (minutesSince(runStart) < MINUTES) {
    cycle++;
    const cycleStart = Date.now();
    log(`--- cycle ${cycle} (${Math.round(minutesSince(runStart))} of ${MINUTES} min)`);
    try {
        // --idle: the control run, the same samples with no navigation at all (is it the harness or the app?).
        if (args.idle) await sleep(110000); else await oneCycle();
    } catch (e) {
        log('cycle error', e.message);
        soak.note('cycle-error', { cycle, error: String(e.message).slice(0, 200) });
    }
    await soak.ensure('cycle-end');
    // Same place every time: the Board, quiet.
    if (!(await soak.waitFor(COND.board, 30, 500))) {
        await soak.evaluate("location.hash = '#/'; true").catch(() => {});
        await soak.waitFor(COND.board, 60 * SLOW, 500);
    }
    await sleep(6000);
    phase(`sample-${cycle}`);
    const focus = await soak.evaluate('window.__soak.focus()').catch(() => null);
    await soak.sample(`cycle-${cycle}`, { cycle, focus, cycleSeconds: Math.round((Date.now() - cycleStart) / 1000) });
    if (cycle === 1 && args['worker-heap']) await soak.workerSnapshot('start').then((r) => { if (r.error) log('worker snapshot failed', r.error); }, (e) => log('worker snapshot failed', e.message));
}

phase('final-idle');
await sleep(60000);
await soak.sample('final-idle');
if (args['worker-heap']) await soak.workerSnapshot('end').then((r) => { if (r.error) log('worker snapshot failed', r.error); }, (e) => log('worker snapshot failed', e.message));
phase('end');
const final = await soak.evaluate('JSON.stringify({ hash: location.hash, errors: window.__soak.errors })').then(JSON.parse).catch(() => null);
fs.writeFileSync(path.join(OUT, 'soak.json'), `${JSON.stringify({
    scenario: 'nav', ipk: path.basename(IPK), profile: process.env.EMU_PROFILE || 'normal', instance: process.env.EMU_INSTANCE,
    minutes: Math.round(minutesSince(runStart) * 10) / 10, cycles: cycle, restarts: soak.restarts, stats: {
        ...stats, byName: Object.fromEntries(Object.entries(stats.byName).map(([name, v]) => [name, { runs: v.runs, failed: v.failed, medianMs: v.ms.slice().sort((a, b) => a - b)[v.ms.length >> 1] }])),
    }, final,
}, null, 2)}\n`);
finished = true;
log('done');
process.exit(0);
