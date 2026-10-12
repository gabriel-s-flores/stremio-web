#!/usr/bin/env node
// Evaluates a run of webos/tests/final-url/emulator.sh (F8.1): which URL the <video> got, whether the
// pipeline ever asked the resolver, the times from opening the Player (route) to the `src`, to
// `loadedmetadata` and to `playing`, and the app's log lines. Prints JSON; exit code 1 on a failed check.
//   node evaluate.mjs <output-dir>
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || '.');
const read = (name, fallback) => {
    try {
        return JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8'));
    } catch (_error) {
        return fallback;
    }
};
const scenario = read('scenario.json', {});
const page = read('page.json', { events: [], marks: [] });
const consoleLines = read('console.json', []).map((entry) => entry.text);
const samples = fs.existsSync(path.join(OUT, 'samples.jsonl')) ?
    fs.readFileSync(path.join(OUT, 'samples.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
const serverLines = fs.existsSync(path.join(OUT, 'media-server.log')) ? fs.readFileSync(path.join(OUT, 'media-server.log'), 'utf8').split('\n') : [];

// "<iso> GET /path bytes=0-0 -> 206 0-0"
const requests = serverLines.map((line) => /^(\S+) (GET|HEAD) (\S+) (\S*) -> (\S+)/.exec(line)).filter(Boolean)
    .map((m) => ({ at: Date.parse(m[1]), method: m[2], path: m[3], range: m[4], status: m[5] }));
const isResolverPath = (p) => /^\/(redirect|slow|hang)\//.test(p);
// The first-byte request of the app (resolver and F6.3 check), a probe read (closed range, at most
// 256 KB) and the rest: the pipeline (open range, or none).
const kindOf = (request) => {
    if (request.range === 'bytes=0-0') return 'first-byte';
    const closed = /^bytes=(\d+)-(\d+)$/.exec(request.range);
    if (closed && Number(closed[2]) - Number(closed[1]) + 1 <= 256 * 1024) return 'probe';
    return 'pipeline';
};
// A /slow/ request is logged when it arrives and again (with the inner path) when it is answered.
const answered = requests.filter((request) => request.status !== 'slow' && request.status !== 'hang');

const mark = (name) => (page.marks.filter((entry) => entry.name === name)[0] || { t: null }).t;
const after = (t) => page.events.filter((event) => t !== null && event.t >= t);
const first = (events, name) => events.filter((event) => event.event === name)[0] || null;
const timingsFrom = (t0) => {
    const events = after(t0);
    const src = first(events, 'src');
    const metadata = first(events, 'loadedmetadata');
    const playing = first(events, 'playing');
    const ms = (event) => (event && t0 !== null ? event.t - t0 : null);
    return {
        src: src ? src.url : null,
        srcMs: ms(src),
        loadedmetadataMs: ms(metadata),
        playingMs: ms(playing),
        srcToPlayingMs: src && playing ? playing.t - src.t : null,
        errors: events.filter((event) => event.event === 'error').length,
        networkStates: Array.from(new Set(events.map((event) => event.networkState).filter((state) => state !== undefined))),
    };
};

const openedAt = mark('open');
const switchedAt = mark('switch');
const firstLoad = timingsFrom(openedAt);
const secondLoad = switchedAt !== null ? timingsFrom(switchedAt) : null;
if (secondLoad !== null && firstLoad !== null) {
    // The first load's events stop at the switch.
    const before = page.events.filter((event) => event.t >= openedAt && event.t < switchedAt);
    const src = first(before, 'src');
    const playing = first(before, 'playing');
    firstLoad.playingMs = playing ? playing.t - openedAt : null;
    firstLoad.srcToPlayingMs = src && playing ? playing.t - src.t : null;
}
const finalLog = consoleLines.filter((line) => /final URL/.test(line));
// The app's log line of the final URL and the src that followed it: what the pipeline guard added.
const finalEntries = read('console.json', []).filter((entry) => /final URL/.test(entry.text));
const srcEvents = page.events.filter((event) => event.event === 'src');
const afterFinalUrl = finalEntries.map((entry) => {
    const src = srcEvents.filter((event) => event.t >= entry.t)[0];
    return { resolve: /final URL (\w+) in (\d+) ms/.exec(entry.text).slice(1, 3).join(' '), srcAfterMs: src ? src.t - entry.t : null };
});
const guardLog = consoleLines.filter((line) => /loadedmetadata|no sign of the load|still loading/.test(line));
const lastSample = samples.length ? samples[samples.length - 1].sample : null;
const moved = (label) => samples.some((entry) => entry.label === label && entry.sample && entry.sample.video && entry.sample.video.currentTime > 1);
const errorLayer = samples.some((entry) => entry.sample && entry.sample.errorLayer);

const finalOf = (url) => (url || '').replace(/\/slow\/\d+\//, '/').replace('/redirect/', '/');
const resolverHits = requests.filter((request) => request.status !== 'slow' && request.status !== 'hang' && isResolverPath(request.path) && request.status === '302');
const resolverHitsBy = (kind) => resolverHits.filter((request) => kindOf(request) === kind).length;
const probeReads = answered.filter((request) => kindOf(request) === 'probe' && !isResolverPath(request.path));
const probeBytes = probeReads.reduce((sum, request) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(request.range);
    return sum + (m ? Number(m[2]) - Number(m[1]) + 1 : 0);
}, 0);

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
const name = scenario.scenario;
const playsFirst = () => check('the video plays (currentTime > 1 s, no error layer)', moved('first') && !errorLayer, lastSample);

if (name === 'redirect' || name === 'slow-redirect' || name === 'rate-probe' || name === 'rate-noprobe' || name === 'switch') {
    check('the <video> got the final URL', firstLoad.src === finalOf(scenario.url), { src: firstLoad.src, expected: finalOf(scenario.url) });
    check('the pipeline never asked the resolver (its only 302 answered the first-byte request)', resolverHitsBy('pipeline') === 0 && resolverHitsBy('first-byte') >= 1,
        { firstByte: resolverHitsBy('first-byte'), probe: resolverHitsBy('probe'), pipeline: resolverHitsBy('pipeline') });
    check('one request to the resolver for the load and the Player probe', resolverHits.length === 1 + (secondLoad ? 1 : 0), resolverHits.map((request) => request.path + ' ' + request.range));
    playsFirst();
}
if (name === 'slow-redirect') {
    check('the app waited for the slow 302 (final URL redirect in ≥ 3000 ms)', finalLog.some((line) => /final URL redirect in (\d+) ms/.test(line) && Number(/in (\d+) ms/.exec(line)[1]) >= 2900), finalLog);
}
if (name === 'slow-timeout') {
    check('past the 5 s: the <video> got the original link', firstLoad.src === scenario.url, { src: firstLoad.src });
    check('the log says timeout', finalLog.some((line) => /final URL timeout in 5\d\d\d ms/.test(line)), finalLog);
    playsFirst();
}
if (name === 'direct') {
    check('a link without redirect is played as it is', firstLoad.src === scenario.url, { src: firstLoad.src });
    check('the log says direct', finalLog.some((line) => /final URL direct/.test(line)), finalLog);
    playsFirst();
}
if (name === 'off') {
    check('webos.player.finalUrl = off: the <video> got the resolver link (as before F8.1)', firstLoad.src === scenario.url, { src: firstLoad.src });
    check('no final URL request in the log', finalLog.length === 0, finalLog);
    playsFirst();
}
if (name === 'slow-load') {
    check('the file came slowly and the load went on: metadata after more than 60 s, no error', firstLoad.loadedmetadataMs !== null &&
        firstLoad.loadedmetadataMs - firstLoad.srcMs > 60000 && !errorLayer && firstLoad.errors === 0,
        { srcMs: firstLoad.srcMs, loadedmetadataMs: firstLoad.loadedmetadataMs, errorLayer, errors: firstLoad.errors });
    check('the guard waited because the element was still loading', guardLog.some((line) => /still loading/.test(line)), guardLog);
}
if (name === 'switch') {
    check('the second stream got its final URL too', secondLoad && secondLoad.src === finalOf(scenario.second), { src: secondLoad && secondLoad.src });
}

const result = {
    scenario: name,
    url: scenario.url,
    rateMbps: scenario.rateMbps,
    timings: { first: firstLoad, second: secondLoad },
    resolver: { firstByte: resolverHitsBy('first-byte'), probe: resolverHitsBy('probe'), pipeline: resolverHitsBy('pipeline') },
    probe: { reads: probeReads.length, bytes: probeBytes, blocked: page.events.filter((event) => event.event === 'probe-blocked').length },
    pipelineRequests: answered.filter((request) => kindOf(request) === 'pipeline').map((request) => ({ path: request.path, range: request.range, status: request.status })),
    log: { finalUrl: finalLog, guard: guardLog },
    afterFinalUrl,
    checks,
    ok: checks.every((entry) => entry.ok),
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
