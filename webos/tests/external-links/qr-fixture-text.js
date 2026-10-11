// Deterministic texts of the QR reference vectors (shared by gen-qr-fixtures.js and qr.test.js):
// printable ASCII from a linear congruential generator, so the same (length, seed) is the same
// bytes everywhere.

const fixtureText = (length, seed) => {
    let state = (seed + 1) * 2654435761 % 4294967296;
    let text = '';
    for (let i = 0; i < length; i++) {
        state = (state * 1664525 + 1013904223) % 4294967296;
        text += String.fromCharCode(33 + Math.floor(state / 65536) % 94);
    }
    return text;
};

const rowsOf = (qr) => qr.modules.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''));

module.exports = { fixtureText, rowsOf };
