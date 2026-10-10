#!/usr/bin/env node
/* eslint-disable no-console */
// Compares the rules output from the emulator with the Node reference, case by case.
//   node compare.mjs <emulator.json> <expected.json>      (exit 1 on any difference)
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const read = (file) => {
    let value = JSON.parse(fs.readFileSync(file, 'utf8'));
    // cdp.mjs prints the returned string as JSON, so the emulator output may be encoded twice.
    if (typeof value === 'string') value = JSON.parse(value);
    return value;
};

const emulator = read(process.argv[2]);
const expected = read(process.argv[3]);
const byId = {};
emulator.results.forEach((entry) => {
    byId[entry.id] = entry.result;
});

let failures = 0;
console.log('emulador: ' + emulator.userAgent + ' (' + emulator.results.length + ' casos em ' + emulator.ms + ' ms)');
expected.forEach((entry) => {
    const same = isDeepStrictEqual(byId[entry.id], entry.result);
    if (!same) failures++;
    const r = entry.result;
    console.log((same ? 'OK   ' : 'DIFF ') + entry.id.padEnd(52) + r.tier.padEnd(8) + String(r.score).padStart(6) + '  ' +
        r.labels.map((label) => label.text).join(', '));
});
console.log(failures === 0 ? 'todos os ' + expected.length + ' casos iguais ao Node' : failures + ' caso(s) diferente(s)');
process.exit(failures === 0 ? 0 : 1);
