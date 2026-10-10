#!/usr/bin/env node
/* eslint-disable no-console */
// Dev tool (Node only, not shipped): runs the header probe on a URL or a local file and prints
// the JSON result. With --record <id>, saves the bytes the probe read as a test fixture:
//   __fixtures__/<id>.bin   the recorded byte ranges, concatenated
//   __fixtures__/<id>.json  { id, source, size, options, pieces: [{ offset, length }], sha256 }
//
//   node tools/probe.mjs <url|file> [--record <id> [--source <url or label>]] [--block-size N] [--no-sniff] [--summary]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { probe, createFetchReadRange } = require('../index.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => {
    const index = args.indexOf(name);
    if (index === -1) return null;
    const value = args[index + 1];
    args.splice(index, 2);
    return value;
};
const toggle = (name) => {
    const index = args.indexOf(name);
    if (index !== -1) args.splice(index, 1);
    return index !== -1;
};
const recordId = flag('--record');
const sourceLabel = flag('--source');
const blockSize = flag('--block-size');
const noSniff = toggle('--no-sniff');
const summaryOnly = toggle('--summary');
const target = args[0];
if (!target) {
    console.error('usage: probe.mjs <url|file> [--record <id>] [--block-size N] [--no-sniff] [--summary]');
    process.exit(1);
}

const fileReadRange = (file) => {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    return (offset, length) => {
        const available = Math.max(0, Math.min(length, size - offset));
        const buffer = Buffer.alloc(available);
        fs.readSync(fd, buffer, 0, available, offset);
        return Promise.resolve({ data: new Uint8Array(buffer.buffer, buffer.byteOffset, available), size });
    };
};

const options = { sniffFrames: !noSniff };
if (blockSize) options.blockSize = Number(blockSize);
const baseReadRange = /^https?:\/\//.test(target) ? createFetchReadRange(target) : fileReadRange(target);
const reads = [];
let totalSize = null;
const readRange = (offset, length) => baseReadRange(offset, length).then((result) => {
    reads.push({ offset, data: result.data });
    if (result.size !== null) totalSize = result.size;
    return result;
});

const mergePieces = () => {
    const sorted = reads.slice().sort((a, b) => a.offset - b.offset);
    const pieces = [];
    sorted.forEach((read) => {
        const last = pieces[pieces.length - 1];
        const end = read.offset + read.data.length;
        if (last && read.offset <= last.offset + last.data.length) {
            if (end > last.offset + last.data.length) {
                const merged = new Uint8Array(end - last.offset);
                merged.set(last.data, 0);
                merged.set(read.data, read.offset - last.offset);
                last.data = merged;
            }
        } else {
            pieces.push({ offset: read.offset, data: read.data });
        }
    });
    return pieces;
};

const started = Date.now();
probe(readRange, options).then((result) => {
    result.elapsedMs = Date.now() - started;
    console.log(JSON.stringify(summaryOnly ? { container: result.container, summary: result.summary, stats: result.stats, warnings: result.warnings } : result, null, 2));
    if (!recordId) return;
    const pieces = mergePieces();
    const bin = Buffer.concat(pieces.map((piece) => Buffer.from(piece.data)));
    const dir = path.join(HERE, '..', '__fixtures__');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, recordId + '.bin'), bin);
    const meta = {
        id: recordId,
        source: sourceLabel || target,
        size: totalSize,
        options,
        pieces: pieces.map((piece) => ({ offset: piece.offset, length: piece.data.length })),
        bytes: bin.length,
        sha256: crypto.createHash('sha256').update(bin).digest('hex'),
    };
    fs.writeFileSync(path.join(dir, recordId + '.json'), JSON.stringify(meta, null, 4) + '\n');
    console.error('recorded ' + recordId + ': ' + bin.length + ' bytes in ' + pieces.length + ' piece(s)');
}).catch((error) => {
    console.error('probe failed:', error && error.code, error && error.message);
    process.exit(2);
});
