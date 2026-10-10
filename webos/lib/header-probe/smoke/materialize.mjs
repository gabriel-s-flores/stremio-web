#!/usr/bin/env node
/* eslint-disable no-console */
// Turns each recorded fixture (__fixtures__/<id>.json + .bin) back into a sparse file of the
// original size, holding the recorded bytes at their original offsets (the rest reads as zeros).
// The probe only reads recorded ranges, so serving these files over HTTP reproduces the original
// requests. Also links extra media files given on the command line.
//   node materialize.mjs <outDir> [extra media files...]   -> prints the file names, one per line
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, '..', '__fixtures__');
const [outDir, ...extra] = process.argv.slice(2);
if (!outDir) {
    console.error('usage: materialize.mjs <outDir> [extra media files...]');
    process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const names = [];
for (const file of fs.readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
    const bin = fs.readFileSync(path.join(FIXTURES, meta.id + '.bin'));
    const ext = (/\.(mkv|mp4|m4v|mov|webm)(?:$|\?)/i.exec(meta.source) || [null, 'bin'])[1].toLowerCase();
    const name = meta.id + '.' + ext;
    const target = path.join(outDir, name);
    const last = meta.pieces[meta.pieces.length - 1];
    const fd = fs.openSync(target, 'w');
    fs.ftruncateSync(fd, meta.size || last.offset + last.length);
    let position = 0;
    for (const piece of meta.pieces) {
        fs.writeSync(fd, bin, position, piece.length, piece.offset);
        position += piece.length;
    }
    fs.closeSync(fd);
    names.push(name);
}
for (const file of extra) {
    const name = path.basename(file);
    fs.rmSync(path.join(outDir, name), { force: true });
    fs.symlinkSync(path.resolve(file), path.join(outDir, name));
    names.push(name);
}
console.log(names.join('\n'));
