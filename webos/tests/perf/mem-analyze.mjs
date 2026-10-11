#!/usr/bin/env node
// Memory per phase (F7.1). Input: the sampler log (mem-sampler.sh) and the phases written by a
// scenario (one JSON per line: { name, t } with t = host epoch ms; a phase lasts until the next mark).
//   node mem-analyze.mjs <mem.log> <phases.jsonl> [out.json]
// For each phase: the app process (the WebAppMgr renderer that did not exist before the first phase,
// with the most RSS in the sample), its peak/mean/last RSS, the media pipeline processes (umediaserver
// and *pipeline*), the other new processes (the certificate proxy service), and how far the guest's
// MemAvailable fell below its level before the first phase. Everything in MB (RSS as the kernel
// counts it: the number the webOS memory manager judges, not the Chromium-quantized heap).
import fs from 'node:fs';

const [memFile, phasesFile, outFile] = process.argv.slice(2);
if (!memFile || !phasesFile) {
    console.error('usage: mem-analyze.mjs <mem.log> <phases.jsonl> [out.json]');
    process.exit(2);
}
const mb = (kb) => Math.round((kb / 1024) * 10) / 10;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const samples = [];
for (const line of fs.readFileSync(memFile, 'utf8').split('\n')) {
    const parts = line.trim().split(' ');
    if (parts.length < 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) continue;
    const procs = {};
    for (const item of parts.slice(2)) {
        const [name, pid, rss, anon, file, shmem] = item.split(':');
        if (pid && rss) procs[pid] = { name, rss: Number(rss), anon: Number(anon || 0), file: Number(file || 0), shmem: Number(shmem || 0) };
    }
    samples.push({ t: Number(parts[0]), avail: Number(parts[1]), procs });
}
const phases = fs.readFileSync(phasesFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (!phases.length || !samples.length) {
    console.error('no samples or no phases');
    process.exit(1);
}

const start = phases[0].t;
const before = samples.filter((s) => s.t < start);
const baseline = new Set(before.flatMap((s) => Object.keys(s.procs)));
const avail0 = mean(before.map((s) => s.avail));
const isMedia = (p) => /umediaserver|pipeline|starfish|gst-|videod/i.test(p.name);

const result = { memAvailableBeforeMB: avail0 === null ? null : mb(avail0), baselineProcesses: baseline.size, phases: {} };
phases.forEach((phase, i) => {
    const end = i + 1 < phases.length ? phases[i + 1].t : Infinity;
    const window = samples.filter((s) => s.t >= phase.t && s.t < end);
    if (!window.length) return;
    const appOf = (s) => {
        let best = null;
        for (const [pid, p] of Object.entries(s.procs)) {
            if (baseline.has(pid) || p.name !== 'WebAppMgr') continue;
            if (!best || p.rss > best.rss) best = { pid, ...p };
        }
        return best;
    };
    const app = window.map(appOf).filter(Boolean);
    const sumNew = (pred) => window.map((s) => Object.entries(s.procs).filter(([pid, p]) => !baseline.has(pid) && pred(p)).reduce((a, [, p]) => a + p.rss, 0));
    const media = sumNew(isMedia);
    const others = sumNew((p) => !isMedia(p) && p.name !== 'WebAppMgr');
    // Baseline WebAppMgr/zygote growth (the other web processes also grow with an app launch).
    const grown = window.map((s) => Object.entries(s.procs).filter(([pid, p]) => baseline.has(pid) && p.name === 'WebAppMgr')
        .reduce((a, [pid, p]) => {
            const base = mean(before.filter((b) => b.procs[pid]).map((b) => b.procs[pid].rss));
            return a + (base === null ? 0 : p.rss - base);
        }, 0));
    const rss = app.map((a) => a.rss);
    const peakOf = (key) => { if (!app.length) return null; const top = app.reduce((x, y) => (y.rss > x.rss ? y : x)); return mb(top[key]); };
    result.phases[phase.name] = {
        secs: Math.round(((Math.min(end, window[window.length - 1].t) - phase.t) / 1000) * 10) / 10,
        samples: window.length,
        appPeakMB: rss.length ? mb(Math.max(...rss)) : null,
        appMeanMB: rss.length ? mb(mean(rss)) : null,
        appLastMB: rss.length ? mb(rss[rss.length - 1]) : null,
        appPid: app.length ? app[app.length - 1].pid : null,
        // Composition at the sample with the highest RSS of the phase (kernel 4.8 RssAnon/RssFile/RssShmem).
        appPeakAnonMB: peakOf('anon'), appPeakFileMB: peakOf('file'), appPeakShmemMB: peakOf('shmem'),
        mediaPeakMB: mb(Math.max(...media)),
        otherNewPeakMB: mb(Math.max(...others)),
        otherWebAppMgrGrowthMB: mb(Math.max(...grown)),
        memAvailableMinMB: mb(Math.min(...window.map((s) => s.avail))),
        memAvailableDropPeakMB: avail0 === null ? null : mb(avail0 - Math.min(...window.map((s) => s.avail))),
    };
});
const text = JSON.stringify(result, null, 2);
if (outFile) fs.writeFileSync(outFile, `${text}\n`);
console.log(text);
