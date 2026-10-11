#!/usr/bin/env node
// Turns the output folders of boot.mjs / nav.mjs / play.mjs (run.sh) into markdown tables with the
// median and the spread, and says which rounds the host load disqualifies (F7.1).
//
//   node summarize.mjs [--max-load 8] [--max-ref 850] [--max-psi 60] [--json out.json] <out-dir>...
//
// A round is CALM when, before AND after it, the 1-minute load average is <= --max-load (the CPU count, 8: below it the VM's 40 % quota is what limits it) and the CPU
// reference loop is <= --max-ref ms (idle host: ~600 ms; BASELINE-C8.md explains the thresholds).
// Rounds that are not calm are listed apart and left out of the medians (`--include-busy` keeps them).
// A host state that was not measured (no context file, no reference loop) is NOT calm.
// Folder kinds are told apart by their files: boot.jsonl (boot), nav.json (nav), play.json (play),
// streams-cycle.json (streams-cycle). A play/nav round that died (the renderer OOM-killed) is a result: it is
// listed with its OOM; `calm` is judged from the context files run.sh writes around the whole scenario.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { isCalm, oomSummary } = createRequire(import.meta.url)('./rounds.js');

const argv = process.argv.slice(2);
const opts = { maxLoad: 8, maxRef: 850, maxPsi: Infinity, json: null, includeBusy: false };
const dirs = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max-load') opts.maxLoad = Number(argv[++i]);
    else if (argv[i] === '--max-ref') opts.maxRef = Number(argv[++i]);
    else if (argv[i] === '--max-psi') opts.maxPsi = Number(argv[++i]);
    else if (argv[i] === '--json') opts.json = argv[++i];
    else if (argv[i] === '--include-busy') opts.includeBusy = true;
    else dirs.push(argv[i]);
}
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const nums = (xs) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
const median = (xs) => { const s = nums(xs).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (v, d = 1) => (v === null || v === undefined ? '–' : (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ','));
const sec = (ms) => (typeof ms === 'number' ? ms / 1000 : null);
const spread = (xs, scale = 1, d = 1) => { const s = nums(xs).map((x) => x / scale); return s.length ? `${fmt(Math.min(...s), d)}–${fmt(Math.max(...s), d)}` : '–'; };
const limits = () => ({ maxLoad: opts.maxLoad, maxRef: opts.maxRef, maxPsi: opts.maxPsi });
const calm = (...ctxs) => ctxs.length > 0 && ctxs.every((c) => isCalm(c, limits()));
const ctxText = (c) => (c ? `load ${fmt(c.load1)}/ref ${c.hostRefMs ?? '–'} ms/psi ${c.psiCpu ?? '–'}/pool ${c.poolBusy}` : '–');

const out = { opts, boot: [], nav: [], play: [], cycles: [] };
const md = [];

for (const dir of dirs) {
    const name = path.basename(path.resolve(dir));
    const info = read(path.join(dir, 'info.json')) || {};
    const mem = read(path.join(dir, 'mem.json'));
    if (fs.existsSync(path.join(dir, 'boot.jsonl'))) {
        const rows = lines(path.join(dir, 'boot.jsonl')).map((r) => ({ ...r, calm: calm(r.ctxBefore, r.ctxAfter) }));
        out.boot.push({ dir: name, info, rows, mem });
    } else if (fs.existsSync(path.join(dir, 'nav.json'))) {
        const nav = read(path.join(dir, 'nav.json'));
        const ctx = [read(path.join(dir, 'context-start.json')), read(path.join(dir, 'context-end.json'))];
        out.nav.push({ dir: name, nav, calm: !nav.incomplete && calm(...ctx), mem });
    } else if (fs.existsSync(path.join(dir, 'play.json'))) {
        const play = read(path.join(dir, 'play.json'));
        const ctx = [read(path.join(dir, 'context-start.json')), read(path.join(dir, 'context-end.json'))];
        out.play.push({ dir: name, play, ctx, calm: calm(...ctx), oom: oomSummary(dir), mem });
    } else if (fs.existsSync(path.join(dir, 'streams-cycle.json'))) {
        out.cycles.push({ dir: name, cycle: read(path.join(dir, 'streams-cycle.json')) });
    }
}

if (out.boot.length) {
    md.push('### Boot', '', '| Rodada | IPK | Variante | Lançamento | Core pronto (s) | 1º item do Board (s) | Board com 2 linhas (s) | Relógio do host até o 1º item (s) | Host (carga/ref/pool) | Calma |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const b of out.boot) {
        for (const r of b.rows) {
            md.push(`| ${b.dir} | ${b.info.ipk || '–'} | ${r.variant} | ${r.k}${r.warmup ? ' (aquec.)' : ''} | ${fmt(sec(r.coreReadyAt))} | ${fmt(sec(r.firstRowAt))} | ${fmt(sec(r.screenFullAt))} | ${typeof r.hostLaunchToFirstRowMs === 'number' ? fmt(sec(r.hostLaunchToFirstRowMs)) : `(até 2 linhas: ${fmt(sec(r.hostLaunchToScreenFullMs))})`} | ${ctxText(r.ctxBefore)} → ${ctxText(r.ctxAfter)} | ${r.calm ? 'sim' : 'não'} |`);
        }
    }
    md.push('');
    const groups = {};
    for (const b of out.boot) for (const r of b.rows) {
        if (!r.ok || r.warmup) continue;
        const key = `${b.info.ipk || b.dir} · ${r.variant}`;
        (groups[key] = groups[key] || []).push(r);
    }
    md.push('| Grupo | n (calmas/total) | Core pronto (s) mediana (faixa) | 1º item (s) mediana (faixa) | Board 2 linhas (s) mediana (faixa) |', '|---|---|---|---|---|');
    for (const [key, rs] of Object.entries(groups)) {
        const use = opts.includeBusy ? rs : rs.filter((r) => r.calm);
        md.push(`| ${key} | ${use.length}/${rs.length} | ${fmt(sec(median(use.map((r) => r.coreReadyAt))))} (${spread(use.map((r) => r.coreReadyAt), 1000)}) | ${fmt(sec(median(use.map((r) => r.firstRowAt))))} (${spread(use.map((r) => r.firstRowAt), 1000)}) | ${fmt(sec(median(use.map((r) => r.screenFullAt))))} (${spread(use.map((r) => r.screenFullAt), 1000)}) |`);
    }
    md.push('');
    // The app's own marks (diagnostics screen) and the core loader timings, calm launches, by group.
    md.push('| Grupo | n | DOMContentLoaded (s) | início do init do core (s) | core pronto (marca, s) | Board montado (s) | 1º item no DOM (s) | wasm2jsLoadMs (s) | compileMs (s) | RSS parado após 25 s (MB) |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [key, rs] of Object.entries(groups)) {
        const use = (opts.includeBusy ? rs : rs.filter((r) => r.calm)).filter((r) => r.marks);
        const m = (fn) => `${fmt(sec(median(use.map(fn))))} (${spread(use.map(fn), 1000)})`;
        const t = (k) => `${fmt(sec(median(use.map((r) => r.core && r.core.timings && r.core.timings[k]))))} (${spread(use.map((r) => r.core && r.core.timings && r.core.timings[k]), 1000)})`;
        const idle = use.map((r) => { const b = out.boot.find((x) => x.rows.includes(r)); const ph = b && b.mem && b.mem.phases[`idle-${r.k}`]; return ph && ph.appMeanMB; });
        md.push(`| ${key} | ${use.length} | ${m((r) => r.marks.domContentLoadedMs)} | ${m((r) => r.marks.coreInitStartMs)} | ${m((r) => r.marks.coreReadyMs)} | ${m((r) => r.marks.boardMountedMs)} | ${m((r) => r.marks.boardFirstItemMs)} | ${t('wasm2jsLoadMs')} | ${t('compileMs')} | ${fmt(median(idle))} (${spread(idle)}) |`);
    }
    md.push('');
}

if (out.nav.length) {
    md.push('### Navegação', '', '| Passo | ' + out.nav.map((n) => `${n.dir}${n.calm ? '' : ' (host ocupado)'}`).join(' | ') + ' |', '|---|' + out.nav.map(() => '---').join('|') + '|');
    const names = [...new Set(out.nav.flatMap((n) => n.nav.steps.map((s) => s.name)))];
    for (const name of names) {
        md.push(`| ${name} | ${out.nav.map((n) => { const s = n.nav.steps.find((x) => x.name === name); return s ? (s.timeout ? 'timeout' : `${fmt(sec(s.ms), 2)} s${s.settledMs ? ` (assenta ${fmt(sec(s.settledMs), 1)} s)` : ''}`) : '–'; }).join(' | ')} |`);
    }
    md.push('');
}

if (out.play.length) {
    md.push('### Reprodução', '', '| Rodada | Evento | Player montado (s) | Tocando (s) | Vídeo | Host |', '|---|---|---|---|---|---|');
    for (const p of out.play) {
        md.push(`| ${p.dir} | lista de streams | – | ${fmt(sec(p.play.streamsList && p.play.streamsList.ms), 2)} | – | ${p.play.incomplete ? 'INCOMPLETA (morreu no meio)' : p.calm ? 'calmo' : 'ocupado'} |`);
        for (const e of (p.play.events || []).filter((x) => x.label && !x.label.endsWith('-back'))) {
            md.push(`| ${p.dir} | ${e.label} | ${fmt(sec(e.playerShellMs), 2)} | ${e.error ? e.error : e.failed ? 'falhou (120 s)' : fmt(sec(e.playingMs), 2)} | ${e.video ? `t=${e.video.t}s ready=${e.video.ready} ${e.video.w}x${e.video.h}` : '–'} | ${ctxText(e.ctx)} |`);
        }
    }
    md.push('');
    // One line per round, with the OOM (a result of the scenario, not a failure) and the host at both ends.
    md.push('### Reprodução: uma linha por rodada', '', '| Rodada | Variante | Reproduções que tocaram | Pico do app (MB) | O kernel matou o renderer | Fase do salto (> 400 MB) | Host no início → fim | Calma |', '|---|---|---|---|---|---|---|---|');
    for (const p of out.play) {
        const played = (p.play.events || []).filter((e) => e.label && !e.label.endsWith('-back') && e.playingMs).length;
        md.push(`| ${p.dir} | ${p.play.variant || '?'} | ${played} | ${p.oom.peakMB || '–'} | ${p.oom.killed ? '**sim**' : 'não'} | ${p.oom.jumpPhase || '–'} | ${ctxText(p.ctx[0])} → ${ctxText(p.ctx[1])} | ${p.calm ? 'sim' : 'não'} |`);
    }
    md.push('');
    // OOM by condition: the count that decides things, with n and how many rounds were calm.
    const byCondition = {};
    for (const p of out.play) {
        const key = `${p.play.ipk || '?'} · ${p.play.variant || '?'}`;
        const c = byCondition[key] = byCondition[key] || { n: 0, killed: 0, calm: 0, killedCalm: 0 };
        c.n++; c.calm += p.calm ? 1 : 0;
        if (p.oom.killed) { c.killed++; c.killedCalm += p.calm ? 1 : 0; }
    }
    md.push('| Condição (IPK · core) | Rodadas | Com OOM | Rodadas calmas | Com OOM entre as calmas |', '|---|---|---|---|---|');
    for (const [key, c] of Object.entries(byCondition)) md.push(`| ${key} | ${c.n} | ${c.killed} | ${c.calm} | ${c.killedCalm} |`);
    md.push('');
}

if (out.cycles.length) {
    md.push('### Ciclos de Detalhes ↔ Board (streams-cycle)', '', '| Rodada | Core | Addon | Ciclos | RSS do app em cada fim de ciclo (MB) |', '|---|---|---|---|---|');
    for (const c of out.cycles) {
        md.push(`| ${c.dir} | ${c.cycle.variant} | ${c.cycle.addon ? 'sim' : 'não'} | ${c.cycle.cycles} | ${c.cycle.snapshots.map((s) => `${s.label.replace('cycle-', 'c')}: ${s.proc && s.proc.rssMB}`).join(', ')} |`);
    }
    md.push('');
}

const memRows = [...out.boot, ...out.nav, ...out.play].filter((x) => x.mem);
if (memRows.length) {
    md.push('### Memória por fase (RSS do processo do app, MB)', '', '| Rodada | Fase | Pico | Média | Último | Pipeline de mídia (pico) | Outros WebAppMgr (+) | MemAvailable mín. |', '|---|---|---|---|---|---|---|---|');
    for (const r of memRows) {
        for (const [phase, v] of Object.entries(r.mem.phases)) {
            md.push(`| ${r.dir} | ${phase} | ${fmt(v.appPeakMB)} | ${fmt(v.appMeanMB)} | ${fmt(v.appLastMB)} | ${fmt(v.mediaPeakMB)} | ${fmt(v.otherWebAppMgrGrowthMB)} | ${fmt(v.memAvailableMinMB)} |`);
        }
    }
    md.push('');
}

if (opts.json) fs.writeFileSync(opts.json, `${JSON.stringify(out, null, 2)}\n`);
console.log(md.join('\n'));
