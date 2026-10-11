// The verdict of a finished round (webos/tests/perf/rounds.js): the case that broke perf.mjs in the F7.1 review
// (a play round whose renderer was killed by the OOM has no ctxStart/ctxEnd in play.json), the host criterion
// (a state nobody measured is not calm) and the warm-up launch of the boot rounds.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isCalm, roundVerdict, oomSummary } = require('./rounds');

const CALM = { load1: 3, hostRefMs: 590, psiCpu: 10 };
const BUSY = { load1: 14, hostRefMs: 590 };

const makeDir = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-round-'));
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : `${JSON.stringify(content)}\n`);
    }
    return dir;
};
const lines = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
const KILLED = '[  261.873635] Out of memory: Kill process 1245 (WebAppMgr) score 834 or sacrifice child\n[  261.877023] Killed process 1245 (WebAppMgr) total-vm:1090832kB, anon-rss:522936kB, file-rss:0kB\nhostEpochMs 1\n';

// A mem.log in which the app renderer (pid 2000) jumps from 210 MB to 520 MB during the phase "details".
const memLog = () => {
    const mk = (t, appKb, avail) => `${t} ${avail} WebAppMgr:1000:50000:1:1:1${appKb ? ` WebAppMgr:2000:${appKb}:1:1:1` : ''}`;
    return [mk(900, 0, 700000), mk(1000, 0, 700000), mk(2000, 210000, 500000), mk(3000, 215000, 500000), mk(4000, 520000, 30000), mk(5000, 525000, 20000)].join('\n');
};
const phases = lines([{ name: 'launch', t: 1500 }, { name: 'details', t: 3500 }, { name: 'end', t: 6000 }]);

describe('isCalm', () => {
    it('accepts a measured, quiet host', () => {
        expect(isCalm(CALM)).toBe(true);
    });
    it('refuses a loaded host and a slow reference loop', () => {
        expect(isCalm(BUSY)).toBe(false);
        expect(isCalm({ load1: 3, hostRefMs: 900 })).toBe(false);
    });
    it('refuses a state that was not measured', () => {
        expect(isCalm(null)).toBe(false);
        expect(isCalm(undefined)).toBe(false);
        expect(isCalm({ load1: 3, hostRefMs: null })).toBe(false); // context.sh --no-ref
        expect(isCalm({ load1: 3 })).toBe(false);
    });
    it('uses the CPU pressure only when asked', () => {
        expect(isCalm({ load1: 3, hostRefMs: 590, psiCpu: 80 })).toBe(true);
        expect(isCalm({ load1: 3, hostRefMs: 590, psiCpu: 80 }, { maxPsi: 60 })).toBe(false);
    });
});

describe('roundVerdict, play', () => {
    it('keeps a round whose renderer was OOM-killed (the OOM is the result) instead of throwing', () => {
        // play.json as the exit handler of play.mjs writes it: incomplete, without ctxStart/ctxEnd.
        const dir = makeDir({
            'play.json': { incomplete: true, exitCode: 1, events: [], snapshots: [] },
            'context-start.json': CALM,
            'context-end.json': CALM,
            'dmesg-oom.txt': KILLED,
            'mem.log': memLog(),
            'phases.jsonl': phases,
        });
        const v = roundVerdict('play', dir);
        expect(v).toMatchObject({ ok: true, calm: true, incomplete: true, oom: true, oomPhase: 'details', peakMB: 513 });
    });
    it('retries a round that died without an OOM', () => {
        const dir = makeDir({ 'play.json': { incomplete: true, events: [] }, 'context-start.json': CALM, 'context-end.json': CALM, 'dmesg-oom.txt': '12.5\nhostEpochMs 1\n' });
        const v = roundVerdict('play', dir);
        expect(v).toMatchObject({ ok: false, calm: true, incomplete: true, oom: false });
    });
    it('does not count a round on a busy host, OOM or not', () => {
        const dir = makeDir({ 'play.json': { incomplete: false, events: [] }, 'context-start.json': CALM, 'context-end.json': BUSY, 'dmesg-oom.txt': '1\n' });
        expect(roundVerdict('play', dir)).toMatchObject({ ok: false, calm: false });
    });
    it('does not count a round without the host context (or without the reference loop)', () => {
        const noContext = makeDir({ 'play.json': { events: [] } });
        expect(roundVerdict('play', noContext)).toMatchObject({ ok: false, calm: false });
        const noRef = makeDir({ 'play.json': { events: [] }, 'context-start.json': { load1: 2, hostRefMs: null }, 'context-end.json': { load1: 2, hostRefMs: null } });
        expect(roundVerdict('play', noRef)).toMatchObject({ ok: false, calm: false });
    });
    it('does not throw on a folder with nothing in it', () => {
        expect(roundVerdict('play', makeDir({}))).toMatchObject({ ok: false, incomplete: true });
    });
});

describe('roundVerdict, boot', () => {
    const row = (k, warmup, ctx) => ({ k, warmup, ok: true, coreReadyAt: 13000, firstRowAt: 32000, ctxBefore: ctx, ctxAfter: ctx });
    it('leaves the warm-up launch out of the count', () => {
        const dir = makeDir({ 'boot.jsonl': lines([row(1, true, BUSY), row(2, false, CALM), row(3, false, CALM)]) });
        // the busy launch is the warm-up: it does not disqualify the round, and does not count as a launch
        expect(roundVerdict('boot', dir, { launches: 2 })).toMatchObject({ ok: true, calm: true });
        expect(roundVerdict('boot', dir, { launches: 3 })).toMatchObject({ ok: false, incomplete: true });
    });
    it('disqualifies a round with a launch on a busy host', () => {
        const dir = makeDir({ 'boot.jsonl': lines([row(1, true, CALM), row(2, false, CALM), row(3, false, BUSY)]) });
        expect(roundVerdict('boot', dir, { launches: 2 })).toMatchObject({ ok: false, calm: false });
    });
});

describe('oomSummary', () => {
    it('finds the phase of the jump and the peak, and survives missing files', () => {
        const dir = makeDir({ 'dmesg-oom.txt': KILLED, 'mem.log': memLog(), 'phases.jsonl': phases });
        expect(oomSummary(dir)).toEqual({ killed: true, jumpPhase: 'details', peakMB: 513 });
        expect(oomSummary(makeDir({}))).toEqual({ killed: false, jumpPhase: null, peakMB: 0 });
    });
});
