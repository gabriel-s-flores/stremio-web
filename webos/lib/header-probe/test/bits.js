// Test helpers: bit packing and synthetic codec frames.

// Packs [value, bitCount] pairs MSB first, padded with zeros to whole bytes.
const pack = (fields) => {
    const bits = [];
    fields.forEach(([value, count]) => {
        for (let i = count - 1; i >= 0; i--) bits.push(Math.floor(value / Math.pow(2, i)) % 2);
    });
    while (bits.length % 8 !== 0) bits.push(0);
    const out = new Uint8Array(bits.length / 8);
    bits.forEach((bit, i) => {
        out[i >> 3] |= bit << (7 - (i & 7));
    });
    return out;
};

// Independent E-AC-3 5.1 syncframe header, 6 blocks, no mixing/info metadata, addbsi carrying
// flag_ec3_extension_type_a = joc. Padded to `size` bytes.
const eac3Frame = (joc, size) => {
    const header = pack([
        [0x0b77, 16], [0, 2], [0, 3], [767, 11], [0, 2], [3, 2], [7, 3], [1, 1], [16, 5],
        [31, 5], [0, 1], [0, 1], [0, 1], [1, 1], [1, 6], [joc ? 1 : 0, 8], [joc ? 16 : 0, 8],
    ]);
    const out = new Uint8Array(size || 64);
    out.set(header, 0);
    return out;
};

// TrueHD access unit start: 4-byte AU header, major sync (format_info for 7.1 at 48 kHz), signature,
// flags, VBR/peak rate, substream count and substream_info (Atmos bit = 0x80).
const truehdFrame = (substreams, substreamInfo) => {
    const out = new Uint8Array(64);
    out.set(pack([
        [0xf000, 16], [0, 16],
        [0xf8726fba, 32],
        [0, 4], [0, 4], [0, 2], [0, 2], [0b01111, 5], [0, 2], [0b1001111, 13],
        [0xb752, 16], [0, 16], [0, 16], [0, 1], [0, 15], [substreams, 4], [0, 2], [0, 2], [substreamInfo, 8],
    ]), 0);
    return out;
};

module.exports = {
    pack,
    eac3Frame,
    truehdFrame,
};
