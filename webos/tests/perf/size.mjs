#!/usr/bin/env node
// Size of the build output and of the IPK (F7.1): raw and gzip, by kind, and the biggest files.
//
//   node webos/tests/perf/size.mjs --dir build-webos [--ipk dist-webos/x.ipk] [--compare build] [--json out.json]
//
// The webOS app is served from the TV's flash (file://), so the transfer size does not matter there;
// what matters is what the Chromium has to read and parse at boot. gzip is shown only to compare
// with the desktop build (which a server sends compressed).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
const dir = opt('dir');
if (!dir) { console.error('usage: size.mjs --dir <build dir> [--ipk x.ipk] [--compare <dir>] [--json out.json]'); process.exit(2); }

function walk(root) {
    const files = [];
    const visit = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) visit(p); else files.push(p);
        }
    };
    visit(root);
    return files;
}
const kind = (f) => {
    const ext = path.extname(f).toLowerCase();
    if (ext === '.map') return 'sourcemap';
    if (['.js', '.mjs'].includes(ext)) return 'js';
    if (ext === '.wasm') return 'wasm';
    if (ext === '.css') return 'css';
    if (['.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico', '.gif'].includes(ext)) return 'image';
    if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'font';
    if (['.json', '.html', '.txt'].includes(ext)) return 'data';
    return 'other';
};
const textual = new Set(['js', 'css', 'data', 'wasm', 'sourcemap']);
function measure(root) {
    const files = walk(root).map((f) => {
        const buf = fs.readFileSync(f);
        const k = kind(f);
        const name = path.relative(root, f);
        // The core as wasm2js is a JS file that is as big as the wasm: tell it apart.
        const label = /wasm2js|stremio_core_web/.test(name) && k === 'js' ? 'core-js' : k;
        return { name, kind: label, bytes: buf.length, gzip: textual.has(k) ? zlib.gzipSync(buf, { level: 9 }).length : null };
    });
    const byKind = {};
    for (const f of files) {
        const b = byKind[f.kind] = byKind[f.kind] || { files: 0, bytes: 0, gzip: 0 };
        b.files++; b.bytes += f.bytes; b.gzip += f.gzip || 0;
    }
    return { root, files: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0), byKind, biggest: files.sort((a, b) => b.bytes - a.bytes).slice(0, 12) };
}
const mb = (n) => (n / 1048576).toFixed(2).replace('.', ',');
const result = { webos: measure(dir), ipk: null, compare: null };
if (opt('ipk')) result.ipk = { file: path.basename(opt('ipk')), bytes: fs.statSync(opt('ipk')).size };
if (opt('compare')) result.compare = measure(opt('compare'));

const lines = [];
const table = (title, m) => {
    lines.push(`**${title}** (\`${m.root}\`: ${m.files} arquivos, ${mb(m.bytes)} MB)`, '', '| Tipo | Arquivos | Bruto (MB) | gzip (MB) |', '|---|---|---|---|');
    for (const [k, v] of Object.entries(m.byKind).sort((a, b) => b[1].bytes - a[1].bytes)) lines.push(`| ${k} | ${v.files} | ${mb(v.bytes)} | ${v.gzip ? mb(v.gzip) : '–'} |`);
    lines.push('', '| Maiores arquivos | Bruto (MB) | gzip (MB) |', '|---|---|---|');
    for (const f of m.biggest) lines.push(`| ${f.name} | ${mb(f.bytes)} | ${f.gzip ? mb(f.gzip) : '–'} |`);
    lines.push('');
};
table('Build webOS', result.webos);
if (result.ipk) lines.push(`IPK: \`${result.ipk.file}\`, ${mb(result.ipk.bytes)} MB`, '');
if (result.compare) table('Build desktop (comparação)', result.compare);
if (opt('json')) fs.writeFileSync(opt('json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(lines.join('\n'));
