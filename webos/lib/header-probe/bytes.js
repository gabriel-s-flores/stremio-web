// Byte and bit helpers shared by the container parsers. Plain ES2015 on typed arrays: no Buffer,
// no Node APIs, so it runs on Chromium 53.

const TWO_POW_32 = 4294967296;

const u8 = (data, offset) => data[offset];

const u16 = (data, offset) => (data[offset] << 8) | data[offset + 1];

const u24 = (data, offset) => (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];

const u32 = (data, offset) => ((data[offset] << 24) >>> 0) + ((data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]);

const u64 = (data, offset) => u32(data, offset) * TWO_POW_32 + u32(data, offset + 4);

// Big-endian unsigned integer of any length up to 7 bytes (EBML uint elements).
const uint = (data, offset, length) => {
    let value = 0;
    for (let i = 0; i < length; i++) {
        value = value * 256 + data[offset + i];
    }
    return value;
};

const float = (data, offset, length) => {
    const view = new DataView(data.buffer, data.byteOffset + offset, length);
    if (length === 4) return view.getFloat32(0);
    if (length === 8) return view.getFloat64(0);
    return null;
};

const fourcc = (data, offset) => String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);

let utf8Decoder = null;
const text = (data, offset, length) => {
    const bytes = data.subarray(offset, offset + length);
    let end = bytes.indexOf(0);
    if (end === -1) end = bytes.length;
    if (utf8Decoder === null && typeof TextDecoder === 'function') {
        utf8Decoder = new TextDecoder('utf-8');
    }
    if (utf8Decoder !== null) {
        return utf8Decoder.decode(bytes.subarray(0, end));
    }
    let result = '';
    for (let i = 0; i < end; i++) {
        result += String.fromCharCode(bytes[i]);
    }
    try {
        return decodeURIComponent(escape(result));
    } catch (_e) {
        return result;
    }
};

const indexOfSequence = (data, sequence, from, to) => {
    const last = Math.min(to === undefined ? data.length : to, data.length) - sequence.length;
    for (let i = from || 0; i <= last; i++) {
        let match = true;
        for (let j = 0; j < sequence.length; j++) {
            if (data[i + j] !== sequence[j]) {
                match = false;
                break;
            }
        }
        if (match) return i;
    }
    return -1;
};

// MSB-first bit reader over a byte array, with exp-Golomb codes for H.264/HEVC parameter sets.
class BitReader {
    constructor(data, offset, length) {
        this.data = data;
        this.position = (offset || 0) * 8;
        this.end = ((offset || 0) + (length === undefined ? data.length - (offset || 0) : length)) * 8;
    }

    bits(count) {
        if (this.position + count > this.end) {
            throw new RangeError('BitReader: read past end');
        }
        let value = 0;
        for (let i = 0; i < count; i++) {
            const byte = this.data[this.position >> 3];
            value = value * 2 + ((byte >> (7 - (this.position & 7))) & 1);
            this.position++;
        }
        return value;
    }

    bit() {
        return this.bits(1);
    }

    skip(count) {
        if (this.position + count > this.end) {
            throw new RangeError('BitReader: skip past end');
        }
        this.position += count;
    }

    ue() {
        let zeros = 0;
        while (this.bit() === 0) {
            zeros++;
            if (zeros > 31) throw new RangeError('BitReader: invalid exp-Golomb code');
        }
        return zeros === 0 ? 0 : (Math.pow(2, zeros) - 1) + this.bits(zeros);
    }

    se() {
        const value = this.ue();
        return value % 2 === 1 ? (value + 1) / 2 : -(value / 2);
    }

    remaining() {
        return this.end - this.position;
    }
}

// Removes H.264/HEVC emulation prevention bytes (00 00 03 -> 00 00).
const unescapeRbsp = (data, offset, length) => {
    const out = new Uint8Array(length);
    let size = 0;
    let zeros = 0;
    for (let i = offset; i < offset + length; i++) {
        const byte = data[i];
        if (zeros >= 2 && byte === 3) {
            zeros = 0;
            continue;
        }
        out[size++] = byte;
        zeros = byte === 0 ? zeros + 1 : 0;
    }
    return out.subarray(0, size);
};

module.exports = {
    u8,
    u16,
    u24,
    u32,
    u64,
    uint,
    float,
    fourcc,
    text,
    indexOfSequence,
    unescapeRbsp,
    BitReader,
};
