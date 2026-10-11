#!/usr/bin/env node
// End-to-end run of the port in the emulator (F6.4): Board (Cinemeta) → a movie → Details → the
// streams of a debrid-like addon, ordered and labelled for the C8 (F6.2) → play → audio track (F5.4)
// and subtitles (F5.5) → seek → Back → another stream (switch, F5.6) → an expired link and its error
// screen (F6.3) → Back to the Board. The app is driven with the remote only (remote.mjs). cdp.mjs
// observes (focus, list, Player state, screenshots) and does the setup: installing the test addon in
// the guest profile (no account), as the Addons screen does. When a step cannot be done with the
// remote (the Player controls have no focus yet: F5.7), the run says so in a check and does that one
// action with a click through CDP, so the rest of the run still happens; those actions are listed in
// results.json (`fallbacks`).
//
//   webos/tools/emu-run --timeout 15 -- node webos/tests/e2e/run.mjs <out>
//   webos/tools/emu-run --timeout 30 --profile c8 -- node webos/tests/e2e/run.mjs <out>
//
// Needs the IPK (`pnpm webos:package`, or IPK=<file>) and the media (webos/tests/e2e/make-media.sh).
// Environment: BOOT_SETTLE_S (seconds to wait after the Board before the first media: the boot
// memory peak, default 30, 60 in the c8 profile), PLAY_WAIT_S (default 75: longer than the 60 s
// watchdog of F5.6), RIGHT_STEPS (posters to move right on the Board before OK, default 1).
// Output in <out>: results.json (checks), steps.json (time and memory per step), summary.md, run.log,
// screenshots (NN-*.png from the page, vm-*.png from the VM screen, which has the video plane),
// mem.log (WebAppMgr memory in the VM, once a second), console.json, luna.json, addon-server.log.
// Exit code 1 when a check failed.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../..');
const rules = require('../../lib/c8-rules');
const ranking = require('../../lib/stream-ranking');
const { probe } = require('../../lib/header-probe');
const { bufferReadRange } = require('../../lib/header-probe/test/replay');
const { buildAudioTracks, chooseAudioTrack, trackIndex } = require('../../lib/tracks');
const { E2E_STREAMS, fileNameOf } = require('../addon/catalog.js');

const OUT = path.resolve(process.argv[2] || 'e2e-out');
const { EMU_CDP_PORT, EMU_REMOTE_PORT, EMU_DEVICE, EMU_INSTANCE, EMU_SSH_PORT } = process.env;
const PROFILE = process.env.EMU_PROFILE || 'normal';
const APP_ID = 'io.github.gabrielsflores.stremio';
const BOOT_SETTLE_S = Number(process.env.BOOT_SETTLE_S || (PROFILE === 'c8' ? 60 : 30));
const PLAY_WAIT_S = Number(process.env.PLAY_WAIT_S || 75);
const RIGHT_STEPS = Number(process.env.RIGHT_STEPS || 1);
const SLOW = PROFILE === 'c8' ? 2 : 1;
if (!EMU_CDP_PORT || !EMU_REMOTE_PORT || !EMU_DEVICE) {
    console.error('run inside webos/tools/emu-run');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const T0 = Date.now();
const since = () => Date.now() - T0;
const logFile = path.join(OUT, 'run.log');
const log = (line) => {
    const text = `[${new Date().toISOString().slice(11, 23)} +${(since() / 1000).toFixed(1)}s] ${line}`;
    process.stdout.write(`${text}\n`);
    fs.appendFileSync(logFile, `${text}\n`);
};
const writeJson = (file, data) => fs.writeFileSync(path.join(OUT, file), JSON.stringify(data, null, 2));

// ---- tools ----------------------------------------------------------------------------------
const cdp = (...args) => spawnSync('node', [path.join(ROOT, 'webos/tools/cdp.mjs'), '--port', EMU_CDP_PORT, '--timeout', '20000', ...args], { encoding: 'utf8' });
const evaluate = (expression) => (cdp('eval', expression).stdout || '').trim().split('\n').pop() || '';
const json = (expression) => {
    try {
        return JSON.parse(evaluate(expression));
    } catch (_error) {
        return null;
    }
};
const SSH = ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '-o', 'HostKeyAlgorithms=+ssh-rsa',
    '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'BatchMode=yes', '-i', path.join(process.env.HOME, 'webos-tv-sdk/run/ares_webos_emul'),
    '-p', String(EMU_SSH_PORT), 'developer@127.0.0.1'];
const ssh = (command) => (spawnSync('ssh', [...SSH, command], { encoding: 'utf8', timeout: 15000 }).stdout || '').trim();

const shot = (name) => {
    cdp('screenshot', path.join(OUT, `${name}.png`));
    log(`screenshot ${name}.png`);
};
const vmShot = (name) => {
    spawnSync(path.join(ROOT, 'webos/tools/emulator-qemu.sh'), ['-i', String(EMU_INSTANCE), 'screenshot', path.join(OUT, `vm-${name}.png`)], { encoding: 'utf8' });
    log(`screenshot vm-${name}.png`);
};

// ---- checks and steps -----------------------------------------------------------------------
const results = [];
const fallbacks = [];
const events = [];
let currentStep = 'setup';
// area: who owns what a failure points at (the task that made the feature, or "emulator").
const check = (name, ok, detail, area) => {
    results.push({ step: currentStep, name, ok: !!ok, area: area || null, detail });
    log(`${ok ? 'PASS' : 'FAIL'} [${currentStep}] ${name} ${JSON.stringify(detail === undefined ? null : detail).slice(0, 400)}`);
    writeJson('results.json', { profile: PROFILE, results, fallbacks, events });
    return !!ok;
};
const fallback = (what, why) => {
    fallbacks.push({ step: currentStep, what, why, at: since() });
    log(`FALLBACK (CDP) [${currentStep}] ${what}: ${why}`);
};

const steps = [];
const step = async (name, run) => {
    currentStep = name;
    const started = since();
    log(`=== ${name}`);
    let error = null;
    try {
        await run();
    } catch (caught) {
        error = String(caught && caught.stack || caught);
        check('no exception in the step', false, error);
    }
    const memory = json('window.__e2e ? window.__e2e.memory() : "null"');
    steps.push({ name, startMs: started, endMs: since(), ms: since() - started, jsHeap: memory, error });
    writeJson('steps.json', steps);
};

// ---- in-page helpers ------------------------------------------------------------------------
const HELPERS = [
    'webos/tests/streams/page.js',
    'webos/tests/player/page.js',
    'webos/tests/navigation/metadetails/page.js',
    'webos/tests/e2e/page.js',
].map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'));
let installedAt = null;
// The helpers live in the page: a reload (the renderer killed by OOM, WebAppMgr relaunching it)
// drops them. Every observation goes through here, so a reload is noticed and recorded.
const ensureHelpers = () => {
    const current = evaluate('window.__e2e ? String(window.__e2e.installedAt) : ""');
    if (current !== '' && current === installedAt) return true;
    if (installedAt !== null) {
        events.push({ at: since(), step: currentStep, event: 'page reloaded (helpers gone)', hash: evaluate('location.hash') });
        log(`EVENT page reloaded during ${currentStep}`);
    }
    HELPERS.forEach((source) => evaluate(source));
    installedAt = evaluate('window.__e2e ? String(window.__e2e.installedAt) : ""') || null;
    return installedAt !== null;
};
const active = () => {
    ensureHelpers();
    return json('window.__e2e.active()') || { kind: 'unknown' };
};
const focus41 = () => json('window.__f41c ? window.__f41c.focus() : "null"') || { kind: 'unknown' };
const list = () => json('JSON.stringify(window.__f62 ? window.__f62.list() : [])') || [];
const playerState = () => json('window.__e2e ? window.__e2e.player() : "null"');

let keys = 0;
const key = async (name, wait = 900) => {
    keys++;
    spawnSync('node', [path.join(ROOT, 'webos/tools/remote.mjs'), '--port', EMU_REMOTE_PORT, '--delay', '0', name]);
    await sleep(wait * SLOW);
    const focused = active();
    log(`key ${name.padEnd(5)} -> ${focused.kind || focused.tag || ''} "${(focused.text || '').slice(0, 50)}" ${focused.row ? `row "${focused.row}" ` : ''}${(focused.hash || '').slice(0, 50)}`);
    return focused;
};
const waitFor = async (expression, seconds) => {
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
        if (evaluate(expression) === 'true') return true;
        await sleep(500);
    }
    return false;
};

// ---- the expected list (same libraries, same files) -----------------------------------------
const testFiles = E2E_STREAMS.filter((entry) => !entry.infoHash).map(fileNameOf);
const idOfFile = (file) => (E2E_STREAMS.filter((entry) => fileNameOf(entry) === file)[0] || { id: `?${file}` }).id;
const isTestItem = (item) => testFiles.indexOf(item.file) !== -1;
const ids = (items) => items.filter(isTestItem).map((item) => idOfFile(item.file));
const fileOf = (id) => fileNameOf(E2E_STREAMS.filter((entry) => entry.id === id)[0]);
const expectedOrder = async (addonInfo, shown) => {
    const readRange = (file) => (offset, length) => {
        const fd = fs.openSync(file, 'r');
        try {
            const size = fs.fstatSync(fd).size;
            const end = Math.min(offset + length, size);
            const data = Buffer.alloc(Math.max(0, end - offset));
            if (data.length > 0) fs.readSync(fd, data, 0, data.length, offset);
            return Promise.resolve({ data: new Uint8Array(data.buffer, data.byteOffset, data.length), size });
        } finally {
            fs.closeSync(fd);
        }
    };
    const { toStreams } = require('../addon/catalog.js');
    const streams = toStreams(addonInfo.mediaUrl, 'e2e').filter((stream) => !stream.infoHash);
    const entryOf = (stream) => E2E_STREAMS.filter((entry) => entry.description === stream.description)[0];
    const probes = new Map();
    for (const stream of streams) {
        const entry = entryOf(stream);
        const item = shown.filter((candidate) => candidate.file === fileNameOf(entry))[0];
        // Only the items the app had probed at that moment (data-c8-source="probe").
        if (item && item.source === 'probe' && !entry.path) {
            probes.set(stream.url, await probe(readRange(path.join(addonInfo.dir, entry.media)), ranking.LIST_PROBE_OPTIONS));
        }
    }
    const ranked = ranking.createRanker({ rules }).rank(streams, { probeOf: (stream) => probes.get(stream.url) || null });
    return ranked.map((entry) => entryOf(entry.stream).id);
};

// The initial audio track the Player must pick for the MKV: the same libraries over the same file,
// with the audio language of the profile (as webos/tests/player/tracks-evaluate.mjs).
const expectedInitialTrack = async () => {
    const entry = E2E_STREAMS.filter((candidate) => candidate.id === 'e2e-multi-subs')[0];
    const fileProbe = await probe(bufferReadRange(new Uint8Array(fs.readFileSync(path.join(addonInfo.dir, entry.media)))));
    const language = evaluate('window.core.getState("ctx").then(function(ctx){ return ctx.profile.settings.audioLanguage || "eng"; })') || 'eng';
    const tracks = buildAudioTracks({ probe: fileProbe, rules: rules.evaluate({ probe: fileProbe }), elementTracks: [], selectedIndex: null });
    const chosen = chooseAudioTrack({ tracks, probe: fileProbe, stream: null, languages: [language] });
    return { id: chosen ? chosen.id : null, language };
};

// ---- the run ---------------------------------------------------------------------------------
let addonInfo = null;
let addonServer = null;
let memorySampler = null;
let guestOffsetS = 0;
let chosenTitle = null;
let boardFocus = null;
const AUDIO_ICON = (() => {
    const source = fs.readFileSync(require.resolve('@stremio/stremio-icons/react', { paths: [ROOT] }), 'utf8');
    const match = /'audio-tracks': \{ viewBox: "[^"]*", paths: \[\{ d: "([^"]+)"/.exec(source) || /"audio-tracks": \{ viewBox: "[^"]*", paths: \[\{ d: "([^"]+)"/.exec(source);
    return match ? match[1] : null;
})();
const SUBTITLES_ICON = (() => {
    const source = fs.readFileSync(require.resolve('@stremio/stremio-icons/react', { paths: [ROOT] }), 'utf8');
    const match = / subtitles: \{ viewBox: "[^"]*", paths: \[\{ d: "([^"]+)"/.exec(source);
    return match ? match[1] : null;
})();

// Memory of the web processes in the VM, once a second: "<guest epoch> <MemAvailable kB> <name>:<pid>:<VmRSS kB>..."
const SAMPLER = `while true; do
  a=$(grep MemAvailable /proc/meminfo | tr -s " " | cut -d" " -f2); top=""
  for s in /proc/[0-9]*/status; do
    n=$(sed -n "s/^Name:\\t//p" "$s" 2>/dev/null); case "$n" in WebAppMgr*|*chrom*|*render*|wam*) ;; *) continue;; esac
    k=$(sed -n "s/^VmRSS:[^0-9]*\\([0-9]*\\).*/\\1/p" "$s" 2>/dev/null); [ -n "$k" ] || continue
    p=\${s#/proc/}; top="$top $n:\${p%/status}:$k"
  done
  echo "$(date +%s) $a$top"; sleep 1
done`;

const memoryOf = (startMs, endMs) => {
    const lines = fs.existsSync(path.join(OUT, 'mem.log')) ? fs.readFileSync(path.join(OUT, 'mem.log'), 'utf8').trim().split('\n') : [];
    const from = Math.floor((T0 + startMs) / 1000) + guestOffsetS;
    const to = Math.ceil((T0 + endMs) / 1000) + guestOffsetS;
    let maxRss = 0;
    let minAvailable = Infinity;
    let samples = 0;
    lines.forEach((line) => {
        const [epoch, available, ...processes] = line.trim().split(/\s+/);
        if (Number(epoch) < from || Number(epoch) > to) return;
        samples++;
        minAvailable = Math.min(minAvailable, Number(available));
        processes.forEach((entry) => {
            const rss = Number(entry.split(':')[2]);
            if (rss > maxRss) maxRss = rss;
        });
    });
    return samples === 0 ? null : { samples, webAppMgrMaxMB: Math.round(maxRss / 1024), memAvailableMinMB: Math.round(minAvailable / 1024) };
};

const setup = async () => {
    const info = path.join(OUT, 'addon.json');
    fs.rmSync(info, { force: true });
    addonServer = spawn('node', [path.join(ROOT, 'webos/tests/addon/server.mjs'), '--set', 'e2e', '--host', '10.0.2.2', '--info', info],
        { stdio: ['ignore', fs.openSync(path.join(OUT, 'addon-server.log'), 'w'), fs.openSync(path.join(OUT, 'addon-server.err'), 'w')] });
    for (let i = 0; i < 50 && !fs.existsSync(info); i++) await sleep(200);
    addonInfo = JSON.parse(fs.readFileSync(info, 'utf8'));
    const warnings = fs.readFileSync(path.join(OUT, 'addon-server.err'), 'utf8');
    check('the e2e media exist (webos/tests/e2e/make-media.sh)', !/ausentes/.test(warnings), warnings.trim() || null);
    const guestNow = Number(ssh('date +%s'));
    guestOffsetS = guestNow ? guestNow - Math.round(Date.now() / 1000) : 0;
    memorySampler = spawn('ssh', [...SSH, SAMPLER], { stdio: ['ignore', fs.openSync(path.join(OUT, 'mem.log'), 'w'), 'ignore'] });
    const ipk = process.env.IPK || fs.readdirSync(path.join(ROOT, 'dist-webos')).filter((file) => file.endsWith('.ipk')).map((file) => path.join(ROOT, 'dist-webos', file))[0];
    log(`profile ${PROFILE}, ipk ${ipk}, addon ${addonInfo.manifestUrl}, guest clock offset ${guestOffsetS}s`);
    spawnSync('ares-install', ['-d', EMU_DEVICE, ipk], { stdio: 'inherit' });
};

const boot = async () => {
    const launched = since();
    spawnSync('ares-launch', ['-d', EMU_DEVICE, APP_ID], { stdio: 'inherit' });
    const board = await waitFor('!!window.core && document.querySelectorAll("[class*=meta-item-container]").length > 0', 180 * SLOW);
    const ms = since() - launched;
    check('the Board shows Cinemeta catalogs (guest, no account)', board, { msFromLaunch: ms }, 'boot');
    ensureHelpers();
    // Setup through CDP, as the Addons screen does with the URL (no account): recorded here.
    evaluate(`window.__f62.install('${addonInfo.manifestUrl}')`);
    const installed = await waitFor('!!window.__f62.installed', 15);
    const addons = json('window.core.getState("ctx").then(function(ctx){ return JSON.stringify(ctx.profile.addons.map(function(a){ return a.manifest.name; })); })');
    const auth = evaluate('window.core.getState("ctx").then(function(ctx){ return String(!!ctx.profile.auth); })');
    check('test addon installed by its URL in the guest profile (setup through CDP)', installed && (addons || []).indexOf('Debrid de teste') !== -1 && auth === 'false', { addons, auth }, 'setup');
    shot('00-board');
    log(`waiting ${BOOT_SETTLE_S} s for the boot memory peak before the first navigation`);
    await sleep(BOOT_SETTLE_S * 1000);
};

const chooseTitle = async () => {
    // DOWN from the page into the rows; past series rows until a movie poster has the focus (UP
    // once the last row is reached: the focus does not move).
    let focused = active();
    let direction = 'DOWN';
    for (let i = 0; i < 10; i++) {
        const previous = focused.href;
        focused = await key(direction);
        if (/^#\/detail\/movie\//.test(focused.href || '')) break;
        if (focused.href && focused.href === previous) direction = 'UP';
    }
    for (let i = 0; i < RIGHT_STEPS && /^#\/detail\/movie\//.test(focused.href || ''); i++) focused = await key('RIGHT');
    check('Board: the remote reaches a movie poster of a Cinemeta row', /^#\/detail\/movie\//.test(focused.href || '') && focused.focusVisible, focused, 'F4.1a');
    boardFocus = focused;
    chosenTitle = focused.text;
    shot('01-board-focus');
    await key('OK', 2000);
    const opened = await waitFor('/#\\/detail\\/movie\\//.test(location.hash)', 30 * SLOW);
    check('OK opens the details of the chosen title', opened && evaluate('location.hash').indexOf(focused.href.slice(1)) !== -1, { title: chosenTitle, hash: evaluate('location.hash') }, 'F4.1a');
};

let listShown = null;
const streamsList = async () => {
    const shown = await waitFor('window.__f62.list().some(function(i){ return /Filme\\.2023/.test(i.file); })', 60 * SLOW);
    check('the streams of the debrid-like addon show up', shown, evaluate('window.__f62.list().length'), 'F6.2');
    for (let i = 0; i < 20 && focus41().kind !== 'list-panel'; i++) await sleep(500);
    const focused = focus41();
    check('initial focus on the streams list panel (F4.1c)', focused.kind === 'list-panel' && focused.focusVisible, focused, 'F4.1c');
    // The top probes start 1 s after the list settles (local files: a few ms each).
    await sleep(6000 * SLOW);
    listShown = list();
    writeJson('lista.json', listShown);
    shot('02-details-streams');
    const expected = await expectedOrder(addonInfo, listShown);
    check('the list order is the C8 one (same libraries, same probes)', JSON.stringify(ids(listShown)) === JSON.stringify(expected), { shown: ids(listShown), expected }, 'F6.2');
    check('the torrent (infoHash) is hidden (F6.1)', !listShown.some((item) => /👤/.test(item.file || '') || /P2P/.test(item.name || '')), listShown.map((item) => item.name), 'F6.1');
    const byId = (id) => listShown.filter((item) => item.file === fileOf(id))[0] || {};
    const remux = byId('e2e-remux-dv-p5-truehd');
    check('labels: HDR10 on the 4K HEVC; the DV P5 + TrueHD REMUX warned and moved from 1st to last',
        (byId('e2e-uhd-hdr10').labels || []).join() === 'HDR10' && /DV P5: cores erradas/.test((remux.labels || []).join()) && /TrueHD/.test((remux.labels || []).join()) &&
        ids(listShown)[ids(listShown).length - 1] === 'e2e-remux-dv-p5-truehd',
        listShown.filter(isTestItem).map((item) => ({ id: idOfFile(item.file), tier: item.tier, source: item.source, labels: item.labels })), 'F6.2');
    const layout = json('window.__e2e.layout("[class*=streams-container] [class*=stream-container], [class*=c8-labels] span")') || [];
    writeJson('layout-lista.json', layout);
    const items = layout.filter((entry) => /stream-container/.test(entry.cls));
    const chips = layout.filter((entry) => !/stream-container/.test(entry.cls));
    check('zoom 1.75: the first list items and their C8 labels inside the screen (the rest scrolls), labels ≥ 18 px on screen, none clipped',
        items.length > 0 && items.every(inWidth) && items.slice(0, 3).every((entry) => entry.inScreen) && chips.length > 0 &&
        chips.every((entry) => inWidth(entry) && entry.fontPx >= 18 && !entry.clipped) && chips.filter((entry) => entry.box[1] < 1080).every((entry) => entry.inScreen),
        { items: items.slice(0, 5).map((entry) => entry.box), chips: chips.map((entry) => ({ text: entry.text, box: entry.box, fontPx: entry.fontPx, clipped: entry.clipped })) }, 'F2.6/F6.2');
};

// Within the screen width (lists scroll vertically, never sideways).
const inWidth = (entry) => entry.box[0] >= 0 && entry.box[0] + entry.box[2] <= 1921;

// DOWN/UP on the remote until the list item of `file` has the focus. Returns true when it got there.
const focusStream = async (file) => {
    for (let i = 0; i < 24; i++) {
        const items = list();
        const target = items.map((item) => item.file).indexOf(file);
        const current = items.map((item) => item.focused).indexOf(true);
        if (target === -1) return false;
        if (current === target) return true;
        await key(current === -1 || current < target ? 'DOWN' : 'UP', 700);
    }
    return false;
};

const waitPlaying = async (seconds) => {
    const started = since();
    const samples = [];
    while (since() - started < seconds * 1000) {
        const sample = playerState();
        if (sample) samples.push({ ms: since() - started, video: sample.video, error: sample.errorLayer });
        if (sample && sample.video && sample.video.readyState >= 3 && sample.video.currentTime > 0.5 && !sample.video.paused) {
            return { ok: true, ms: since() - started, samples };
        }
        if (sample && sample.errorLayer) return { ok: false, ms: since() - started, samples, errorLayer: sample.errorLayer };
        await sleep(1000);
    }
    return { ok: false, ms: since() - started, samples };
};
const pipelines = () => ssh('echo $(pgrep starfish-media)').split(/\s+/).filter(Boolean).length;

let played = null;
const play = async () => {
    let focused = await key('DOWN');
    check('DOWN from the panel enters the first stream (F4.1c)', focused.cls && /stream-container/.test(focused.cls), focused, 'F4.1c');
    const reached = await focusStream(fileOf('e2e-multi-subs'));
    check('the remote reaches the MKV with several audio tracks and subtitles', reached, active(), 'F4.1c');
    played = evaluate('document.activeElement && document.activeElement.getAttribute("href")');
    shot('03-stream-focused');
    await key('OK', 1500);
    const result = await waitPlaying(PLAY_WAIT_S);
    writeJson('play-1.json', result);
    check('OK plays the stream (first media of the boot)', result.ok, { msToPlay: result.ms, last: result.samples[result.samples.length - 1], pipelines: pipelines() }, 'F5.1/emulator');
    vmShot('04-playing');
    await sleep(2000);
};

// Tries a remote route to an element: the keys in order until `reachedExpression` is true.
const remoteRoute = async (keysToTry, reachedExpression) => {
    for (const name of keysToTry) {
        if (evaluate(reachedExpression) === 'true') return true;
        await key(name, 700);
    }
    return evaluate(reachedExpression) === 'true';
};

// Walks the focus to the element of `selector` with the arrows, each one toward where it is on
// screen (window.__e2e.direction); a DOWN first when nothing has the focus. Gives up after
// `maxKeys` or when an arrow does not move the focus.
const remoteTo = async (selector, maxKeys = 14) => {
    let last = null;
    for (let i = 0; i < maxKeys; i++) {
        const direction = evaluate(`window.__e2e.direction(${JSON.stringify(selector)})`);
        if (direction === 'HERE') return true;
        const name = direction === 'null' ? 'DOWN' : direction;
        const focused = await key(name, 700);
        const now = `${focused.cls}|${focused.text}`;
        if (direction !== 'null' && now === last) return false;
        last = now;
    }
    return evaluate(`window.__e2e.direction(${JSON.stringify(selector)})`) === 'HERE';
};

const audioTrack = async () => {
    const before = playerState();
    // The remote in the Player: the arrows are the upstream shortcuts (LEFT/RIGHT seek, UP/DOWN
    // volume) and nothing gives a control bar button the focus: OK, then the arrows that do not seek.
    const reached = await remoteRoute(['OK', 'DOWN', 'UP'], '(function(){ var a = document.activeElement; return !!a && !!a.closest(\'[class*="control-bar-container"]\'); })()');
    check('the remote reaches the Player control bar (audio button)', reached, active(), 'F5.7');
    if (!reached) fallback('open the audio menu with a click', 'the Player controls take no focus from the remote (F5.7)');
    evaluate(`window.__e2e.clickControl(${JSON.stringify(AUDIO_ICON)})`);
    await sleep(1500);
    let state = playerState();
    check('the audio menu lists the 3 tracks of the file with language (probe, F5.4)', state.audioMenu && state.audioMenu.length === 3, state.audioMenu, 'F5.4');
    const initial = (state.audioTracks || []).map((track, index) => (track.enabled ? index : -1)).filter((index) => index !== -1);
    const expected = await expectedInitialTrack();
    check(`initial audio track = the C8 rules over the file with the audio language (${expected.language}): ${expected.id}`,
        JSON.stringify(initial) === JSON.stringify([trackIndex(expected.id)]) &&
        (state.audioMenu || []).filter((entry) => entry.selected).map((entry) => entry.id).join() === expected.id,
        { enabled: initial, expected, menu: state.audioMenu }, 'F5.3/F5.4');
    shot('05-audio-menu');
    vmShot('05-audio-menu');
    const layout = json('window.__e2e.layout("[class*=audio-menu], [class*=audio-menu] [data-id], [class*=audio-menu] [class*=header]")') || [];
    writeJson('layout-menu-audio.json', layout);
    check('zoom 1.75: the audio menu and its 3 options inside the screen, text ≥ 18 px on screen, not clipped',
        layout.length === 5 && layout.every((entry) => entry.inScreen && !entry.clipped) && layout.slice(1).every((entry) => entry.fontPx >= 18), layout, 'F2.6/F5.4');
    // Inside the open menu the arrows are not shortcuts (menus open): the spatial navigation.
    const inMenu = await remoteTo('[class*=audio-menu] [data-id=EMBEDDED_1]');
    check('the remote moves inside the audio menu to the Portuguese track', inMenu, active(), 'F5.7');
    if (inMenu) {
        await key('OK', 1500);
    } else {
        fallback('choose the Portuguese track with a click', 'no remote focus inside the audio menu');
        evaluate('window.__e2e.clickSelector("[class*=audio-menu] [data-id=EMBEDDED_1]")');
    }
    const times = [];
    for (let i = 0; i < 4; i++) {
        await sleep(1000);
        state = playerState();
        times.push(state && state.video ? state.video.currentTime : null);
    }
    const enabled = (state.audioTracks || []).map((track, index) => (track.enabled ? index : -1)).filter((index) => index !== -1);
    check('after the choice only the Portuguese track is enabled and the video keeps playing', JSON.stringify(enabled) === '[1]' && times[3] > times[0], { enabled, times, before: before && before.audioTracks }, 'F5.4');
    check('the audio menu marks the Portuguese track as selected', (state.audioMenu || []).filter((entry) => entry.selected).map((entry) => entry.id).join() === 'EMBEDDED_1', state.audioMenu, 'F5.4');
    // Back closes the menu (the overlays of the back dispatcher, F3.2).
    await key('BACK', 1200);
    // The menu fades out (slow in the c8 profile).
    await waitFor('!document.querySelector("[class*=audio-menu]")', 6 * SLOW);
    state = playerState();
    check('Back closes the audio menu and stays in the Player', !state.audioMenu && /#\/player\//.test(state.hash), { hash: state.hash }, 'F3.2');
};

const subtitles = async () => {
    fallback('open the subtitles menu with a click', 'the Player controls take no focus from the remote (F5.7)');
    evaluate(`window.__e2e.clickControl(${JSON.stringify(SUBTITLES_ICON)})`);
    await sleep(1500);
    let state = playerState();
    const menu = state.subtitlesMenu || { languages: [], variants: [] };
    const lunaCalls = json('JSON.stringify(window.__f51.luna.filter(function(c){ return /ubtitle|selectTrack/.test(c.method || ""); }).map(function(c){ return { method: c.method, parameters: c.parameters }; }))') || [];
    check('subtitles menu: eng/por listed, English chosen by the Player (settings: eng)',
        ['eng', 'por'].every((lang) => menu.languages.some((entry) => entry.lang === lang)) && menu.languages.filter((entry) => entry.selected).map((entry) => entry.lang).join() === 'eng',
        menu, 'F5.5');
    check('embedded English through Luna (setSubtitleEnable true, selectTrack text index 0)',
        lunaCalls.some((call) => call.method === 'setSubtitleEnable' && call.parameters && call.parameters.enable === true) &&
        lunaCalls.some((call) => call.method === 'selectTrack' && call.parameters && call.parameters.type === 'text' && call.parameters.index === 0),
        lunaCalls, 'F5.5');
    shot('06-subtitles-menu');
    const layout = json('window.__e2e.layout("[class*=subtitles-menu-container], [class*=subtitles-menu-container] [class*=language-option], [class*=subtitles-menu-container] [class*=variant-option]")') || [];
    writeJson('layout-menu-legendas.json', layout);
    // The language and variant lists scroll: what must be on screen is the menu, every option's width
    // and the selected ones.
    check('zoom 1.75: the subtitles menu inside the screen, options within its width, the selected ones visible, text ≥ 18 px on screen',
        layout.length > 1 && layout[0].inScreen && layout.every((entry) => inWidth(entry) && !entry.clipped) &&
        layout.slice(1).every((entry) => entry.fontPx >= 18) && layout.filter((entry) => /selected/.test(entry.cls)).every((entry) => entry.inScreen),
        { menu: layout[0], selected: layout.filter((entry) => /selected/.test(entry.cls)), options: layout.length - 1 }, 'F2.6/F5.5');
    // The add-on English subtitle (attached to the stream: an "exclusive" variant), drawn in the overlay.
    evaluate('(function(){ var o = Array.prototype.filter.call(document.querySelectorAll("[class*=subtitles-menu-container] [class*=variant-option]"), function(v){ return /xclusiv/i.test(v.textContent); })[0]; if (o) o.setAttribute("data-e2e-target", "addon-variant"); return !!o; })()');
    const inMenu = await remoteTo('[data-e2e-target=addon-variant]');
    check('the remote moves inside the subtitles menu to the add-on variant', inMenu, active(), 'F5.7');
    if (inMenu) {
        await key('OK', 1500);
    } else {
        fallback('choose the add-on subtitle with a click', 'no remote focus inside the subtitles menu');
        evaluate('window.__e2e.clickVariant("EXCLUSIVE|xclusiv")');
    }
    await sleep(1500);
    state = playerState();
    const variant = ((state.subtitlesMenu || { variants: [] }).variants.filter((entry) => entry.selected)[0]) || null;
    await key('BACK', 1200);
    const overlay = [];
    for (let i = 0; i < 5; i++) {
        state = playerState();
        overlay.push(state && state.overlay ? state.overlay.text : null);
        if (i === 2) {
            shot('07-addon-subtitle');
            vmShot('07-addon-subtitle');
        }
        await sleep(1000);
    }
    const enables = (json('JSON.stringify(window.__f51.luna.filter(function(c){ return c.method === "setSubtitleEnable"; }).map(function(c){ return c.parameters.enable; }))') || []);
    check('add-on subtitle chosen: drawn in the HTML overlay ("ADDON EN n"), pipeline subtitles off',
        variant && /xclusiv/i.test(variant.origin || '') && overlay.some((textShown) => /^ADDON EN \d+$/.test((textShown || '').trim())) && enables[enables.length - 1] === false,
        { variant, overlay, enables }, 'F5.5');
};

const seek = async () => {
    const settings = json('window.core.getState("ctx").then(function(ctx){ return JSON.stringify({ seek: ctx.profile.settings.seekTimeDuration, short: ctx.profile.settings.seekShortTimeDuration }); })') || {};
    const seekS = (settings.seek || 10000) / 1000;
    let state = playerState();
    if (!check('still in the Player with the video (it did not end or close)', state && state.video && /#\/player\//.test(state.hash), state && { hash: state.hash, video: state.video }, 'run')) return;
    const before = state.video.currentTime;
    const started = Date.now();
    await key('RIGHT', 300);
    await key('RIGHT', 300);
    await sleep(3000);
    state = playerState();
    const elapsed = (Date.now() - started) / 1000;
    const forward = state.video.currentTime - before;
    // Two presses ask for 2 x seekS; the check asks for at least one step beyond the time that went
    // by (in the c8 profile the pipeline lags: about 13 s net was measured for 20 s asked).
    check(`RIGHT x2 seeks forward (at least ${seekS} s beyond the playback; ${2 * seekS} s asked)`, forward - elapsed >= 0.9 * seekS && !state.video.paused,
        { before, after: state.video.currentTime, elapsed, seekS, netJump: Math.round((forward - elapsed) * 10) / 10 }, 'F5.7');
    const middle = state.video.currentTime;
    await key('LEFT', 300);
    await sleep(3000);
    state = playerState();
    check(`LEFT seeks back ${seekS} s`, state.video.currentTime < middle + 3 - 0.5 * seekS && state.video.readyState >= 2,
        { before: middle, after: state.video.currentTime }, 'F5.7');
    vmShot('08-after-seek');
};

const backToList = async (expectedHref, label) => {
    await key('BACK', 2500);
    await waitFor('/#\\/detail\\//.test(location.hash)', 20 * SLOW);
    let focused = focus41();
    for (let i = 0; i < 20 && focused.kind !== 'stream'; i++) {
        await sleep(500);
        focused = focus41();
    }
    const href = evaluate('document.activeElement && document.activeElement.getAttribute("href")');
    focused.pointer = evaluate('window.__f41c ? window.__f41c.pointer() : null');
    check(`Back from the ${label} returns to the details with the focus on the stream played (F4.1c)`, focused.kind === 'stream' && href === expectedHref,
        { focused, href }, 'F4.1c/F3.2');
};

const switchStream = async () => {
    await backToList(played, 'Player');
    shot('09-back-to-list');
    const reached = await focusStream(fileOf('e2e-fhd-h264-aac'));
    check('the remote reaches the 1080p H.264 AAC stream', reached, active(), 'F4.1c');
    const href = evaluate('document.activeElement && document.activeElement.getAttribute("href")');
    const before = pipelines();
    await key('OK', 1500);
    const result = await waitPlaying(PLAY_WAIT_S);
    writeJson('play-2.json', result);
    const after = pipelines();
    check('another stream plays after the first one (switch, F5.6)', result.ok,
        { msToPlay: result.ms, last: result.samples[result.samples.length - 1], errorLayer: result.errorLayer || null, pipelinesBefore: before, pipelinesAfter: after }, 'F5.6/emulator');
    vmShot('10-second-stream');
    await sleep(2000);
    await backToList(href, 'second stream');
};

const expired = async () => {
    const reached = await focusStream(fileOf('e2e-expired'));
    check('the remote reaches the stream whose link expired', reached, active(), 'F4.1c');
    const href = evaluate('document.activeElement && document.activeElement.getAttribute("href")');
    await key('OK', 1500);
    let layer = null;
    for (let i = 0; i < 45 * SLOW; i++) {
        const state = playerState();
        layer = state && state.errorLayer;
        if (layer && layer.hint) break;
        await sleep(1000);
    }
    check('an expired link shows the debrid error screen: expired (HTTP 410), with the hint', layer && layer.kind === 'expired' && /410/.test(layer.label || '') && !!layer.hint, layer, 'F6.3');
    shot('11-expired-link');
    await backToList(href, 'error screen');
};

const backToBoard = async () => {
    let focused = await key('BACK', 3000);
    for (let i = 0; i < 20 && !(focused.href && /^#\/detail\/movie\//.test(focused.href)); i++) {
        await sleep(500);
        focused = active();
    }
    const hash = evaluate('location.hash');
    check('Back from the details goes to the Board, focus on the poster opened (F4.1a)', (hash === '#/' || hash === '') && focused.href === boardFocus.href,
        { hash, focused: { text: focused.text, href: focused.href, row: focused.row }, opened: boardFocus.href }, 'F4.1a/F3.2');
    shot('12-back-to-board');
};

const finish = () => {
    const consoleLog = json('JSON.stringify(window.__f51 ? window.__f51.console : [])') || [];
    const luna = json('JSON.stringify(window.__f51 ? { luna: window.__f51.luna, errors: window.__f51.errors } : null)');
    fs.writeFileSync(path.join(OUT, 'console.json'), JSON.stringify(consoleLog, null, 1));
    writeJson('luna.json', luna);
    const errors = ((luna && luna.errors) || []).concat(consoleLog.filter((entry) => entry.level === 'error'));
    // The Player logs its critical error once: the expired link of the run (code 83 on webOS).
    const playerErrors = errors.filter((entry) => /^Player \{"code":\d+/.test(entry.text || ''));
    const others = errors.filter((entry) => playerErrors.indexOf(entry) === -1);
    check('no page errors in the console (besides the Player error of the expired link)', others.length === 0 && playerErrors.length <= 1,
        { others: others.slice(0, 10), player: playerErrors }, 'all');
    const subscribe = ((luna && luna.luna) || []).filter((call) => /com\.webos\.media/.test(call.uri) && (call.method === 'subscribe' || call.subscribe));
    check('the app never subscribes to com.webos.media (D3a)', subscribe.length === 0, subscribe, 'F5.1');
    check('no page reload during the run (renderer killed by OOM)', events.filter((event) => /reloaded/.test(event.event)).length === 0, events, 'F7.x/emulator');
};

const summary = () => {
    steps.forEach((entry) => {
        entry.vm = memoryOf(entry.startMs, entry.endMs);
    });
    writeJson('steps.json', steps);
    const failed = results.filter((result) => !result.ok);
    const lines = [
        `# Ponta a ponta (F6.4) — perfil ${PROFILE}`,
        '',
        `${results.length - failed.length}/${results.length} checagens passaram; ${keys} teclas do controle; ${fallbacks.length} ações por CDP (fallback); título: ${chosenTitle || '-'}`,
        '',
        '| Etapa | Duração (s) | Heap JS (MB) | WebAppMgr máx. (MB) | MemAvailable mín. (MB) | Checagens |',
        '|---|---|---|---|---|---|',
        ...steps.map((entry) => {
            const own = results.filter((result) => result.step === entry.name);
            return `| ${entry.name} | ${(entry.ms / 1000).toFixed(1)} | ${entry.jsHeap ? entry.jsHeap.usedMB : '-'} | ${entry.vm ? entry.vm.webAppMgrMaxMB : '-'} | ${entry.vm ? entry.vm.memAvailableMinMB : '-'} | ${own.filter((result) => result.ok).length}/${own.length} |`;
        }),
        '',
        '## Falhas',
        '',
        ...(failed.length ? failed.map((result) => `- [${result.step}] ${result.name} (${result.area || '-'})`) : ['- nenhuma']),
        '',
        '## Ações por CDP fora da preparação',
        '',
        ...(fallbacks.length ? fallbacks.map((entry) => `- [${entry.step}] ${entry.what}: ${entry.why}`) : ['- nenhuma']),
        '',
        '## Eventos',
        '',
        ...(events.length ? events.map((event) => `- +${(event.at / 1000).toFixed(1)} s [${event.step}] ${event.event} ${event.hash || ''}`) : ['- nenhum']),
        '',
    ];
    fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n'));
    return failed.length;
};

(async () => {
    let failed = 1;
    try {
        await step('setup', setup);
        await step('boot', boot);
        await step('board', chooseTitle);
        await step('details', streamsList);
        await step('play', play);
        await step('audio', audioTrack);
        await step('subtitles', subtitles);
        await step('seek', seek);
        await step('switch', switchStream);
        await step('expired', expired);
        await step('back-to-board', backToBoard);
        currentStep = 'end';
        finish();
    } finally {
        failed = summary();
        if (memorySampler) memorySampler.kill();
        if (addonServer) addonServer.kill('SIGTERM');
        fs.copyFileSync(path.join(OUT, 'addon-server.log'), path.join(OUT, 'addon-server.log.txt'));
        log(`${results.length - failed}/${results.length} passed`);
    }
    process.exit(failed > 0 ? 1 : 0);
})();
