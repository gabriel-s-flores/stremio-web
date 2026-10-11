#!/usr/bin/env node
// SVG of the memory curve of a run (F7.1): the app renderer's RSS (the WebAppMgr process that was not
// there before the first phase) and the guest's free memory (MemAvailable) over time, the phases as
// vertical marks, the G7 goal (250 MB) and the level where the kernel killed the renderer (~520-560 MB).
//   node mem-chart.mjs <mem.log> <phases.jsonl> <out.svg> [title]
import fs from 'node:fs';

const [memFile, phasesFile, outFile, title = ''] = process.argv.slice(2);
if (!memFile || !phasesFile || !outFile) {
    console.error('usage: mem-chart.mjs <mem.log> <phases.jsonl> <out.svg> [title]');
    process.exit(2);
}
const samples = [];
for (const line of fs.readFileSync(memFile, 'utf8').split('\n')) {
    const p = line.trim().split(' ');
    if (p.length < 2 || !/^\d+$/.test(p[0]) || !/^\d+$/.test(p[1])) continue;
    const procs = {};
    for (const item of p.slice(2)) { const [name, pid, rss] = item.split(':'); if (pid && rss) procs[pid] = { name, rss: Number(rss) }; }
    samples.push({ t: Number(p[0]), avail: Number(p[1]), procs });
}
const phases = fs.readFileSync(phasesFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const t0 = phases[0].t;
const baseline = new Set(samples.filter((s) => s.t < t0).flatMap((s) => Object.keys(s.procs)));
const tEnd = phases[phases.length - 1].t + 5000;
const pts = samples.filter((s) => s.t >= t0 - 8000 && s.t <= tEnd).map((s) => {
    let app = 0;
    for (const [pid, p] of Object.entries(s.procs)) if (!baseline.has(pid) && p.name === 'WebAppMgr' && p.rss > app) app = p.rss;
    return { x: (s.t - t0) / 1000, app: app / 1024, avail: s.avail / 1024 };
});
const W = 1100, H = 420, L = 56, R = 16, T = 40, B = 70;
const xmax = Math.max(...pts.map((p) => p.x), 1);
const ymax = Math.ceil(Math.max(600, ...pts.map((p) => p.app), ...pts.map((p) => p.avail)) / 100) * 100;
const X = (x) => L + ((x + 8) / (xmax + 8)) * (W - L - R);
const Y = (y) => T + (1 - y / ymax) * (H - T - B);
const line = (key, color, dash = '') => `<polyline fill="none" stroke="${color}" stroke-width="1.6" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${pts.filter((p) => key !== 'app' || p.app > 0).map((p) => `${X(p.x).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ')}"/>`;
const svg = [];
svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="sans-serif" font-size="11">`);
svg.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
svg.push(`<text x="${L}" y="20" font-size="14" font-weight="bold">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);
for (let y = 0; y <= ymax; y += 100) svg.push(`<line x1="${L}" x2="${W - R}" y1="${Y(y)}" y2="${Y(y)}" stroke="#e5e5e5"/><text x="${L - 6}" y="${Y(y) + 4}" text-anchor="end" fill="#555">${y}</text>`);
for (let x = 0; x <= xmax; x += 60) svg.push(`<text x="${X(x)}" y="${H - B + 14}" text-anchor="middle" fill="#555">${x}s</text>`);
svg.push(`<line x1="${L}" x2="${W - R}" y1="${Y(250)}" y2="${Y(250)}" stroke="#2a9d3a" stroke-dasharray="6 4"/><text x="${W - R - 4}" y="${Y(250) - 4}" text-anchor="end" fill="#2a9d3a">meta G7: 250 MB</text>`);
svg.push(`<line x1="${L}" x2="${W - R}" y1="${Y(520)}" y2="${Y(520)}" stroke="#c0392b" stroke-dasharray="2 3"/><text x="${W - R - 4}" y="${Y(520) - 4}" text-anchor="end" fill="#c0392b">OOM do kernel (~520-560 MB)</text>`);
phases.forEach((p, i) => {
    const x = X((p.t - t0) / 1000);
    svg.push(`<line x1="${x}" x2="${x}" y1="${T}" y2="${H - B}" stroke="#bbb" stroke-dasharray="1 3"/>`);
    svg.push(`<text transform="translate(${x + 3},${H - B + 22}) rotate(40)" fill="#444" font-size="10">${p.name}</text>`);
});
svg.push(line('app', '#1f5fbf'), line('avail', '#d98a00', '4 3'));
svg.push(`<text x="${L + 6}" y="${T + 12}" fill="#1f5fbf">— RSS do processo do app (MB)</text><text x="${L + 6}" y="${T + 26}" fill="#d98a00">- - memória livre do convidado (MemAvailable, MB)</text>`);
svg.push('</svg>');
fs.writeFileSync(outFile, `${svg.join('\n')}\n`);
console.log(`wrote ${outFile}`);
