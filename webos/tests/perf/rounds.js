// What a finished round of the F7.1 measurements says about itself (CommonJS: used by perf.mjs and summarize.mjs,
// and tested by rounds.test.js). Pure functions over parsed files, except oomSummary(), which reads a run folder.

const DEFAULT_LIMITS = { maxLoad: 8, maxRef: 850, maxPsi: Infinity };
const fs = require('node:fs');
const path = require('node:path');

// A host state is calm when the 1-minute load is <= maxLoad (the CPU count) and the CPU reference loop took
// <= maxRef ms (and, when asked, the CPU pressure is <= maxPsi). A state that was NOT measured (no context, no
// reference loop) is NOT calm: a round cannot pass a criterion nobody checked.
const isCalm = (ctx, limits = {}) => {
    const l = { ...DEFAULT_LIMITS, ...limits };
    return !!ctx
        && typeof ctx.load1 === 'number' && ctx.load1 <= l.maxLoad
        && typeof ctx.hostRefMs === 'number' && ctx.hostRefMs <= l.maxRef
        && !(ctx.psiCpu > l.maxPsi);
};
const bothCalm = (a, b, limits) => isCalm(a, limits) && isCalm(b, limits);

const readJson = (file) => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return null;
    }
};
const readLines = (file) => {
    try {
        return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch (e) {
        return [];
    }
};

// Did the kernel kill the renderer (dmesg-oom.txt, written by run.sh), when did the app's RSS first pass 400 MB
// (the phase of phases.jsonl it happened in) and how high did it get? Works on the files of an incomplete run too.
const oomSummary = (dir) => {
    const dmesg = path.join(dir, 'dmesg-oom.txt');
    const killed = fs.existsSync(dmesg) && /Killed process \d+ \(WebAppMgr\)/.test(fs.readFileSync(dmesg, 'utf8'));
    const phases = readLines(path.join(dir, 'phases.jsonl'));
    let peakMB = 0;
    let jumpPhase = null;
    try {
        const lines = fs.readFileSync(path.join(dir, 'mem.log'), 'utf8').split('\n').filter(Boolean);
        const t0 = phases.length ? phases[0].t : Infinity;
        const baseline = new Set();
        for (const line of lines) {
            const p = line.split(' ');
            if (Number(p[0]) >= t0) break;
            for (const item of p.slice(2)) baseline.add(item.split(':')[1]);
        }
        const phaseAt = (t) => phases.reduce((name, ph) => (ph.t <= t ? ph.name : name), null);
        for (const line of lines) {
            const p = line.split(' ');
            const t = Number(p[0]);
            if (t < t0) continue;
            let app = 0;
            for (const item of p.slice(2)) {
                const q = item.split(':');
                if (q[0] === 'WebAppMgr' && !baseline.has(q[1]) && Number(q[2]) > app) app = Number(q[2]);
            }
            app /= 1024;
            if (app > peakMB) peakMB = app;
            if (jumpPhase === null && app > 400) jumpPhase = phaseAt(t);
        }
    } catch (e) { /* no sampler log */ }
    return { killed, jumpPhase, peakMB: Math.round(peakMB) };
};

// The verdict of one round folder. `kind`: 'boot' | 'nav' | 'play'.
//   ok          : the round counts (calm and, for boot, with enough good launches) and needs no retry;
//   calm        : the host was calm at both ends (judged from the context files run.sh writes, which always exist);
//   incomplete  : the scenario died half way (the renderer killed by the OOM, a CDP timeout...);
//   oom         : the kernel killed the renderer: a RESULT of the play/nav scenarios, not a failure of the tool.
// An incomplete round that was an OOM and calm is kept (`ok`): the OOM is the measurement.
const roundVerdict = (kind, dir, options = {}) => {
    const limits = options.limits || {};
    const launches = options.launches || 1;
    if (kind === 'boot') {
        const rows = readLines(path.join(dir, 'boot.jsonl')).filter((r) => !r.warmup);
        if (!rows.length) return { ok: false, calm: false, incomplete: true, oom: false, why: 'no boot.jsonl rows' };
        const good = rows.filter((r) => r.ok && bothCalm(r.ctxBefore, r.ctxAfter, limits));
        return { ok: rows.length >= launches && good.length === rows.length, calm: good.length === rows.length, incomplete: rows.length < launches, oom: false, why: `${good.length}/${rows.length} calm launches (${launches} wanted)` };
    }
    const doc = readJson(path.join(dir, kind === 'nav' ? 'nav.json' : 'play.json'));
    if (!doc) return { ok: false, calm: false, incomplete: true, oom: false, why: 'no result file' };
    const start = readJson(path.join(dir, 'context-start.json'));
    const end = readJson(path.join(dir, 'context-end.json'));
    const calm = bothCalm(start, end, limits);
    const o = oomSummary(dir);
    const incomplete = !!doc.incomplete;
    const why = `${start ? `load ${start.load1}` : 'no start context'} -> ${end ? `load ${end.load1}` : 'no end context'}${incomplete ? ', incomplete' : ''}${o.killed ? `, OOM-killed (jump in ${o.jumpPhase || '?'}, peak ${o.peakMB} MB)` : ''}`;
    // Incomplete without an OOM is a failure of the round (retry); with an OOM it is the result.
    return { ok: calm && (!incomplete || o.killed), calm, incomplete, oom: o.killed, oomPhase: o.jumpPhase, peakMB: o.peakMB, why };
};

module.exports = { DEFAULT_LIMITS, isCalm, bothCalm, oomSummary, roundVerdict, readJson, readLines };
