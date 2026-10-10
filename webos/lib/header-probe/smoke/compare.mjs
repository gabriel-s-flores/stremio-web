#!/usr/bin/env node
/* eslint-disable no-console */
// Compares the emulator smoke results with the Node reference results (same files, same server).
//   node compare.mjs <emulator.json> <dir with node-<file>.json>
import fs from 'node:fs';
import path from 'node:path';

const [emulatorFile, nodeDir] = process.argv.slice(2);
let emulator = JSON.parse(fs.readFileSync(emulatorFile, 'utf8'));
if (typeof emulator === 'string') emulator = JSON.parse(emulator);
const strip = (result) => {
    const copy = JSON.parse(JSON.stringify(result));
    delete copy.elapsedMs;
    return copy;
};
let failures = 0;
console.log('userAgent: ' + emulator.userAgent);
for (const entry of emulator.results) {
    const nodeFile = path.join(nodeDir, 'node-' + entry.file.replace(/\//g, '_') + '.json');
    const reference = JSON.parse(fs.readFileSync(nodeFile, 'utf8'));
    const same = entry.ok && JSON.stringify(strip(entry.result)) === JSON.stringify(strip(reference));
    if (!same) failures++;
    const s = entry.ok ? entry.result.summary : null;
    const dv = s && s.dolbyVision ? ' DV ' + s.dolbyVision.profileName + '/' + s.dolbyVision.baseLayer : '';
    console.log((same ? 'OK   ' : 'FAIL ') + entry.file + (s ? ' -> ' + entry.result.container + ' ' + s.videoCodec + ' ' + s.hdr + dv +
        ' atmos=' + s.atmos + ' audio=' + s.audioCodecs.join('+') + ' (' + entry.result.stats.requests + ' req, ' + entry.result.stats.bytesRead + ' B)' : ' -> ' + JSON.stringify(entry.error)));
}
console.log(failures === 0 ? 'emulator == node for ' + emulator.results.length + ' file(s)' : failures + ' difference(s)');
process.exit(failures === 0 ? 0 : 1);
