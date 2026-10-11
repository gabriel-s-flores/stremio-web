#!/usr/bin/env node
// Turns the output folders of boot.mjs / nav.mjs / play.mjs (run.sh) into markdown tables with the
// median and the spread, and says which rounds the host load disqualifies (F7.1).
//
//   node summarize.mjs [--max-load 8] [--max-ref 850] [--max-psi 60] [--json out.json] <out-dir>...
//
// A round is CALM when, before AND after it, the 1-minute load average is <= --max-load (the CPU count, 8: below it the VM's 40 % quota is what limits it) and the CPU
// reference loop is <= --max-ref ms (idle host: ~600 ms; BASELINE-C8.md explains the thresholds).
// Rounds that are not calm are listed apart and left out of the medians (`--include-busy` keeps them).
// Folder kinds are told apart by their files: boot.jsonl (boot), nav.json (nav), play.json (play).
import fs from 'node:fs';
import path from 'node:path';

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
const calm = (...ctxs) => ctxs.filter(Boolean).every((c) => c.load1 <= opts.maxLoad && !(c.psiCpu > opts.maxPsi) && (c.hostRefMs === null || c.hostRefMs === undefined || c.hostRefMs <= opts.maxRef));
const ctxText = (c) => (c ? `load ${fmt(c.load1)}/ref ${c.hostRefMs ?? '–'} ms/psi ${c.psiCpu ?? '–'}/pool ${c.poolBusy}` : '–');

const out = { opts, boot: [], nav: [], play: [] };
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
        out.nav.push({ dir: name, nav, calm: !nav.incomplete && calm(nav.ctxStart, nav.ctxEnd), mem });
    } else if (fs.existsSync(path.join(dir, 'play.json'))) {
        const play = read(path.join(dir, 'play.json'));
        out.play.push({ dir: name, play, calm: !play.incomplete && calm(play.ctxStart, play.ctxEnd), mem });
    }
}

if (out.boot.length) {
    md.push('### Boot', '', '| Rodada | IPK | Variante | Lançamento | Core pronto (s) | 1º item do Board (s) | Board com 2 linhas (s) | Host (carga/ref/pool) | Calma |', '|---|---|---|---|---|---|---|---|---|');
    for (const b of out.boot) {
        for (const r of b.rows) {
            md.push(`| ${b.dir} | ${b.info.ipk || '–'} | ${r.variant} | ${r.k}${r.warmup ? ' (aquec.)' : ''} | ${fmt(sec(r.coreReadyAt))} | ${fmt(sec(r.firstRowAt))} | ${fmt(sec(r.screenFullAt))} | ${ctxText(r.ctxBefore)} → ${ctxText(r.ctxAfter)} | ${r.calm ? 'sim' : 'não'} |`);
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
        for (const e of p.play.events.filter((x) => x.label && !x.label.endsWith('-back'))) {
            md.push(`| ${p.dir} | ${e.label} | ${fmt(sec(e.playerShellMs), 2)} | ${e.error ? e.error : e.failed ? 'falhou (120 s)' : fmt(sec(e.playingMs), 2)} | ${e.video ? `t=${e.video.t}s ready=${e.video.ready} ${e.video.w}x${e.video.h}` : '–'} | ${ctxText(e.ctx)} |`);
        }
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
