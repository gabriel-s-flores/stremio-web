#!/usr/bin/env node
// Reads the output of an endurance run (soak-nav / soak-play, F7.3) and prints the trend of every metric:
// least-squares slope per 10 minutes, the drift between the first and the last third of the samples (medians),
// the peak of the guest sampler (mem.log) and the restarts / OOM kills. Markdown on stdout.
//
//   node webos/tests/soak/analyze.mjs <run-dir>... [--json out.json] [--skip 1]
//
// A metric "grows" (GROWS) when its drift over the run passes 3 % AND the slope is >= 3 sigma; "slow growth" is >= 3 sigma under that bar; "flat" is < 3 sigma, and says
// only that the fit cannot tell it from zero (a slope with its error is the number to quote, not the word). A metric "grows" when the fit over the samples at the same place of the cycle (the Board for the navigation,
// the sample ticks for the playback) has a slope above its own noise (the residual standard deviation times
// the span): a staircase from the cache filling up in the first minutes is told apart from a straight line by
// the --skip option (the samples after the baseline that are left out of the fit, 1 by default).
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const dirs = [];
let jsonOut = null;
let skip = 1;
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') jsonOut = argv[++i];
    else if (argv[i] === '--skip') skip = Number(argv[++i]);
    else dirs.push(argv[i]);
}
if (!dirs.length) { console.error('usage: analyze.mjs <run-dir>... [--json out.json] [--skip N]'); process.exit(2); }

const readJsonl = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []);
const median = (v) => { const s = v.filter((x) => typeof x === 'number').sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

const METRICS = {
    'RSS (MB)': (s) => s.proc && s.proc.rssMB,
    'RssAnon (MB)': (s) => s.proc && s.proc.anonMB,
    'RssFile (MB)': (s) => s.proc && s.proc.fileMB,
    'RssShmem (MB)': (s) => s.proc && s.proc.shmemMB,
    'VmData (MB)': (s) => s.proc && s.proc.dataMB,
    'JS heap after GC (MB)': (s) => s.page && s.page.usedHeapMB,
    'JS heap total (MB)': (s) => s.page && s.page.totalHeapMB,
    'DOM nodes': (s) => (s.counters && s.counters.nodes) ?? (s.page && s.page.domNodes),
    'JS event listeners': (s) => s.counters && s.counters.jsEventListeners,
    'documents': (s) => s.counters && s.counters.documents,
    'images in DOM': (s) => s.page && s.page.images,
    'route containers': (s) => s.page && s.page.routeContainers,
    'core memory (MB)': (s) => s.coreMB,
};

function fit(points) {
    const n = points.length;
    if (n < 3) return null;
    const mx = points.reduce((a, p) => a + p[0], 0) / n;
    const my = points.reduce((a, p) => a + p[1], 0) / n;
    let sxx = 0; let sxy = 0; let syy = 0;
    for (const [x, y] of points) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
    if (sxx === 0) return null;
    const slope = sxy / sxx;
    const resid = Math.sqrt(Math.max(0, syy - slope * sxy) / Math.max(1, n - 2));
    // The standard error of the slope: a trend is real when it is a few times that.
    const se = resid / Math.sqrt(sxx);
    return { slope, se, r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy), resid };
}

const out = {};
for (const dir of dirs) {
    const name = path.basename(path.resolve(dir));
    const soak = fs.existsSync(path.join(dir, 'soak.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'soak.json'), 'utf8')) : {};
    const all = readJsonl(path.join(dir, 'samples.jsonl'));
    const events = readJsonl(path.join(dir, 'events.jsonl'));
    // The comparable samples: cycle ends (nav) or the periodic ticks (play); not the baseline, the leave and the idle.
    const series = all.filter((s) => /^cycle-\d+$/.test(s.label) || /^play\+\d+$/.test(s.label));
    const fitted = series.slice(skip);
    const rows = [];
    for (const [metric, get] of Object.entries(METRICS)) {
        const values = fitted.map((s) => [s.min, get(s)]).filter(([, v]) => typeof v === 'number');
        if (values.length < 3) continue;
        const f = fit(values);
        const third = Math.max(1, Math.floor(values.length / 3));
        const first = median(values.slice(0, third).map((p) => p[1]));
        const last = median(values.slice(-third).map((p) => p[1]));
        const span = values[values.length - 1][0] - values[0][0];
        const per10 = f ? f.slope * 10 : null;
        const sig = f && f.se > 0 ? Math.abs(f.slope) / f.se : (f && f.slope !== 0 ? Infinity : 0);
        rows.push({
            metric, n: values.length, first, last, drift: round(last - first), per10: round(per10, 2), se10: f ? round(f.se * 10, 2) : null,
            min: round(Math.min(...values.map((p) => p[1]))), max: round(Math.max(...values.map((p) => p[1]))), span: round(span),
            // sigma: the slope in standard errors. 'slow growth': clearly not zero (>= 3 sigma) but the drift over the run is under
            // the 'GROWS' bar (3 % of the first value, 1 unit): a leak of a few MB an hour on a 90 MB number is this, not 'flat'.
            sigma: f ? round(sig === Infinity ? 999 : sig, 1) : null,
            verdict: !f ? '?' : sig >= 3 ? (Math.abs(f.slope * span) >= Math.max(1, 0.03 * (first || 1)) ? (f.slope > 0 ? 'GROWS' : 'shrinks') : (f.slope > 0 ? 'slow growth' : 'slow shrink')) : 'flat',
        });
    }
    // The peak of the guest sampler: the app's renderer (the WebAppMgr with the biggest RSS) and the pipeline.
    let peak = null;
    const memLog = path.join(dir, 'mem.log');
    if (fs.existsSync(memLog)) {
        let maxRss = 0; let minAvail = Infinity; let maxPipeline = 0; let lines = 0;
        for (const line of fs.readFileSync(memLog, 'utf8').split('\n')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) continue;
            lines++;
            minAvail = Math.min(minAvail, Number(parts[1]) / 1024);
            for (const entry of parts.slice(2)) {
                const [procName, , rss] = entry.split(':');
                const mb = Number(rss) / 1024;
                if (/^WebAppMgr/.test(procName) && mb > maxRss) maxRss = mb;
                if (/pipeline|umediaserver|gst/.test(procName) && mb > maxPipeline) maxPipeline = mb;
            }
        }
        peak = { samples: lines, maxWebAppMgrRssMB: round(maxRss), minMemAvailableMB: round(minAvail), maxPipelineRssMB: round(maxPipeline) };
    }
    const oom = fs.existsSync(path.join(dir, 'dmesg-oom.txt')) ? fs.readFileSync(path.join(dir, 'dmesg-oom.txt'), 'utf8').split('\n').filter((l) => /Out of memory|Killed process/.test(l)) : [];
    const restarts = events.filter((e) => e.kind === 'restart').length;
    const pidChanges = events.filter((e) => e.kind === 'renderer-pid-changed').length;
    const steps = readJsonl(path.join(dir, 'steps.jsonl'));
    const failedSteps = steps.filter((s) => s.ok === false);
    out[name] = { scenario: soak.scenario, profile: soak.profile, minutes: soak.minutes ?? soak.playedMinutes, cycles: soak.cycles, samples: all.length, fitted: fitted.length, rows, peak, oomKills: oom.length, restarts, pidChanges, steps: steps.length, failedSteps: failedSteps.length };

    console.log(`## ${name} (${soak.scenario || '?'}, ${soak.profile || '?'}${soak.cycles ? `, ${soak.cycles} cycles` : ''}, ${soak.minutes ?? soak.playedMinutes ?? '?'} min)\n`);
    console.log(`Restarts of the page: **${restarts}**; renderer PID changes: **${pidChanges}**; OOM kills in dmesg: **${oom.length}**; steps failed: **${failedSteps.length}/${steps.length}**. Samples used for the fit: ${fitted.length} of ${all.length} (baseline and the first ${skip} left out).\n`);
    if (peak) console.log(`Guest sampler (${peak.samples} samples): peak WebAppMgr RSS **${peak.maxWebAppMgrRssMB} MB**, lowest MemAvailable ${peak.minMemAvailableMB} MB, media pipeline peak ${peak.maxPipelineRssMB} MB.\n`);
    console.log('| metric | n | first third | last third | drift | slope / 10 min | ±se | σ | min–max | verdict |');
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.metric} | ${r.n} | ${r.first} | ${r.last} | ${r.drift} | ${r.per10} | ${r.se10} | ${r.sigma} | ${r.min}–${r.max} | ${r.verdict} |`);
    console.log('');
    const by = {};
    for (const s of failedSteps) by[s.name] = (by[s.name] || 0) + 1;
    if (failedSteps.length) console.log(`Failed steps by name: ${Object.entries(by).map(([n, c]) => `${n} ×${c}`).join(', ')}\n`);
    if (oom.length) console.log(`dmesg: ${oom.slice(0, 3).join(' | ')}\n`);
}
if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify(out, null, 2)}\n`);
