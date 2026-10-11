#!/usr/bin/env node
// Visual regression of the screens (F2.7): compares captures of webos/tests/screens/run with the
// references in git, or writes new references.
//
//   visual.mjs compare <capture folder> [--refs <folder>] [--out <report folder>] [--scene a,b] [--desktop <folder>]
//   visual.mjs update  <capture folder> [--refs <folder>] [--scene a,b]
//
// References (webos/tests/screens/refs/emulator/<scene>.png) are the captures reduced to 480x270 (area
// average, 8-bit RGB PNG): about 40-60 KB each, enough to see layout, colors and the focus ring, and small
// for git. A capture is reduced the same way and compared pixel by pixel (visual-lib.js: share of changed
// pixels and the worst 16x16 block); regions of dynamic content are masked by scene in visual.config.json.
// `compare` writes <report folder>/index.html (reference, new, difference per scene; --desktop adds the
// desktop capture of the same scene, for reading) and exits 1 when a scene is over its limits, has no
// reference or has no capture. Needs ImageMagick 7 (`magick`), like compare.sh.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const lib = require('./visual-lib.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const [command, captureArg] = args;
const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : fallback;
};
const fail = (message) => {
    console.error(message);
    process.exit(2);
};
if (!['compare', 'update'].includes(command) || !captureArg) {
    fail('usage: visual.mjs compare|update <capture folder> [--refs <folder>] [--out <report folder>] [--scene a,b] [--desktop <folder>]');
}

const captureDir = path.resolve(captureArg);
const refsDir = path.resolve(option('refs', path.join(HERE, 'refs', 'emulator')));
const only = option('scene', null) ? option('scene').split(',').filter(Boolean) : null;
const config = JSON.parse(fs.readFileSync(path.join(HERE, 'visual.config.json'), 'utf8'));
const pngs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith('.png')).map((file) => file.slice(0, -4)) : []);

const magick = (input, extra, output) => execFileSync('magick', [...input, ...extra, ...output], { maxBuffer: 64 * 1024 * 1024 });
// The capture or reference as raw 480x270 RGB.
const reduce = (file) => magick([file], ['-filter', 'Box', '-resize', `${lib.WIDTH}x${lib.HEIGHT}!`, '-alpha', 'off', '-depth', '8'], ['rgb:-']);
const writeRaw = (buffer, file) => {
    execFileSync('magick', ['-size', `${lib.WIDTH}x${lib.HEIGHT}`, '-depth', '8', 'rgb:-', '-strip', file], { input: buffer });
};

const names = (...lists) => [...new Set(lists.flat())].filter((name) => !only || only.includes(name)).sort();

if (command === 'update') {
    const scenes = names(pngs(captureDir));
    if (scenes.length === 0) fail(`no capture in ${captureDir}`);
    fs.mkdirSync(refsDir, { recursive: true });
    let total = 0;
    scenes.forEach((scene) => {
        const file = path.join(refsDir, `${scene}.png`);
        // Reduced and recompressed in one step: the PNG is made from the same pixels `compare` reads.
        magick([path.join(captureDir, `${scene}.png`)], ['-filter', 'Box', '-resize', `${lib.WIDTH}x${lib.HEIGHT}!`, '-alpha', 'off', '-depth', '8', '-strip', '-define', 'png:compression-level=9'], [file]);
        total += fs.statSync(file).size;
        console.log(`updated ${path.relative(process.cwd(), file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
    });
    console.log(`${scenes.length} references, ${Math.round(total / 1024)} KB`);
    process.exit(0);
}

const outDir = path.resolve(option('out', path.join(captureDir, 'visual')));
const desktopDir = option('desktop', null) ? path.resolve(option('desktop')) : null;
fs.mkdirSync(outDir, { recursive: true });
const scenes = names(pngs(refsDir), pngs(captureDir));
if (scenes.length === 0) fail(`no reference in ${refsDir} nor capture in ${captureDir}`);

const results = scenes.map((scene) => {
    const refFile = path.join(refsDir, `${scene}.png`);
    const newFile = path.join(captureDir, `${scene}.png`);
    const settings = config.scenes?.[scene] || {};
    const limits = { ...config.default, ...Object.fromEntries(['pixel', 'ratio', 'block'].filter((key) => key in settings).map((key) => [key, settings[key]])) };
    const result = { scene, masks: settings.masks || [], limits };
    if (!fs.existsSync(refFile)) return { ...result, status: 'no-reference' };
    if (!fs.existsSync(newFile)) return { ...result, status: 'no-capture' };
    const reference = reduce(refFile);
    const capture = reduce(newFile);
    const outcome = lib.compare(reference, capture, result.masks, limits);
    writeRaw(reference, path.join(outDir, `${scene}-ref.png`));
    writeRaw(capture, path.join(outDir, `${scene}-new.png`));
    writeRaw(outcome.image, path.join(outDir, `${scene}-diff.png`));
    if (!outcome.pass) fs.copyFileSync(newFile, path.join(outDir, `${scene}-full.png`));
    return {
        ...result,
        status: outcome.pass ? 'pass' : 'fail',
        ratio: outcome.ratio,
        block: outcome.worstBlock.ratio,
        blockAt: [outcome.worstBlock.x, outcome.worstBlock.y],
        meanDelta: outcome.meanDelta,
    };
});

const percent = (value) => `${(value * 100).toFixed(3)}%`;
const LABEL = { pass: 'ok', fail: 'FAIL', 'no-reference': 'NO REFERENCE (run update)', 'no-capture': 'NO CAPTURE' };
const lines = results.map((r) => {
    const detail = r.status === 'pass' || r.status === 'fail'
        ? `changed ${percent(r.ratio)} (limit ${percent(r.limits.ratio)}), worst block ${percent(r.block)} at ${r.blockAt.join(',')} (limit ${percent(r.limits.block)})`
        : '';
    return `${LABEL[r.status].padEnd(26)} ${r.scene.padEnd(16)} ${detail}`;
});
console.log(lines.join('\n'));
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(results.map(({ masks, ...rest }) => rest), null, 2));

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const order = { fail: 0, 'no-reference': 1, 'no-capture': 2, pass: 3 };
const sections = [...results].sort((a, b) => order[a.status] - order[b.status] || a.scene.localeCompare(b.scene)).map((r) => {
    const images = r.status === 'pass' || r.status === 'fail'
        ? ['ref', 'new', 'diff'].map((kind) => `<figure><img src="${r.scene}-${kind}.png"><figcaption>${{ ref: 'reference', new: 'new', diff: 'difference' }[kind]}</figcaption></figure>`).join('')
        + (desktopDir && fs.existsSync(path.join(desktopDir, `${r.scene}.png`)) ? `<figure><img src="${path.relative(outDir, path.join(desktopDir, `${r.scene}.png`))}"><figcaption>desktop</figcaption></figure>` : '')
        : '';
    const metrics = r.status === 'pass' || r.status === 'fail'
        ? `<p>changed ${percent(r.ratio)} of the pixels (limit ${percent(r.limits.ratio)}); worst block ${percent(r.block)} at ${r.blockAt.join(',')} (limit ${percent(r.limits.block)})${r.masks.length ? `; ${r.masks.length} masked region(s)` : ''}${r.status === 'fail' ? ` · <a href="${r.scene}-full.png">full capture</a>` : ''}</p>`
        : '';
    return `<section class="${r.status}"><h2>${escape(r.scene)} <span>${LABEL[r.status]}</span></h2>${metrics}<div class="row">${images}</div></section>`;
});
const failed = results.filter((r) => r.status !== 'pass').length;
fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Visual regression</title>
<style>
body{background:#14141c;color:#ddd;font:14px/1.4 sans-serif;margin:16px}
h1{font-size:20px}h2{font-size:16px;margin:0}h2 span{font-size:12px;padding:1px 6px;border-radius:3px;background:#2e7d32}
section{margin:0 0 22px;padding:8px;border-left:4px solid #2e7d32}section.pass{opacity:.75}
section:not(.pass){border-color:#c62828}section:not(.pass) h2 span{background:#c62828}
.row{display:flex;gap:10px;flex-wrap:wrap}figure{margin:0}img{width:480px;height:270px;image-rendering:pixelated;border:1px solid #333;display:block}
figcaption{font-size:12px;color:#999}a{color:#8ab4f8}
</style>
<h1>Visual regression: ${failed ? `${failed} of ${results.length} scenes need attention` : `${results.length} scenes ok`}</h1>
<p>References: <code>${escape(path.relative(process.cwd(), refsDir))}</code>, captures: <code>${escape(path.relative(process.cwd(), captureDir))}</code>. Red in the difference: pixels changed beyond the tolerance; dark blue: masked regions.</p>
${sections.join('\n')}`);
console.log(`report: ${path.relative(process.cwd(), path.join(outDir, 'index.html'))}`);
process.exit(failed ? 1 : 0);
