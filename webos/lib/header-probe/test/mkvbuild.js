// Builds minimal Matroska files with one E-AC-3 track and one Cluster, to test lacing, header
// stripping and BlockGroup layouts (adapted from the F5.2 review fuzz kit).

const size8 = (n) => {
    const out = [0x01];
    const rest = [];
    let x = n;
    for (let i = 0; i < 7; i++) {
        rest.unshift(x % 256);
        x = Math.floor(x / 256);
    }
    return Buffer.from(out.concat(rest));
};
const element = (id, payload) => Buffer.concat([Buffer.from(id), size8(payload.length), payload]);
const uint = (value, length) => {
    const out = [];
    let x = value;
    for (let i = 0; i < (length || 1); i++) {
        out.unshift(x & 255);
        x >>>= 8;
    }
    return Buffer.from(out);
};
const ebmlSize = (n) => (n < 127 ? Buffer.from([0x80 | n]) : Buffer.from([0x40 | (n >> 8), n & 255]));

// frames: Buffers. lacing: 0 none, 1 Xiph, 2 fixed, 3 EBML. strip: bytes removed from every frame
// and declared as ContentCompAlgo 3. blockGroup: wrap in a BlockGroup, optionally with
// BlockDuration before the Block.
const buildMkv = ({ codecId, frames, lacing = 0, strip = null, blockGroup = false, durationFirst = false }) => {
    const ebml = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], Buffer.from('matroska')));
    const encodings = strip ? element([0x6d, 0x80], element([0x62, 0x40], Buffer.concat([
        element([0x50, 0x33], uint(0)),
        element([0x50, 0x34], Buffer.concat([element([0x42, 0x54], uint(3)), element([0x42, 0x55], Buffer.from(strip))])),
    ]))) : Buffer.alloc(0);
    const track = element([0xae], Buffer.concat([
        element([0xd7], uint(1)),
        element([0x83], uint(2)),
        element([0x86], Buffer.from(codecId)),
        element([0xe1], Buffer.concat([element([0x9f], uint(6)), element([0xb5], Buffer.from([0x40, 0xe7, 0x70, 0, 0, 0, 0, 0]))])),
        encodings,
    ]));
    const tracks = element([0x16, 0x54, 0xae, 0x6b], track);
    const info = element([0x15, 0x49, 0xa9, 0x66], element([0x2a, 0xd7, 0xb1], uint(1000000, 3)));
    const stored = frames.map((frame) => (strip ? frame.subarray(strip.length) : frame));
    let lace = Buffer.alloc(0);
    if (lacing === 1) {
        const parts = [uint(stored.length - 1)];
        for (let i = 0; i < stored.length - 1; i++) {
            const bytes = [];
            let remaining = stored[i].length;
            while (remaining >= 255) {
                bytes.push(255);
                remaining -= 255;
            }
            bytes.push(remaining);
            parts.push(Buffer.from(bytes));
        }
        lace = Buffer.concat(parts);
    } else if (lacing === 3) {
        const parts = [uint(stored.length - 1), ebmlSize(stored[0].length)];
        for (let i = 1; i < stored.length - 1; i++) {
            parts.push(Buffer.from([0x80 | (stored[i].length - stored[i - 1].length + 63)]));
        }
        lace = Buffer.concat(parts);
    } else if (lacing === 2) {
        lace = uint(stored.length - 1);
    }
    const flags = (lacing << 1) | (blockGroup ? 0 : 0x80);
    const payload = Buffer.concat([Buffer.from([0x81, 0, 0, flags]), lace, Buffer.concat(lacing ? stored : [stored[0]])]);
    let block;
    if (blockGroup) {
        const children = [element([0xa1], payload)];
        if (durationFirst) children.unshift(element([0x9b], uint(32)));
        block = element([0xa0], Buffer.concat(children));
    } else {
        block = element([0xa3], payload);
    }
    const cluster = element([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([element([0xe7], uint(0)), block]));
    const segment = element([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, tracks, cluster]));
    return new Uint8Array(Buffer.concat([ebml, segment]));
};

module.exports = {
    buildMkv,
};
