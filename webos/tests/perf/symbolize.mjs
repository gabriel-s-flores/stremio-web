#!/usr/bin/env node
// A CPU profile of the core worker with names (F8.6): the wasm2js functions of the vendored core are
// minified (`Oe`, `XW`...); webos/core/symbols.js maps them to the Rust symbols.
//
//   node webos/tests/perf/symbolize.mjs <profile.json|.cpuprofile> <symbols.json> [--top N] [--under <name>] [--any-url]
//
// Prints where the samples go: by entry point (what the worker was doing: get_state, dispatch, the
// futures of the core, the GC, idle), then self and total time per function (Rust hashes stripped).
// --under keeps only the samples with a frame whose name contains <name> (for example get_state).
// --any-url maps frames of any script (the core loaded without a URL, as core-bench.js does in Node);
// by default only the frames of *.wasm2js.js are mapped.
// Reads both profile formats: Chromium 53 (head tree, startTime/endTime in seconds) and newer (nodes).
import fs from 'node:fs';
import { parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const [file, symbolsFile] = args._;
if (!file || !symbolsFile) {
    console.error('usage: symbolize.mjs <profile> <symbols.json> [--top N] [--under <name>]');
    process.exit(2);
}
const TOP = Number(args.top || 30);
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const { functions } = JSON.parse(fs.readFileSync(symbolsFile, 'utf8'));

const flat = [];
const walk = (n) => {
    flat.push(n);
    (n.children || []).forEach((c) => (typeof c === 'object' ? walk(c) : null));
};
if (profile.nodes) flat.push(...profile.nodes); else walk(profile.head);
const nodes = new Map(flat.map((n) => [n.id, n]));
const parent = new Map();
flat.forEach((n) => (n.children || []).forEach((c) => parent.set(typeof c === 'object' ? c.id : c, n)));
const span = profile.endTime - profile.startTime;
// Chromium 53: seconds; newer: microseconds.
const spanMs = span < 1e5 ? span * 1000 : span / 1000;
const per = spanMs / profile.samples.length;

const nameOf = (n) => {
    const cf = n.callFrame || n;
    const name = cf.functionName || '(anon)';
    const url = String(cf.url || '');
    const symbol = (args['any-url'] || /wasm2js/.test(url)) && Object.prototype.hasOwnProperty.call(functions, name) ? functions[name] : name;
    return symbol.replace(/(__|::)h[0-9a-f]{16}E?$/, '').replace(/^_ZN.*?(\d+)/, '');
};

// What the worker was doing, from the outermost frames.
const ENTRY = [
    ['(idle)', /^\(idle\)$/],
    ['(garbage collector)', /^\(garbage collector\)$/],
    ['(program)', /^\(program\)$/],
    ['get_state', /^get_state$/],
    ['dispatch', /^dispatch$/],
    ['core futures (addon answers, storage, runtime)', /wasm_bindgen_futures|js_sys__futures|futures_util|__wbg_adapter|closure/],
];
const entry = new Map();
const self = new Map();
const total = new Map();
let kept = 0;
for (const s of profile.samples) {
    const chain = [];
    for (let n = nodes.get(s); n; n = parent.get(n.id)) chain.push(nameOf(n));
    if (args.under && !chain.some((c) => c.includes(args.under))) continue;
    kept++;
    const outer = [...chain].reverse();
    const hit = ENTRY.find(([, re]) => outer.some((c) => re.test(c)));
    const k = hit ? hit[0] : `other: ${outer.slice(1, 4).join(' > ')}`;
    entry.set(k, (entry.get(k) || 0) + 1);
    self.set(chain[0], (self.get(chain[0]) || 0) + 1);
    new Set(chain).forEach((c) => total.set(c, (total.get(c) || 0) + 1));
}
const line = (k, v) => `${(v * per / 1000).toFixed(2).padStart(7)} s ${(v / kept * 100).toFixed(1).padStart(5)} %  ${k.slice(0, 160)}`;
console.log(`${file}: ${(spanMs / 1000).toFixed(1)} s, ${profile.samples.length} samples${args.under ? `, ${kept} under "${args.under}"` : ''}`);
console.log('--- by entry point');
[...entry].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(line(k, v)));
console.log('--- self');
[...self].sort((a, b) => b[1] - a[1]).slice(0, TOP).forEach(([k, v]) => console.log(line(k, v)));
console.log('--- total');
[...total].sort((a, b) => b[1] - a[1]).slice(0, TOP).forEach(([k, v]) => console.log(line(k, v)));
