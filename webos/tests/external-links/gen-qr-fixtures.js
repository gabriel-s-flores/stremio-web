#!/usr/bin/env node
// Regenerates qr-fixtures.json, the reference vectors of qr.test.js, with qrencode (libqrencode):
//   node webos/tests/external-links/gen-qr-fixtures.js
// For every version (1 to 40) and level (M, L) it takes a text just over the capacity of the version
// before it (odd versions) or exactly filling this one (even versions), so both ends of the capacity
// are covered, builds the code with qrencode (-v version -l level, no margin) and keeps the sha256 of its
// rows ('#' dark, '.' light, joined by '\n'). qr.js scores the masks a little differently, and when
// its mask differs from qrencode's for a text, the next seed of the text generator is tried (the
// seed is stored); a fixture is only written when the matrices are identical.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encode } = require('../../external-links/qr');
const { fixtureText, rowsOf } = require('./qr-fixture-text');

const LEVELS = ['M', 'L'];
const MAX_SEED = 40;

const qrencodeRows = (text, version, level) => {
    const file = path.join(os.tmpdir(), `qr-fixture-${process.pid}.txt`);
    fs.writeFileSync(file, text);
    const output = execFileSync('qrencode', ['-r', file, '-t', 'ASCII', '-m', '0', '-l', level, '-v', String(version), '-8']).toString();
    fs.unlinkSync(file);
    return output.split('\n').filter(Boolean).map((line) => {
        let row = '';
        for (let i = 0; i < line.length; i += 2) {
            row += line.substr(i, 2) === '##' ? '#' : '.';
        }
        return row;
    });
};

const entries = [];
const masks = {};
LEVELS.forEach((level) => {
    let previous = 0;
    for (let version = 1; version <= 40; version++) {
        // Binary search the capacity (monotonic in the length).
        let low = previous;
        let high = 3000;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            const qr = encode(fixtureText(mid, 0), { level });
            if (qr !== null && qr.version <= version) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        const max = low;
        if (max === 0 || (previous > 0 && max === previous)) {
            previous = max;
            continue;
        }
        const length = version % 2 === 1 ? Math.min(previous + 1, max) : max;
        previous = max;
        let found = null;
        for (let seed = 0; seed < MAX_SEED && !found; seed++) {
            const text = fixtureText(length, seed);
            const qr = encode(text, { level });
            const expected = qrencodeRows(text, version, level);
            if (qr.version === version && rowsOf(qr).join('\n') === expected.join('\n')) {
                found = { version, level, length, seed, mask: qr.mask, sha256: crypto.createHash('sha256').update(expected.join('\n')).digest('hex') };
            }
        }
        if (!found) {
            console.error(`no seed matches qrencode for ${version}-${level} (${length} bytes)`);
            continue;
        }
        masks[found.mask] = (masks[found.mask] || 0) + 1;
        entries.push(found);
    }
});

fs.writeFileSync(path.join(__dirname, 'qr-fixtures.json'), `${JSON.stringify(entries)}\n`);
console.log(`${entries.length} fixtures; masks used: ${JSON.stringify(masks)}`);
