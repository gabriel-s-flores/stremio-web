// Small QR Code generator (byte mode, error correction L or M, versions 1 to 40), written for the
// external links dialog (F3.4). No dependencies; plain ES2015 for the Chromium 53 of webOS TV 4.x.
// Follows ISO/IEC 18004: function patterns, Reed-Solomon over GF(256) (0x11D), zigzag placement,
// the eight masks scored with the standard penalty rules, BCH format and version information.
//
//   const { encode, toPath } = require('./qr');
//   const qr = encode('https://www.stremio.com/');   // { size, version, level, mask, modules }
//   qr.modules[y][x]                                 // true = dark module
//   toPath(qr)                                       // SVG path data in module units (no quiet zone)

// Per version (index 0 is unused), per error correction level.
const ECC_CODEWORDS_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
};
const NUM_ERROR_CORRECTION_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
};
// Two format bits of each level (not in alphabetical order, as in the standard).
const FORMAT_BITS = { L: 1, M: 0 };

const MIN_VERSION = 1;
const MAX_VERSION = 40;

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

const toUtf8 = (text) => {
    const bytes = [];
    const encoded = unescape(encodeURIComponent(text));
    for (let i = 0; i < encoded.length; i++) {
        bytes.push(encoded.charCodeAt(i));
    }
    return bytes;
};

const getBit = (value, index) => ((value >>> index) & 1) !== 0;

const getNumRawDataModules = (version) => {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const numAlign = Math.floor(version / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (version >= 7) {
            result -= 36;
        }
    }
    return result;
};

const getNumDataCodewords = (version, level) => (
    Math.floor(getNumRawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[level][version] * NUM_ERROR_CORRECTION_BLOCKS[level][version]
);

const getAlignmentPatternPositions = (version) => {
    if (version === 1) {
        return [];
    }
    const numAlign = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let position = version * 4 + 10; result.length < numAlign; position -= step) {
        result.splice(1, 0, position);
    }
    return result;
};

// Byte-mode segment: mode 0100, character count (8 bits up to version 9, 16 after), the bytes.
const buildDataBits = (bytes, version) => {
    const bits = [];
    const append = (value, length) => {
        for (let i = length - 1; i >= 0; i--) {
            bits.push((value >>> i) & 1);
        }
    };
    append(4, 4);
    append(bytes.length, version <= 9 ? 8 : 16);
    bytes.forEach((byte) => append(byte, 8));
    return { bits, append };
};

const buildDataCodewords = (bytes, version, level) => {
    const capacityBits = getNumDataCodewords(version, level) * 8;
    const { bits, append } = buildDataBits(bytes, version);
    append(0, Math.min(4, capacityBits - bits.length));
    append(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < capacityBits; pad ^= 0xEC ^ 0x11) {
        append(pad, 8);
    }
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
        let codeword = 0;
        for (let j = 0; j < 8; j++) {
            codeword = (codeword << 1) | bits[i + j];
        }
        codewords.push(codeword);
    }
    return codewords;
};

const gfMultiply = (x, y) => {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11D);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
};

const reedSolomonDivisor = (degree) => {
    const result = [];
    for (let i = 0; i < degree - 1; i++) {
        result.push(0);
    }
    result.push(1);
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < result.length; j++) {
            result[j] = gfMultiply(result[j], root);
            if (j + 1 < result.length) {
                result[j] ^= result[j + 1];
            }
        }
        root = gfMultiply(root, 0x02);
    }
    return result;
};

const reedSolomonRemainder = (data, divisor) => {
    const result = divisor.map(() => 0);
    data.forEach((byte) => {
        const factor = byte ^ result.shift();
        result.push(0);
        divisor.forEach((coefficient, i) => {
            result[i] ^= gfMultiply(coefficient, factor);
        });
    });
    return result;
};

// Splits the data into blocks, appends each block's error correction and interleaves the result.
const addEccAndInterleave = (data, version, level) => {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[level][version];
    const blockEccLength = ECC_CODEWORDS_PER_BLOCK[level][version];
    const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
    const numShortBlocks = numBlocks - rawCodewords % numBlocks;
    const shortBlockLength = Math.floor(rawCodewords / numBlocks);
    const divisor = reedSolomonDivisor(blockEccLength);
    const blocks = [];
    for (let i = 0, offset = 0; i < numBlocks; i++) {
        const dataLength = shortBlockLength - blockEccLength + (i < numShortBlocks ? 0 : 1);
        const block = data.slice(offset, offset + dataLength);
        offset += dataLength;
        const ecc = reedSolomonRemainder(block, divisor);
        if (i < numShortBlocks) {
            block.push(0);
        }
        blocks.push(block.concat(ecc));
    }
    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
        blocks.forEach((block, j) => {
            // The padding slot of a short block is skipped.
            if (i !== shortBlockLength - blockEccLength || j >= numShortBlocks) {
                result.push(block[i]);
            }
        });
    }
    return result;
};

const createGrid = (size) => {
    const rows = [];
    for (let y = 0; y < size; y++) {
        rows.push(new Array(size).fill(false));
    }
    return rows;
};

// `modules` holds the colors and `isFunction` marks what the data must not overwrite.
const drawFunctionPatterns = (version, size, modules, isFunction) => {
    const setFunctionModule = (x, y, dark) => {
        modules[y][x] = dark;
        isFunction[y][x] = true;
    };

    for (let i = 0; i < size; i++) {
        setFunctionModule(6, i, i % 2 === 0);
        setFunctionModule(i, 6, i % 2 === 0);
    }

    const drawFinder = (cx, cy) => {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const distance = Math.max(Math.abs(dx), Math.abs(dy));
                const x = cx + dx;
                const y = cy + dy;
                if (x >= 0 && x < size && y >= 0 && y < size) {
                    setFunctionModule(x, y, distance !== 2 && distance !== 4);
                }
            }
        }
    };
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);

    const positions = getAlignmentPatternPositions(version);
    positions.forEach((cy, i) => {
        positions.forEach((cx, j) => {
            const onFinder = (i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0);
            if (!onFinder) {
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        setFunctionModule(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
                    }
                }
            }
        });
    });

    // Format information area: reserved here (the timing modules in it keep their color) and drawn
    // once the mask is known. The module beside the lower-left finder is always dark.
    for (let i = 0; i < 9; i++) {
        isFunction[i][8] = true;
        isFunction[8][i] = true;
    }
    for (let i = 0; i < 8; i++) {
        isFunction[8][size - 1 - i] = true;
        isFunction[size - 1 - i][8] = true;
    }
    setFunctionModule(8, size - 8, true);

    if (version >= 7) {
        let remainder = version;
        for (let i = 0; i < 12; i++) {
            remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1F25);
        }
        const bits = (version << 12) | remainder;
        for (let i = 0; i < 18; i++) {
            const dark = getBit(bits, i);
            const a = size - 11 + i % 3;
            const b = Math.floor(i / 3);
            setFunctionModule(a, b, dark);
            setFunctionModule(b, a, dark);
        }
    }
};

const drawFormatBits = (level, mask, size, modules) => {
    const data = (FORMAT_BITS[level] << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) {
        remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }
    const bits = ((data << 10) | remainder) ^ 0x5412;
    for (let i = 0; i <= 5; i++) {
        modules[i][8] = getBit(bits, i);
    }
    modules[7][8] = getBit(bits, 6);
    modules[8][8] = getBit(bits, 7);
    modules[8][7] = getBit(bits, 8);
    for (let i = 9; i < 15; i++) {
        modules[8][14 - i] = getBit(bits, i);
    }
    for (let i = 0; i < 8; i++) {
        modules[8][size - 1 - i] = getBit(bits, i);
    }
    for (let i = 8; i < 15; i++) {
        modules[size - 15 + i][8] = getBit(bits, i);
    }
    modules[size - 8][8] = true;
};

// Zigzag over column pairs from the right edge, skipping the vertical timing column.
const drawCodewords = (codewords, size, modules, isFunction) => {
    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) {
            right = 5;
        }
        for (let vertical = 0; vertical < size; vertical++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vertical : vertical;
                if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
                    modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
                    bitIndex++;
                }
            }
        }
    }
};

const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
];

const applyMask = (mask, size, modules, isFunction) => {
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!isFunction[y][x] && MASKS[mask](x, y)) {
                modules[y][x] = !modules[y][x];
            }
        }
    }
};

// Runs of 5 or more equal modules and the 1:1:3:1:1 finder-like pattern, over one row or column.
const linePenalty = (line) => {
    let penalty = 0;
    let runLength = 1;
    for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) {
            runLength++;
        } else {
            if (runLength >= 5) {
                penalty += PENALTY_N1 + runLength - 5;
            }
            runLength = 1;
        }
    }
    // Same pattern as `dark light dark dark dark light dark` surrounded by 4 light modules.
    for (let i = 0; i + 7 <= line.length; i++) {
        const core = line[i] && !line[i + 1] && line[i + 2] && line[i + 3] && line[i + 4] && !line[i + 5] && line[i + 6];
        if (core) {
            const lightBefore = i >= 4 && !line[i - 1] && !line[i - 2] && !line[i - 3] && !line[i - 4];
            const lightAfter = i + 11 <= line.length && !line[i + 7] && !line[i + 8] && !line[i + 9] && !line[i + 10];
            // Light margins running past the edge count as light, as in the reference scoring.
            const edgeBefore = i < 4 && line.slice(0, i).every((dark) => !dark);
            const edgeAfter = i + 11 > line.length && line.slice(i + 7).every((dark) => !dark);
            if (lightBefore || edgeBefore) {
                penalty += PENALTY_N3;
            }
            if (lightAfter || edgeAfter) {
                penalty += PENALTY_N3;
            }
        }
    }
    return penalty;
};

const getPenaltyScore = (size, modules) => {
    let penalty = 0;
    let dark = 0;
    for (let y = 0; y < size; y++) {
        penalty += linePenalty(modules[y]);
        const column = [];
        for (let x = 0; x < size; x++) {
            column.push(modules[x][y]);
            if (modules[y][x]) {
                dark++;
            }
        }
        penalty += linePenalty(column);
    }
    for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
            const color = modules[y][x];
            if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) {
                penalty += PENALTY_N2;
            }
        }
    }
    const total = size * size;
    const steps = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return penalty + steps * PENALTY_N4;
};

const pickVersion = (byteLength) => {
    const levels = ['M', 'L'];
    for (let l = 0; l < levels.length; l++) {
        for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
            const lengthBits = version <= 9 ? 8 : 16;
            const neededBits = 4 + lengthBits + byteLength * 8;
            if (neededBits <= getNumDataCodewords(version, levels[l]) * 8) {
                return { version, level: levels[l] };
            }
        }
    }
    return null;
};

// Highest level that fits wins (M, then L): a longer URL still gets a code, just a denser one.
// Returns null when the text does not fit in version 40-L (2953 bytes).
const encode = (text) => {
    const bytes = toUtf8(String(text));
    const fit = pickVersion(bytes.length);
    if (fit === null) {
        return null;
    }
    const { version, level } = fit;
    const size = version * 4 + 17;
    const data = buildDataCodewords(bytes, version, level);
    const codewords = addEccAndInterleave(data, version, level);

    const base = createGrid(size);
    const isFunction = createGrid(size);
    drawFunctionPatterns(version, size, base, isFunction);
    drawCodewords(codewords, size, base, isFunction);

    let best = null;
    for (let mask = 0; mask < 8; mask++) {
        const modules = base.map((row) => row.slice());
        applyMask(mask, size, modules, isFunction);
        drawFormatBits(level, mask, size, modules);
        const penalty = getPenaltyScore(size, modules);
        if (best === null || penalty < best.penalty) {
            best = { mask, modules, penalty };
        }
    }
    return { size, version, level, mask: best.mask, modules: best.modules };
};

// One path for the whole code: a horizontal bar per run of dark modules.
const toPath = (qr) => {
    const parts = [];
    qr.modules.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            if (row[x]) {
                let end = x + 1;
                while (end < row.length && row[end]) {
                    end++;
                }
                parts.push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
                x = end;
            }
        }
    });
    return parts.join('');
};

module.exports = {
    MAX_VERSION,
    encode,
    toPath,
};
