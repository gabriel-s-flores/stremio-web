#!/usr/bin/env node
// Do the memory jumps of the renderer coincide with bursts of some thread? (F7.1 experiment for the OOM.)
// Input: mem.log (the app renderer's RSS) and threads.log (CPU ticks of its threads by name, PERF_THREADS=1 of
// mem-sampler.sh), both stamped with the host clock, and optionally phases.jsonl.
//   node thread-bursts.mjs <mem.log> <threads.log> [phases.jsonl] [--jump 60]
// A jump is an interval between two samples in which the app's RSS grows by more than --jump MB (default 60). For
// each jump it prints the RSS before/after, the CPU seconds each thread name used in that interval and in the
// 10 s before it, and at the end the share of each thread in the jump windows against all the other windows.
// Native memory (V8 compilation zone, GC, decoders) shows up as a burst of the thread that allocates it; a JS-heap
// leak would not coincide with one. It cannot tell the owner of the memory by itself: it narrows the suspects.
import fs from 'node:fs';

const args = process.argv.slice(2);
const jumpIndex = args.indexOf('--jump');
const JUMP_MB = jumpIndex >= 0 ? Number(args.splice(jumpIndex, 2)[1]) : 60;
const [memFile, threadsFile, phasesFile] = args;
if (!memFile || !threadsFile) {
    console.error('usage: thread-bursts.mjs <mem.log> <threads.log> [phases.jsonl] [--jump MB]');
    process.exit(2);
}
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
const phases = phasesFile && fs.existsSync(phasesFile) ? lines(phasesFile).map((l) => JSON.parse(l)) : [];
const phaseAt = (t) => phases.reduce((n, p) => (p.t <= t ? p.name : n), '');
const t0 = phases.length ? phases[0].t : 0;

// RSS of the app renderer (the WebAppMgr that did not exist before the first phase, with the most RSS).
const mem = lines(memFile).map((l) => {
    const p = l.split(' ');
    return { t: Number(p[0]), procs: p.slice(2).map((i) => i.split(':')) };
});
const baseline = new Set(mem.filter((s) => s.t < t0).flatMap((s) => s.procs.map((q) => q[1])));
const rss = mem.filter((s) => s.t >= t0).map((s) => {
    let best = 0;
    for (const q of s.procs) if (q[0] === 'WebAppMgr' && !baseline.has(q[1]) && Number(q[2]) > best) best = Number(q[2]);
    return { t: s.t, mb: best / 1024 };
}).filter((s) => s.mb > 0);

const threads = lines(threadsFile).map((l) => {
    const p = l.split(' ');
    const t = {};
    for (const i of p.slice(1)) { const [name, ticks] = i.split(':'); t[name] = Number(ticks); }
    return { t: Number(p[0]), ticks: t };
}).filter((s) => s.t >= t0);
const ticksAt = (t) => threads.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), threads[0]);
const delta = (a, b) => {
    const A = ticksAt(a).ticks;
    const B = ticksAt(b).ticks;
    const out = {};
    for (const name of Object.keys(B)) out[name] = Math.max(0, (B[name] - (A[name] || 0))) / 100; // CPU seconds
    return out;
};
const top = (d, n = 4) => Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v.toFixed(1)}s`).join(', ');

const jumps = [];
for (let i = 1; i < rss.length; i++) if (rss[i].mb - rss[i - 1].mb > JUMP_MB) jumps.push(i);
console.log(`${rss.length} RSS samples, ${threads.length} thread samples, ${jumps.length} jumps above ${JUMP_MB} MB`);
const inJump = {};
const outJump = {};
let inSecs = 0;
let outSecs = 0;
const jumpIntervals = jumps.map((i) => [rss[i - 1].t, rss[i].t]);
for (const [a, b] of jumpIntervals) {
    const d = delta(a, b);
    const before = delta(a - 10000, a);
    console.log(`jump at +${((b - t0) / 1000).toFixed(0)} s (${phaseAt(b)}): RSS ${rss.find((s) => s.t === a).mb.toFixed(0)} -> ${rss.find((s) => s.t === b).mb.toFixed(0)} MB in ${((b - a) / 1000).toFixed(1)} s\n   threads in the jump: ${top(d)}\n   threads in the 10 s before: ${top(before)}`);
    for (const [k, v] of Object.entries(d)) inJump[k] = (inJump[k] || 0) + v;
    inSecs += (b - a) / 1000;
}
for (let i = 1; i < threads.length; i++) {
    const a = threads[i - 1].t;
    const b = threads[i].t;
    if (jumpIntervals.some(([x, y]) => a < y && b > x)) continue;
    const d = delta(a, b);
    for (const [k, v] of Object.entries(d)) outJump[k] = (outJump[k] || 0) + v;
    outSecs += (b - a) / 1000;
}
if (jumps.length) {
    console.log('\nCPU seconds per wall second, in the jumps vs outside them (a thread that is much busier in the jumps is a suspect):');
    for (const k of [...new Set([...Object.keys(inJump), ...Object.keys(outJump)])].sort((a, b) => (inJump[b] || 0) - (inJump[a] || 0)).slice(0, 8)) {
        console.log(`   ${k.padEnd(22)} in jumps ${((inJump[k] || 0) / inSecs).toFixed(2)}   outside ${((outJump[k] || 0) / Math.max(outSecs, 1)).toFixed(2)}`);
    }
}
