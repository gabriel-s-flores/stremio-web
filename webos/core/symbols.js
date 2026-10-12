#!/usr/bin/env node
// Names for the minified functions of the vendored wasm2js (F8.6): a CPU profile of the core worker on
// the TV shows `Oe`, `XW`...; this maps them to the Rust symbols, so the profile says where the time goes.
//
//   node webos/core/symbols.js <work> <out.json>
//
// <work> is the build's work folder (webos/core/build --work, default ~/webos-tv-sdk/run/core-build),
// whose stremio-core-web/wasm_build/stremio_core_web_bg.wasm (the wasm-bindgen output, before wasm-opt)
// still has the name section. Steps:
// 1. wasm-opt -O --signext-lowering, the build's own step, twice: as is (must give the vendored .wasm,
//    byte for byte) and with -g (keeps the names; the code section must be the same);
// 2. wasm2js -O and the build's wrapper, then the build's terser (wasm2js-finish.js options) with a
//    source map; the code must be the vendored .wasm2js.js (before the parentheses of wasm2js-finish);
// 3. for every `function X(` of the minified code, the source map gives the wasm2js name ($N, N the
//    function index), and the name section of step 1 gives the symbol.
// Writes { sha256, functions: { <minified>: <symbol> } }. ~2 min and ~6 GB of memory (the terser).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const SDK = process.env.WEBOS_SDK || path.join(os.homedir(), 'webos-tv-sdk');
const BIN = path.join(SDK, 'tools', 'binaryen-version_133', 'bin');
const VENDOR = path.join(REPO, 'webos', 'vendor', 'stremio-core-web');
// A package of the repo's node_modules reached through a chain of dependencies (pnpm keeps them apart).
const fromChain = (...chain) => require(chain.reduce((from, name) => require.resolve(name, { paths: [path.dirname(from)] }), path.join(REPO, 'package.json')));
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const fail = (msg) => {
    console.error(`symbols: ${msg}`);
    process.exit(1);
};

// Wasm sections by id (the name section is a custom one, id 0).
const leb = (d, i) => {
    let r = 0;
    let s = 0;
    for (;;) {
        const b = d[i++];
        r |= (b & 0x7f) << s;
        s += 7;
        if (b < 0x80) return [r >>> 0, i];
    }
};
const sections = (d) => {
    const out = [];
    for (let i = 8; i < d.length;) {
        const id = d[i++];
        let n;
        [n, i] = leb(d, i);
        out.push({ id, body: d.subarray(i, i + n) });
        i += n;
    }
    return out;
};
const functionNames = (d) => {
    const names = new Map();
    for (const { id, body } of sections(d)) {
        if (id !== 0) continue;
        let [len, i] = leb(body, 0);
        if (body.subarray(i, i + len).toString() !== 'name') continue;
        i += len;
        while (i < body.length) {
            const kind = body[i++];
            let size;
            [size, i] = leb(body, i);
            const end = i + size;
            if (kind === 1) {
                let count;
                [count, i] = leb(body, i);
                for (let k = 0; k < count; k++) {
                    let index;
                    [index, i] = leb(body, i);
                    [len, i] = leb(body, i);
                    names.set(index, body.subarray(i, i + len).toString());
                    i += len;
                }
            }
            i = end;
        }
    }
    return names;
};

async function main() {
    const [work, out] = process.argv.slice(2);
    if (!work || !out) fail('uso: symbols.js <work> <out.json>');
    const input = path.join(work, 'src', 'stremio-core-web', 'wasm_build', 'stremio_core_web_bg.wasm');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-symbols-'));
    try {
        const plain = path.join(tmp, 'plain.wasm');
        const named = path.join(tmp, 'named.wasm');
        execFileSync(path.join(BIN, 'wasm-opt'), ['-O', '--signext-lowering', input, '-o', plain]);
        execFileSync(path.join(BIN, 'wasm-opt'), ['-O', '--signext-lowering', '-g', input, '-o', named]);
        const vendored = fs.readFileSync(path.join(VENDOR, 'stremio_core_web_bg.wasm'));
        if (sha(fs.readFileSync(plain)) !== sha(vendored)) fail('o wasm-opt da pasta de trabalho não dá o .wasm vendorizado');
        const code = (d) => sections(d).filter((s) => s.id === 10).map((s) => sha(s.body)).join();
        const namedBytes = fs.readFileSync(named);
        if (code(namedBytes) !== code(vendored)) fail('o wasm com -g tem outro código');
        const names = functionNames(namedBytes);

        // The build's wasm2js and wrapper (webos/core/build), then its terser with a source map.
        const mjs = path.join(tmp, 'w2js.mjs');
        execFileSync(path.join(BIN, 'wasm2js'), [plain, '-O', '-o', mjs]);
        const lines = fs.readFileSync(mjs, 'utf8').split('\n');
        const tail = lines.indexOf('var retasmFunc = asmFunc({');
        if (tail < 0) fail('saída do wasm2js em formato inesperado');
        const wrapped = [
            '// @stremio/stremio-core-web 0.65.0 (MVP) traduzido pelo wasm2js; gerado por webos/core/build.',
            '// Define a fábrica asmFunc(imports), que devolve os exports do core como um WebAssembly.Instance.',
            '(function (root, factory) {',
            "    if (typeof module === 'object' && module.exports) module.exports = factory();",
            '    else root.stremio_core_web_wasm2js = factory();',
            "})(typeof self !== 'undefined' ? self : this, function () {",
            lines.slice(1, tail).join('\n'),
            'return asmFunc;',
            '});',
            '',
        ].join('\n');
        const terser = fromChain('terser-webpack-plugin', 'terser');
        const result = await terser.minify({ 'w2js.js': wrapped }, { sourceMap: { asObject: true } });
        const minified = result.code.replace(/\n\/\/# sourceMappingURL=.*$/, '');
        // The vendored file is this plus the parentheses of wasm2js-finish (same length + 4).
        const vendoredJs = fs.readFileSync(path.join(VENDOR, 'stremio_core_web_bg.wasm2js.js'), 'utf8');
        if (vendoredJs.replace(/[()]/g, '') !== minified.replace(/[()]/g, '')) fail('o terser não deu o .wasm2js.js vendorizado');

        const { TraceMap, originalPositionFor } = fromChain('terser-webpack-plugin', 'terser', '@jridgewell/source-map', '@jridgewell/trace-mapping');
        const map = new TraceMap(result.map);
        const starts = [0];
        for (let i = 0; i < minified.length; i++) if (minified.charCodeAt(i) === 10) starts.push(i + 1);
        const lineOf = (pos) => {
            let lo = 0;
            let hi = starts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
            }
            return lo;
        };
        const functions = {};
        let unknown = 0;
        const re = /function ([A-Za-z_$][\w$]*)\(/g;
        let m;
        while ((m = re.exec(minified))) {
            const pos = m.index + 9;
            const line = lineOf(pos);
            const original = originalPositionFor(map, { line: line + 1, column: pos - starts[line] });
            const name = original && original.name;
            const index = name && /^\$(\d+)$/.exec(name);
            const symbol = index ? names.get(Number(index[1])) : name;
            if (!symbol) {
                unknown++;
                continue;
            }
            // Short names repeat in nested scopes: keep the asmFunc ones (the $N), which win.
            if (!functions[m[1]] || index) functions[m[1]] = symbol;
        }
        fs.writeFileSync(out, `${JSON.stringify({ sha256: sha(Buffer.from(vendoredJs)), functions }, null, 1)}\n`);
        console.error(`symbols: ${Object.keys(functions).length} funções com nome, ${unknown} sem`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

main().catch((err) => fail(String(err && (err.stack || err))));
