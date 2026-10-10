// Test helpers: replay recorded fixtures (see tools/probe.mjs --record) as a readRange function.
// A read outside the recorded ranges fails the test instead of returning made-up bytes.

const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', '__fixtures__');

const loadFixture = (id) => {
    const meta = JSON.parse(fs.readFileSync(path.join(FIXTURES, id + '.json'), 'utf8'));
    const bin = fs.readFileSync(path.join(FIXTURES, id + '.bin'));
    let position = 0;
    const pieces = meta.pieces.map((piece) => {
        const data = new Uint8Array(bin.buffer, bin.byteOffset + position, piece.length);
        position += piece.length;
        return { offset: piece.offset, data };
    });
    return { meta, pieces };
};

const replayReadRange = (fixture) => {
    const size = fixture.meta.size;
    return (offset, length) => {
        const end = size === null ? offset + length : Math.min(offset + length, size);
        if (end <= offset) return Promise.resolve({ data: new Uint8Array(0), size });
        const piece = fixture.pieces.find((candidate) => candidate.offset <= offset && candidate.offset + candidate.data.length >= end);
        if (!piece) {
            return Promise.reject(new Error('fixture ' + fixture.meta.id + ' has no bytes for ' + offset + '-' + (end - 1)));
        }
        return Promise.resolve({ data: piece.data.subarray(offset - piece.offset, end - piece.offset), size });
    };
};

// readRange over an in-memory byte array (synthetic tests).
const bufferReadRange = (bytes) => (offset, length) => Promise.resolve({
    data: bytes.subarray(Math.min(offset, bytes.length), Math.min(offset + length, bytes.length)),
    size: bytes.length,
});

module.exports = {
    loadFixture,
    replayReadRange,
    bufferReadRange,
};
