#!/usr/bin/env node
// Runs the F7.1 measurements again, end to end, for F7.2 and the G7 gate: every scenario in its own
// emu-run reservation (profile c8, a clean boot), each round checked against the host load before and
// after, repeated when the host was busy, and summarized at the end.
//
//   node webos/tests/perf/perf.mjs --ipk <ipk> --out <dir> [--rounds 3] [--retries 2] [--scenarios boot,boot-wasm,boot-wasm2js,nav,play]
//        [--launches 4] [--max-load 8] [--max-ref 850] [--max-psi 60] [--wait-calm 20] [--profile c8]
//
// Build the IPK first: `pnpm webos:package` (or webos/tests/perf/build-ipk.sh <commit> <out.ipk>).
// Scenarios: boot (default core variant), boot-wasm / boot-wasm2js (webos.coreVariant), nav (screens and
// memory), play (Details -> Player, 5 stream switches). Output: <dir>/<scenario>-<round>/ and <dir>/summary.md.
// --wait-calm N: before each round, wait up to N minutes for the host to calm down (load1 <= --max-load).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, parseArgs, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.ipk || !args.out) {
    console.error('usage: perf.mjs --ipk <ipk> --out <dir> [--rounds 3] [--retries 2] [--scenarios boot,boot-wasm,boot-wasm2js,nav,play]');
    process.exit(2);
}
const IPK = path.resolve(args.ipk);
const OUT = path.resolve(args.out);
const ROUNDS = Number(args.rounds || 3);
const RETRIES = Number(args.retries ?? 2);
const MAX_LOAD = Number(args['max-load'] || 8);
const MAX_REF = Number(args['max-ref'] || 850);
const MAX_PSI = args['max-psi'] ? Number(args['max-psi']) : Infinity;
const WAIT_CALM_MIN = Number(args['wait-calm'] ?? 20);
const PROFILE = args.profile || 'c8';
const LAUNCHES = Number(args.launches || 4);
const SCENARIOS = (args.scenarios || 'boot,boot-wasm,boot-wasm2js,nav,play').split(',');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a);
const context = (ref = true) => JSON.parse(execFileSync(path.join(REPO, 'webos/tests/perf/context.sh'), ref ? [] : ['--no-ref'], { encoding: 'utf8' }));
const isCalm = (c) => c.load1 <= MAX_LOAD && !(c.psiCpu > MAX_PSI) && (c.hostRefMs === null || c.hostRefMs <= MAX_REF);

async function waitCalm() {
    const deadline = Date.now() + WAIT_CALM_MIN * 60000;
    for (;;) {
        const c = context(true);
        if (isCalm(c) || Date.now() > deadline) return c;
        log(`host busy (load ${c.load1}, ref ${c.hostRefMs} ms, pool ${c.poolBusy}): waiting`);
        await sleep(30000);
    }
}

function scenarioCommand(name, dir) {
    const run = path.join(REPO, 'webos/tests/perf/run.sh');
    if (name === 'boot') return { timeout: 45, cmd: [run, dir, 'boot', '--ipk', IPK, '--launches', String(LAUNCHES)] };
    if (name === 'boot-wasm') return { timeout: 45, cmd: [run, dir, 'boot', '--ipk', IPK, '--launches', String(LAUNCHES), '--variant', 'wasm'] };
    if (name === 'boot-wasm2js') return { timeout: 45, cmd: [run, dir, 'boot', '--ipk', IPK, '--launches', String(LAUNCHES), '--variant', 'wasm2js'] };
    if (name === 'nav') return { timeout: 50, cmd: [run, dir, 'nav', '--ipk', IPK] };
    if (name === 'play') return { timeout: 50, cmd: [run, dir, 'play', '--ipk', IPK, '--switches', '5'] };
    throw new Error(`unknown scenario ${name}`);
}

// Is a finished round calm (host state before and after) and complete?
function verdict(name, dir) {
    const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null);
    if (name.startsWith('boot')) {
        const f = path.join(dir, 'boot.jsonl');
        if (!fs.existsSync(f)) return { ok: false, why: 'no boot.jsonl' };
        const rows = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
        const bad = rows.filter((r) => !r.ok || !isCalm(r.ctxBefore) || !isCalm(r.ctxAfter));
        return { ok: rows.length >= LAUNCHES && bad.length === 0, why: `${rows.length - bad.length}/${rows.length} calm launches` };
    }
    const doc = read(name === 'nav' ? 'nav.json' : 'play.json');
    if (!doc) return { ok: false, why: 'no result file' };
    const calm = isCalm(doc.ctxStart) && isCalm(doc.ctxEnd);
    return { ok: calm, why: `load ${doc.ctxStart.load1} -> ${doc.ctxEnd.load1}` };
}

const rounds = [];
for (let round = 1; round <= ROUNDS; round++) {
    for (const name of SCENARIOS) {
        for (let attempt = 0; attempt <= RETRIES; attempt++) {
            const dir = path.join(OUT, `${name}-${round}${attempt ? `-retry${attempt}` : ''}`);
            const before = await waitCalm();
            log(`${name} round ${round} attempt ${attempt + 1}: load ${before.load1}, ref ${before.hostRefMs} ms, pool ${before.poolBusy}`);
            const { timeout, cmd } = scenarioCommand(name, dir);
            const res = spawnSync(path.join(REPO, 'webos/tools/emu-run'), ['--profile', PROFILE, '--timeout', String(timeout), '--', ...cmd], { stdio: ['ignore', 'inherit', 'inherit'] });
            const v = fs.existsSync(dir) ? verdict(name, dir) : { ok: false, why: 'no output' };
            rounds.push({ name, round, attempt, dir, exit: res.status, ...v });
            log(`${name} round ${round}: exit ${res.status}, ${v.ok ? 'CALM' : 'DISQUALIFIED'} (${v.why})`);
            if (v.ok) break;
        }
    }
}
fs.writeFileSync(path.join(OUT, 'rounds.json'), `${JSON.stringify(rounds, null, 2)}\n`);
const dirs = rounds.map((r) => r.dir).filter((d) => fs.existsSync(d));
const summary = spawnSync('node', [path.join(REPO, 'webos/tests/perf/summarize.mjs'), '--max-load', String(MAX_LOAD), '--max-ref', String(MAX_REF), ...(MAX_PSI === Infinity ? [] : ['--max-psi', String(MAX_PSI)]), '--json', path.join(OUT, 'summary.json'), ...dirs], { encoding: 'utf8' });
fs.writeFileSync(path.join(OUT, 'summary.md'), summary.stdout);
log(`summary: ${path.join(OUT, 'summary.md')}`);
