#!/usr/bin/env node
// Evaluates the output of webos/tests/player/switches.sh (F5.6) and exits non-zero on failure.
//   node switches-evaluate.mjs <output-dir> [on|off]
// With the guard off (the A/B run) the checks are reported the same way; the exit code then says
// whether that build managed the 6 loads.
import fs from 'node:fs';
import path from 'node:path';

const [dir, guard = 'on'] = process.argv.slice(2);
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
const loads = read('loads.jsonl').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const page = JSON.parse(read('page.json'));
const serverLog = read('media-server.log');

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

// Pipelines that fetched each file: the pipeline's own GET has no Range (the header probe of F5.4
// asks for ranges, and a seek would too).
const pipelineGets = (file) => serverLog.split('\n').filter((line) => new RegExp(`GET /${file.replace(/\./g, '\\.')}  -> 200`).test(line)).length;

// dmesg after each load (switches.sh): the uMediaServer process dying is the emulator's, not the app's.
const systemLog = fs.existsSync(path.join(dir, 'system.log')) ? read('system.log') : '';
const umsDownFrom = (() => {
    const sections = systemLog.split(/^== load /m).slice(1);
    const index = sections.findIndex((section) => /umediaserver main process ended/.test(section));
    return index === -1 ? null : Number(sections[index].split(' ')[0]);
})();

// The kernel's OOM killer (1 GB VM without swap): it kills the app's page, which WebAppMgr reloads.
const oomFrom = (() => {
    const sections = systemLog.split(/^== load /m).slice(1);
    const index = sections.findIndex((section) => /out of memory|killed process|oom-killer|oom_reaper|\[ *pid *\] *uid/i.test(section));
    return index === -1 ? null : Number(sections[index].split(' ')[0]);
})();

const perLoad = loads.map((load) => {
    const played = load.msToPlay !== null && load.after && load.after.video && load.after.video.src === load.file &&
        load.after.video.currentTime > (load.atPlay && load.atPlay.video ? load.atPlay.video.currentTime : 0) + 2;
    return {
        i: load.i,
        file: load.file,
        way: load.way,
        msToPlay: load.msToPlay,
        played: !!played,
        currentTime: load.after && load.after.video ? load.after.video.currentTime : null,
        video: load.after && load.after.video ? load.after.video.n : null,
        pipelineGets: pipelineGets(load.file),
        wedged: !!(load.pipelines && load.pipelines.wedged),
        errorLayer: !!(load.after && load.after.errorLayer),
    };
});

check('6 loads were made (5 stream switches)', loads.length === 6, loads.map((load) => load.way));
check('every load plays (video moving 4 s after the start)', perLoad.every((load) => load.played),
    perLoad.map((load) => `${load.i} ${load.way} ${load.file}: ${load.played ? `${load.msToPlay} ms` : 'did not play'}`));
check('the uMediaServer stayed up (dmesg)', umsDownFrom === null, umsDownFrom === null ? null : `down at load ${umsDownFrom}`);
check('no process killed for memory (dmesg OOM)', oomFrom === null, oomFrom === null ? null : `OOM by load ${oomFrom}`);
check('no wedged pipeline in the emulator after any load', perLoad.every((load) => !load.wedged),
    perLoad.filter((load) => load.wedged).map((load) => load.i));
// Both ways remount the Player (a new <video> per load). The previous one has to release its pipeline
// (emptied) before the new one starts loading: two pipelines never overlap.
const firstEvent = (video, name, after) => page.events.filter((e) => e.video === video && e.event === name && e.t >= after)[0] || null;
const order = perLoad.slice(1).map((load) => {
    const previous = perLoad[load.i - 1];
    const started = load.video === null ? null : firstEvent(load.video, 'loadstart', 0);
    const previousStart = previous.video === null ? null : firstEvent(previous.video, 'loadstart', 0);
    const released = previousStart ? firstEvent(previous.video, 'emptied', previousStart.t) : null;
    return { i: load.i, way: load.way, video: load.video, previousVideo: previous.video,
        releasedAt: released ? released.t : null, loadstartAt: started ? started.t : null };
});
check('a new <video> per load (the Player remounts on both ways of switching)', perLoad.every((load, i) => load.video === i),
    perLoad.map((load) => `${load.i} ${load.way}: video #${load.video}`));
const releasedFirst = order.every((o) => o.releasedAt !== null && o.loadstartAt !== null && o.releasedAt <= o.loadstartAt);
if (guard === 'on') {
    check('the previous pipeline is released before the next load starts', releasedFirst, order);
    check('one pipeline per load (one GET without Range per stream)', perLoad.every((load) => load.pipelineGets === 1),
        perLoad.map((load) => `${load.file}: ${load.pipelineGets}`));
    // The guard logs each start (webos/lib/player/withPipelineGuard.js).
    const starts = page.console.filter((line) => /\[webos\] player: loadedmetadata/.test(line.text));
    check('the pipeline guard is active (its start log, with the dropped load() call)', starts.length === loads.length &&
        starts.every((line) => /repeated load\(\) calls dropped: [1-9]/.test(line.text)), starts.map((line) => line.text));
    // A stream that does not start ends in the Player's error screen, not in an endless spinner.
    const stuck = perLoad.filter((load) => !load.played);
    check('a load that does not play ends in the error screen', stuck.every((load) => load.errorLayer), stuck.map((load) => load.i));
}
// F5.5 review: the selectTrack WebOsVideo sends 500 ms after a subtitle choice made right before
// leaving the Player must not reach the next stream's pipeline, nor this stream's once released. (On
// webOS a <video> taken out of its place has its mediaId cleared at once; then the call carries an
// empty id and reaches no pipeline. With the guard the node stays in place and the id is kept.)
if (fs.existsSync(path.join(dir, 'subtitles-load.txt'))) {
    const at = Number(read('subtitles-load.txt'));
    const load = perLoad[at];
    const next = perLoad[at + 1] || null;
    const idsOf = (video) => page.events.filter((e) => e.video === video && e.mediaId && e.mediaId !== '<invalid mediaId>').map((e) => e.mediaId);
    const ownIds = idsOf(load.video);
    const nextIds = next ? idsOf(next.video) : [];
    const chosen = (page.marks || []).filter((mark) => mark.name === 'subtitles chosen')[0] || null;
    const released = chosen ? page.events.filter((e) => e.video === load.video && e.event === 'emptied' && e.t >= chosen.t)[0] || null : null;
    const selects = chosen ? (page.luna || []).filter((call) => call.method === 'selectTrack' && call.t >= chosen.t) : [];
    check('a subtitle chosen right before leaving: its selectTrack reaches neither the next stream nor a released pipeline',
        chosen !== null && selects.length > 0 && selects.every((call) => nextIds.indexOf(call.mediaId) === -1 &&
            (ownIds.indexOf(call.mediaId) === -1 || (released !== null && call.t <= released.t))),
        { chosenAt: chosen && chosen.t, ownMediaIds: ownIds, nextMediaIds: nextIds, releasedAt: released && released.t, selectTrack: selects });
}
check('no uncaught page errors', page.errors.length === 0, page.errors);
const reloads = fs.existsSync(path.join(dir, 'reloads.jsonl')) ? read('reloads.jsonl').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).i) : [];
check('the page never reloaded during the test', reloads.length === 0, reloads);

const ok = checks.every((c) => c.ok);
// "inconclusive (emulator)" only when the emulator broke first: an OOM kill, the uMediaServer down or
// a page reload at or before the first load that failed. A wedged pipeline by itself is not one: with
// the guard on and none of those, it is the app's failure (and, with the guard off, the very bug).
const firstFailure = perLoad.filter((load) => !load.played || load.wedged).map((load) => load.i)[0];
const firstBreak = [umsDownFrom, oomFrom].concat(reloads).filter((i) => i !== null && i !== undefined).sort((a, b) => a - b)[0];
const emulatorBroken = !ok && firstBreak !== undefined && (firstFailure === undefined || firstBreak <= firstFailure);
const verdict = ok ? 'pass' : emulatorBroken ? 'inconclusive (emulator)' : 'fail';
console.log(JSON.stringify({ ok, verdict, guard, loads: perLoad, order, checks }, null, 2));
process.exit(ok ? 0 : 1);
