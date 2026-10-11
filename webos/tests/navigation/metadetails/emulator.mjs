#!/usr/bin/env node
// F4.1c in the emulator: the details page (MetaDetails) walked with the remote only (remote.mjs),
// with the local test addon (webos/tests/addon) for the streams. cdp.mjs only observes (focus,
// order, screenshots) and does the setup (installing the addon; opening the series page, see below).
// Every step is checked and written to <out>/results.json; screenshots and the page errors go next
// to it. Run inside a pool reservation, after `pnpm webos:package` (or IPK=<file>):
//   webos/tools/emu-run --timeout 15 -- node webos/tests/navigation/metadetails/emulator.mjs <out> walk
//   webos/tools/emu-run --timeout 15 -- node webos/tests/navigation/metadetails/emulator.mjs <out> player
//   webos/tools/emu-run --timeout 20 --profile c8 -- node webos/tests/navigation/metadetails/emulator.mjs <out> restore
// walk: a movie opened from the Board (initial focus, the list, the column, the summary, a cast link
//   and Back), a series (episodes, seasons, an episode's streams and Back to the episodes, the
//   library toggle) and the Magic Remote pointer (QEMU's mouse through QMP: no focus stolen).
// restore: review c1, M1. A genre/cast link of a movie, OK (Discover or Search unmount the page),
//   Back: the focus must come back to the link however long the column takes to load (6.4 s in the
//   C8 profile), with a timeline of the focus and the placeholders. Twice. Meant for --profile c8.
// player: a stream of the kit (plays in the emulator) opened from the list, the audio menu of the
//   Player (opened with a click, the Player controls are not part of this task) and Back to the
//   list: the focus must come back to the stream. One media scenario per boot.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../../..');
const OUT = path.resolve(process.argv[2] || 'metadetails-out');
const MODE = process.argv[3] || 'walk';
const { EMU_CDP_PORT, EMU_REMOTE_PORT, EMU_DEVICE } = process.env;
const QMP = process.env.EMU_QMP || process.env.WEBOS_QMP;
const APP_ID = 'io.github.gabrielsflores.stremio';
const SERIES = process.env.SERIES || 'tt0903747';
if (!EMU_CDP_PORT || !EMU_REMOTE_PORT || !EMU_DEVICE) {
    console.error('run inside webos/tools/emu-run');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logFile = path.join(OUT, 'run.log');
const log = (line) => {
    const text = `[${new Date().toISOString().slice(11, 23)}] ${line}`;
    console.log(text);
    fs.appendFileSync(logFile, `${text}\n`);
};

const cdp = (...args) => spawnSync('node', [path.join(ROOT, 'webos/tools/cdp.mjs'), '--port', EMU_CDP_PORT, ...args], { encoding: 'utf8' });
const evaluate = (expression) => (cdp('eval', expression).stdout || '').trim().split('\n').pop();
const json = (expression) => {
    try {
        return JSON.parse(evaluate(expression));
    } catch (_error) {
        return null;
    }
};
const focus = () => json('window.__f41c ? window.__f41c.focus() : "null"') || { kind: 'unknown' };
const shot = (name) => {
    cdp('screenshot', path.join(OUT, `${name}.png`));
    log(`screenshot ${name}.png`);
};

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    return !!ok;
};

// One remote key, then the focus once the page settled.
const key = async (name, wait = 800) => {
    spawnSync('node', [path.join(ROOT, 'webos/tools/remote.mjs'), '--port', EMU_REMOTE_PORT, '--delay', '0', name]);
    await sleep(wait);
    const focused = focus();
    log(`${name.padEnd(5)} -> ${focused.kind} ${focused.index >= 0 ? `#${focused.index} ` : ''}"${focused.text || ''}" ${focused.section || ''} ${focused.hash || ''}`);
    return focused;
};

const waitFor = async (expression, seconds = 30) => {
    for (let i = 0; i < seconds * 2; i++) {
        if (evaluate(expression) === 'true') return true;
        await sleep(500);
    }
    return false;
};

// QEMU's tablet (usb-tablet) through QMP, in pixels of the 1920x1080 screen (the F1.6/F4.2 mouse).
const qmp = (command) => spawnSync('python3', [path.join(ROOT, 'webos/tools/qmp.py'), 'raw', JSON.stringify(command)], { encoding: 'utf8', env: { ...process.env, WEBOS_QMP: QMP } });
const mouseMove = (x, y) => qmp({
    execute: 'input-send-event',
    arguments: { events: [
        { type: 'abs', data: { axis: 'x', value: Math.round(x * 32767 / 1920) } },
        { type: 'abs', data: { axis: 'y', value: Math.round(y * 32767 / 1080) } },
    ] },
});
const mouseButton = (down) => qmp({ execute: 'input-send-event', arguments: { events: [{ type: 'btn', data: { button: 'left', down } }] } });

const setup = async () => {
    const info = path.join(OUT, 'addon.json');
    fs.rmSync(info, { force: true });
    const server = spawn('node', [path.join(ROOT, 'webos/tests/addon/server.mjs'), '--host', '10.0.2.2', '--info', info], { stdio: ['ignore', fs.openSync(path.join(OUT, 'addon-server.log'), 'w'), 'inherit'] });
    process.on('exit', () => server.kill());
    for (let i = 0; i < 50 && !fs.existsSync(info); i++) await sleep(200);
    const { manifestUrl } = JSON.parse(fs.readFileSync(info, 'utf8'));
    const ipk = process.env.IPK || fs.readdirSync(path.join(ROOT, 'dist-webos')).filter((file) => file.endsWith('.ipk')).map((file) => path.join(ROOT, 'dist-webos', file))[0];
    log(`ipk ${ipk}`);
    spawnSync('ares-install', ['-d', EMU_DEVICE, ipk], { stdio: 'inherit' });
    spawnSync('ares-launch', ['-d', EMU_DEVICE, APP_ID], { stdio: 'inherit' });
    const board = await waitFor('!!window.core && document.querySelectorAll("[class*=meta-item-container]").length > 0', 120);
    check('setup: Board with catalogs', board, null);
    evaluate(fs.readFileSync(path.join(HERE, 'page.js'), 'utf8'));
    evaluate(fs.readFileSync(path.join(ROOT, 'webos/tests/streams/page.js'), 'utf8'));
    evaluate(`window.__f62.install('${manifestUrl}')`);
    check('setup: test addon installed', await waitFor('!!window.__f62.installed', 10), manifestUrl);
};

// From the Board with the remote: DOWN until a poster has the focus, OK.
const openMovieFromBoard = async () => {
    for (let i = 0; i < 6; i++) {
        await key('DOWN');
        if (evaluate('/meta-item-link/.test(String(document.activeElement && document.activeElement.className))') === 'true') break;
    }
    await key('OK', 1500);
    const opened = await waitFor('/#\\/detail\\/movie\\//.test(location.hash) && JSON.parse(window.__f41c.counts()).items > 0', 40);
    check('movie: details opened from the Board with OK, streams listed', opened, evaluate('location.hash'));
    for (let i = 0; i < 16 && focus().kind !== 'list-panel'; i++) await sleep(500);
};

const walk = async () => {
    await openMovieFromBoard();
    let focused = focus();
    check('movie: initial focus on the streams list panel (not a stream: the C8 order stays free)', focused.kind === 'list-panel' && focused.focusVisible, focused);
    shot('01-movie-initial');

    focused = await key('DOWN');
    check('movie: DOWN enters the first stream', focused.kind === 'stream' && focused.index === 0, focused);
    const order = evaluate('window.__f41c.order()');
    let moves = true;
    for (let i = 1; i <= 4; i++) {
        focused = await key('DOWN');
        moves = moves && focused.index === i && focused.inView;
    }
    check('movie: DOWN x4, one stream per press, in view (the list scrolls)', moves && focused.scrollTop > 0, focused);
    shot('02-movie-list-down');
    moves = true;
    for (let i = 3; i >= 0; i--) {
        focused = await key('UP');
        moves = moves && focused.index === i && focused.inView;
    }
    check('movie: UP x4, one stream per press (was two with the top-aligned scrolling)', moves, focused);
    focused = await key('RIGHT');
    check('movie: RIGHT on a stream stays (did jump to the addon filter)', focused.kind === 'stream' && focused.index === 0, focused);
    focused = await key('LEFT');
    check('movie: LEFT goes to the column (first action button)', focused.section === 'meta' && focused.kind === 'action', focused);
    shot('03-movie-trailer-ring');
    const row = [];
    for (let i = 0; i < 8 && focused.section === 'meta'; i++) {
        focused = await key('RIGHT');
        row.push(focused.kind);
    }
    check('movie: RIGHT along the action row, then back to the stream focused before', focused.kind === 'stream' && focused.index === 0 && row.includes('toggle'), row);
    focused = await key('LEFT');
    check('movie: LEFT comes back to the column element focused before', focused.section === 'meta' && focused.kind === 'action', focused);
    const visited = [];
    let summary = null;
    let previous = null;
    let stuck = 0;
    for (let i = 0; i < 16 && stuck < 2; i++) {
        focused = await key('UP');
        visited.push(focused.kind);
        if (focused.kind === 'summary' && summary === null) {
            summary = focused;
            shot('04-movie-summary');
        }
        stuck = previous !== null && JSON.stringify(previous.rect) === JSON.stringify(focused.rect) && previous.text === focused.text ? stuck + 1 : 0;
        previous = focused;
    }
    check('movie: the summary is reached with UP from the buttons and scrolled into view', summary !== null && summary.inView, summary);
    check('movie: UP to the top of the column never leaves it for the list', !visited.includes('stream') && focused.section === 'meta', visited);
    // The top may be the IMDb button (an external link, F3.4): the first genre or cast link below it.
    for (let i = 0; i < 3 && focused.kind !== 'link'; i++) focused = await key('DOWN');
    shot('05-movie-column-top');
    check('movie: the order of the list did not change after the first key (F6.2 freeze)', evaluate('window.__f41c.order()') === order, null);

    // A cast/genre link opens Search or Discover (the page unmounts); Back remounts it with the focus.
    const link = focused.text;
    await key('OK', 3000);
    const left = evaluate('location.hash');
    focused = await key('BACK', 3000);
    for (let i = 0; i < 10 && focused.kind !== 'link'; i++) {
        await sleep(500);
        focused = focus();
    }
    check('movie: OK on a link and Back: the link has the focus again', /search|discover/.test(left) && focused.kind === 'link' && focused.text === link, { left, focused });

    // The series page (setup: opened through the hash, the Board rows have no fixed series).
    evaluate(`(location.hash = '#/detail/series/${SERIES}', 1)`);
    await waitFor('JSON.parse(window.__f41c.counts()).items > 0', 40);
    for (let i = 0; i < 10 && focus().kind !== 'episode'; i++) await sleep(500);
    focused = focus();
    check('series: initial focus on the selected or first episode', focused.kind === 'episode' && focused.index === 0, focused);
    shot('06-series-initial');
    moves = true;
    for (let i = 1; i <= 3; i++) {
        focused = await key('DOWN');
        moves = moves && focused.index === i && focused.inView;
    }
    for (let i = 2; i >= 0; i--) {
        focused = await key('UP');
        moves = moves && focused.index === i && focused.inView;
    }
    check('series: episodes DOWN x3 and UP x3, one per press, in view', moves, focused);
    focused = await key('UP');
    const keyboard = evaluate('String(window.PalmSystem && PalmSystem.isKeyboardVisible)');
    check('series: UP from the first episode lands on the episode search field (the system keyboard opens: F3.4)', focused.kind === 'input', { focused, keyboard });
    await key('BACK');
    focused = await key('UP');
    check('series: Back closes the keyboard and UP goes on to the seasons bar', focused.section === 'list' && focused.kind !== 'input', focused);
    for (let i = 0; i < 3 && focused.kind !== 'season-button'; i++) focused = await key('RIGHT');
    check('series: RIGHT reaches the next season button', focused.kind === 'season-button', focused);
    focused = await key('OK', 2000);
    check('series: OK changes the season, the focus stays on the button', /season=2/.test(focused.hash) && focused.kind === 'season-button', focused);
    shot('07-series-season-2');
    await key('DOWN');
    await key('BACK');
    await key('DOWN');
    focused = await key('DOWN');
    check('series: down to the second episode of the season', focused.kind === 'episode' && focused.index === 1, focused);
    const episode = focused.text;
    await key('OK', 2000);
    await waitFor('JSON.parse(window.__f41c.counts()).items > 0', 30);
    for (let i = 0; i < 10 && focus().kind !== 'list-panel'; i++) await sleep(500);
    focused = focus();
    check("series: OK on the episode opens its streams, focus on the list panel", /%3A2%3A2/.test(focused.hash) && focused.kind === 'list-panel', focused);
    shot('08-episode-streams');
    focused = await key('UP');
    check('series: UP from the panel goes to the list header (back button)', focused.kind === 'list-back', focused);
    shot('09-episode-list-back-ring');
    focused = await key('DOWN');
    check('series: DOWN from the header enters the first stream', focused.kind === 'stream' && focused.index === 0, focused);
    focused = await key('BACK', 2000);
    check('series: Back goes back to the episodes, focus on the episode opened', focused.kind === 'episode' && focused.text === episode, focused);
    shot('10-series-back-to-episode');

    focused = await key('LEFT');
    for (let i = 0; i < 4 && focused.kind !== 'toggle'; i++) focused = await key('RIGHT');
    const before = evaluate('window.__f41c.libraryIcon()');
    focused = await key('OK', 1500);
    const after = evaluate('window.__f41c.libraryIcon()');
    check('series: OK on the library toggle (a div with only onClick) toggles it', focused.kind === 'toggle' && before !== after, focused);
    shot('11-series-library-toggled');
    await key('OK', 1500);
    check('series: OK again toggles it back', evaluate('window.__f41c.libraryIcon()') === before, null);

    // The Magic Remote pointer: a click on the next season button with QEMU's mouse.
    const next = json('JSON.stringify((function(){ var b = document.querySelector("[class*=next-season-button]"); var r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())');
    const season = evaluate('location.hash');
    mouseMove(next[0] - 40, next[1] + 40);
    await sleep(800);
    mouseMove(next[0], next[1]);
    await sleep(800);
    mouseButton(true);
    await sleep(120);
    mouseButton(false);
    await sleep(2500);
    focused = focus();
    check('pointer: a click with the mouse works (season changed) and no focus is forced while the pointer shows', evaluate('location.hash') !== season && (focused.kind === 'body' || focused.kind === 'season-button'), { pointer: evaluate('window.__f41c.pointer()'), focused, hash: evaluate('location.hash') });
    shot('12-pointer-click');
    focused = await key('DOWN');
    check('pointer: an arrow hides the pointer and the remote takes over from the page', focused.section === 'list' && evaluate('window.__f41c.pointer()') !== 'visible', { focused, pointer: evaluate('window.__f41c.pointer()') });
};

const restoreRun = async () => {
    await openMovieFromBoard();
    for (let round = 1; round <= 2; round++) {
        let focused = await key('LEFT');
        for (let i = 0; i < 16 && !(focused.kind === 'link' && /#\/(discover|search)/.test(evaluate('document.activeElement.getAttribute("href")'))); i++) {
            focused = await key('UP');
        }
        const link = focused.text;
        check(`restore ${round}: a genre/cast link has the focus`, focused.kind === 'link', focused);
        await key('OK', 1500);
        const left = evaluate('location.hash');
        await waitFor('!/#\\/detail\\//.test(location.hash)', 30);
        await sleep(1500);
        spawnSync('node', [path.join(ROOT, 'webos/tools/remote.mjs'), '--port', EMU_REMOTE_PORT, '--delay', '0', 'BACK']);
        const timeline = [];
        const started = Date.now();
        let restored = null;
        while (Date.now() - started < 20000) {
            const sample = json('JSON.stringify({ f: JSON.parse(window.__f41c.focus()), p: document.querySelectorAll(".route-container:last-child [class*=metadetails-container] [class*=placeholder]").length })');
            if (sample) {
                timeline.push({ ms: Date.now() - started, kind: sample.f.kind, text: sample.f.text, placeholders: sample.p });
                if (sample.f.kind === 'link' && sample.f.text === link) {
                    restored = sample.f;
                    break;
                }
            }
            await sleep(250);
        }
        fs.writeFileSync(path.join(OUT, `restore-${round}-timeline.json`), JSON.stringify(timeline, null, 1));
        const firstFocus = timeline.filter((entry) => entry.kind !== 'body' && entry.kind !== 'unknown')[0] || null;
        log(`restore ${round}: left for ${left.slice(0, 60)}; first focus ${JSON.stringify(firstFocus)}; restored at ${restored ? timeline[timeline.length - 1].ms : '-'} ms; column placeholder until ${Math.max(0, ...timeline.filter((entry) => entry.placeholders > 0).map((entry) => entry.ms))} ms`);
        check(`restore ${round}: Back from ${/discover/.test(left) ? 'Discover' : 'Search'}, the link "${link}" has the focus again, with the ring`, restored !== null && restored.focusVisible, { restored, samples: timeline.length });
        shot(`restore-${round}-after-back`);
    }
};

const player = async () => {
    await openMovieFromBoard();
    let focused = await key('DOWN');
    // Tested in the page: the item's text has line breaks (evaluate keeps the last line of the output).
    const onMulti = () => evaluate('/H264\\.MULTI\\.AC3/.test(document.activeElement.textContent)') === 'true';
    for (let i = 0; i < 16 && !onMulti(); i++) focused = await key('DOWN');
    const stream = evaluate('document.activeElement.getAttribute("href")');
    check('player: DOWN to the kit stream with several audio tracks (t2_multi.mkv)', focused.kind === 'stream' && onMulti(), focused);
    shot('01-stream-focused');
    await key('OK', 2000);
    const playing = await waitFor('/#\\/player\\//.test(location.hash) && !!document.querySelector("video") && document.querySelector("video").currentTime > 1', 60);
    check('player: OK plays the stream', playing, evaluate('location.hash').slice(0, 60));
    // The audio menu by its keyboard shortcut (A), with the control bar shown by a pointer move.
    evaluate('(function(){ var c = document.querySelector("[class*=player-container]"); if (c) c.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 960, clientY: 900 })); document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", bubbles: true, cancelable: true })); return 1; })()');
    await sleep(1500);
    const menu = evaluate('(function(){ var m = document.querySelector("[class*=audio-menu]"); return m ? m.textContent.replace(/\\s+/g, " ").slice(0, 200) : "none"; })()');
    check('player: the audio menu of F5.4 opens (capture for the zoom check)', menu !== 'none', menu);
    shot('02-player-audio-menu');
    log(`audio menu: ${menu}`);
    // Back closes the menu (when it opened), then Back leaves the Player.
    if (menu !== 'none') await key('BACK', 1200);
    focused = await key('BACK', 3000);
    for (let i = 0; i < 10 && focused.kind !== 'stream'; i++) {
        await sleep(500);
        focused = focus();
    }
    check('player: Back from the Player, the focus comes back to the stream played', focused.kind === 'stream' && evaluate('document.activeElement.getAttribute("href")') === stream, focused);
    shot('03-back-from-player');
};

(async () => {
    try {
        await setup();
        if (MODE === 'player') await player();
        else if (MODE === 'restore') await restoreRun();
        else await walk();
    } catch (error) {
        check('no exception in the scenario', false, String(error && error.stack || error));
    }
    fs.writeFileSync(path.join(OUT, 'page-errors.json'), evaluate('JSON.stringify(window.__f41c ? window.__f41c.errors : null)') || 'null');
    const failed = results.filter((result) => !result.ok);
    log(`${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length > 0 ? 1 : 0);
})();
