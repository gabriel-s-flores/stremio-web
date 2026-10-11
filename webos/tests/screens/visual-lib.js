// Image comparison of the visual regression (F2.7; visual.mjs): pure functions on raw RGB buffers of
// the reduced captures (WIDTH x HEIGHT, 3 bytes a pixel), with no image library, so jest tests them.
// CommonJS, Node only.
'use strict';

const WIDTH = 480;
const HEIGHT = 270;
const SCALE = 1920 / WIDTH; // capture pixels per reduced pixel
const BLOCK = 16; // side of the blocks of the local metric, in reduced pixels (64 px of the screen)
const MIN_BLOCK_PIXELS = 32; // blocks with less unmasked pixels than this do not count

// Limits, one set per scene in visual.config.json over these defaults:
//   pixel   a pixel changed when some channel differs by more than this (0-255)
//   ratio   fail when more than this share of the compared pixels changed (whole image)
//   block   fail when more than this share of the pixels of one 16x16 block changed (a small
//           change, like a focus ring, is a tiny part of the image but fills the blocks it is in)
const DEFAULTS = { pixel: 32, ratio: 0.002, block: 0.08 };

const pixels = WIDTH * HEIGHT;

// Mask of the pixels that are not compared: rects [x, y, width, height] in capture pixels (1920x1080).
const maskFromRects = (rects) => {
    const mask = new Uint8Array(pixels);
    (rects || []).forEach(([x, y, width, height]) => {
        const x0 = Math.max(0, Math.floor(x / SCALE));
        const y0 = Math.max(0, Math.floor(y / SCALE));
        const x1 = Math.min(WIDTH, Math.ceil((x + width) / SCALE));
        const y1 = Math.min(HEIGHT, Math.ceil((y + height) / SCALE));
        for (let row = y0; row < y1; row++) mask.fill(1, row * WIDTH + x0, row * WIDTH + x1);
    });
    return mask;
};

// Compares two reduced captures. Returns the metrics and an RGB image of the difference (the new capture
// dimmed, changed pixels red, masked ones dark blue).
const compare = (reference, capture, rects, limits) => {
    if (reference.length !== pixels * 3 || capture.length !== pixels * 3) throw new Error('buffers must be 480x270 RGB');
    const config = Object.assign({}, DEFAULTS, limits);
    const mask = maskFromRects(rects);
    const image = Buffer.alloc(pixels * 3);
    const blocksX = Math.ceil(WIDTH / BLOCK);
    const blocksY = Math.ceil(HEIGHT / BLOCK);
    const blockCompared = new Uint32Array(blocksX * blocksY);
    const blockChanged = new Uint32Array(blocksX * blocksY);
    let compared = 0;
    let changed = 0;
    let sum = 0;
    for (let i = 0; i < pixels; i++) {
        const o = i * 3;
        if (mask[i]) {
            image[o] = 10;
            image[o + 1] = 10;
            image[o + 2] = 60;
            continue;
        }
        const delta = Math.max(
            Math.abs(reference[o] - capture[o]),
            Math.abs(reference[o + 1] - capture[o + 1]),
            Math.abs(reference[o + 2] - capture[o + 2]),
        );
        const block = Math.floor(i / WIDTH / BLOCK) * blocksX + Math.floor((i % WIDTH) / BLOCK);
        compared++;
        sum += delta;
        blockCompared[block]++;
        if (delta > config.pixel) {
            changed++;
            blockChanged[block]++;
            image[o] = 255;
            image[o + 1] = 0;
            image[o + 2] = 0;
        } else {
            const gray = Math.round((capture[o] + capture[o + 1] + capture[o + 2]) / 3 * 0.45);
            image[o] = gray;
            image[o + 1] = gray;
            image[o + 2] = gray;
        }
    }
    let worst = { ratio: 0, x: 0, y: 0 };
    for (let block = 0; block < blockCompared.length; block++) {
        if (blockCompared[block] < MIN_BLOCK_PIXELS) continue;
        const ratio = blockChanged[block] / blockCompared[block];
        if (ratio > worst.ratio) worst = { ratio, x: (block % blocksX) * BLOCK * SCALE, y: Math.floor(block / blocksX) * BLOCK * SCALE };
    }
    const ratio = compared ? changed / compared : 0;
    return {
        compared,
        changed,
        ratio,
        worstBlock: worst,
        meanDelta: compared ? sum / compared : 0,
        limits: config,
        pass: ratio <= config.ratio && worst.ratio <= config.block,
        image,
    };
};

module.exports = { WIDTH, HEIGHT, SCALE, BLOCK, DEFAULTS, maskFromRects, compare };
