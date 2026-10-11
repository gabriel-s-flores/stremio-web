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
import { createRequire } from 'node:module';
import { REPO, parseArgs, sleep } from './lib.mjs';

const { isCalm: isCalmWith, roundVerdict } = createRequire(import.meta.url)('./rounds.js');

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
const LIMITS = { maxLoad: MAX_LOAD, maxRef: MAX_REF, maxPsi: MAX_PSI };
const isCalm = (c) => isCalmWith(c, LIMITS);

async function waitCalm() {
    const deadline = Date.now() + WAIT_CALM_MIN * 60000;
    for (;;) {
        const c = context(true);
        if (isCalm(c) || Date.now() > deadline) return c;
        log(`host busy (load ${c.load1}, ref ${c.hostRefMs} ms, pool ${c.poolBusy}): waiting`);
        await sleep(30000);
    }
}

// The boot scenarios drop the first launch after an install (--warmup 1: no Chromium code cache yet).
function scenarioCommand(name, dir) {
    const run = path.join(REPO, 'webos/tests/perf/run.sh');
    const boot = (...extra) => ({ timeout: 45, cmd: [run, dir, 'boot', '--ipk', IPK, '--launches', String(LAUNCHES), '--warmup', '1', ...extra] });
    if (name === 'boot') return boot();
    if (name === 'boot-wasm') return boot('--variant', 'wasm');
    if (name === 'boot-wasm2js') return boot('--variant', 'wasm2js');
    if (name === 'nav') return { timeout: 50, cmd: [run, dir, 'nav', '--ipk', IPK] };
    if (name === 'play') return { timeout: 50, cmd: [run, dir, 'play', '--ipk', IPK, '--switches', '5'] };
    throw new Error(`unknown scenario ${name}`);
}

// Is a finished round usable (calm host at both ends; for boot, enough good launches)? A play/nav round that
// died because the kernel killed the renderer (OOM) is a RESULT, not a failure: it is kept and flagged.
function verdict(name, dir) {
    const kind = name.startsWith('boot') ? 'boot' : name;
    return roundVerdict(kind, dir, { limits: LIMITS, launches: LAUNCHES });
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
            let v;
            try {
                v = fs.existsSync(dir) ? verdict(name, dir) : { ok: false, calm: false, why: 'no output' };
            } catch (e) {
                v = { ok: false, calm: false, why: `verdict failed: ${e.message}` };
            }
            rounds.push({ name, round, attempt, dir, exit: res.status, ...v });
            log(`${name} round ${round}: exit ${res.status}, ${v.ok ? (v.oom ? 'KEPT, the renderer was OOM-killed' : 'CALM') : 'DISQUALIFIED'} (${v.why})`);
            if (v.ok) break;
        }
    }
}
fs.writeFileSync(path.join(OUT, 'rounds.json'), `${JSON.stringify(rounds, null, 2)}\n`);
const killed = rounds.filter((r) => r.oom);
log(`rounds: ${rounds.length} run, ${rounds.filter((r) => r.ok).length} kept, ${rounds.filter((r) => !r.ok).length} disqualified, ${killed.length} with the renderer OOM-killed${killed.length ? ` (${killed.map((r) => `${path.basename(r.dir)}: jump in ${r.oomPhase || '?'}, peak ${r.peakMB} MB, host ${r.calm ? 'calm' : 'busy'}`).join('; ')})` : ''}`);
const dirs = rounds.map((r) => r.dir).filter((d) => fs.existsSync(d));
const summary = spawnSync('node', [path.join(REPO, 'webos/tests/perf/summarize.mjs'), '--max-load', String(MAX_LOAD), '--max-ref', String(MAX_REF), ...(MAX_PSI === Infinity ? [] : ['--max-psi', String(MAX_PSI)]), '--json', path.join(OUT, 'summary.json'), ...dirs], { encoding: 'utf8' });
fs.writeFileSync(path.join(OUT, 'summary.md'), summary.stdout);
log(`summary: ${path.join(OUT, 'summary.md')}`);
