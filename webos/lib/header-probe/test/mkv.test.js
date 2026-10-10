/* global describe, it, expect */
// Synthetic Matroska layouts around the first audio frame: lacing, header stripping, BlockGroup.
// The lacing headers are made longer than the 64-byte sync search window, so reading the frame
// without skipping them fails.

const { probe } = require('../index');
const { bufferReadRange } = require('./replay');
const { eac3Frame } = require('./bits');
const { buildMkv } = require('./mkvbuild');

const frames = (count, size) => {
    const list = [];
    for (let i = 0; i < count; i++) list.push(Buffer.from(eac3Frame(true, size)));
    return list;
};

const atmosOf = (bytes) => probe(bufferReadRange(bytes)).then((result) => ({
    atmos: result.tracks[0].audio.atmos,
    profile: result.tracks[0].audio.profile,
    warnings: result.warnings,
}));

describe('MKV first-frame layouts', () => {
    it('reads an unlaced SimpleBlock', async () => {
        const result = await atmosOf(buildMkv({ codecId: 'A_EAC3', frames: frames(1, 600) }));
        expect(result).toEqual({ atmos: true, profile: 'E-AC-3 JOC', warnings: [] });
    });

    it('skips Xiph lacing (header longer than the sync search window)', async () => {
        const result = await atmosOf(buildMkv({ codecId: 'A_EAC3', frames: frames(30, 600), lacing: 1 }));
        expect(result.atmos).toBe(true);
    });

    it('skips EBML lacing', async () => {
        const result = await atmosOf(buildMkv({ codecId: 'A_EAC3', frames: frames(70, 600), lacing: 3 }));
        expect(result.atmos).toBe(true);
    });

    it('skips fixed-size lacing', async () => {
        const result = await atmosOf(buildMkv({ codecId: 'A_EAC3', frames: frames(4, 600), lacing: 2 }));
        expect(result.atmos).toBe(true);
    });

    it('puts back the bytes removed by header stripping (ContentCompAlgo 3)', async () => {
        const result = await atmosOf(buildMkv({ codecId: 'A_EAC3', frames: frames(1, 600), strip: [0x0b, 0x77] }));
        expect(result.atmos).toBe(true);
    });

    it('finds the Block after other BlockGroup children', async () => {
        const result = await atmosOf(buildMkv({ codecId: 'A_EAC3', frames: frames(1, 600), blockGroup: true, durationFirst: true }));
        expect(result.atmos).toBe(true);
    });

    it('reports a stable warning code when no frame is recognised', async () => {
        const silent = [Buffer.alloc(600)];
        const result = await atmosOf(buildMkv({ codecId: 'A_EAC3', frames: silent }));
        expect(result.atmos).toBeNull();
        expect(result.warnings).toEqual([expect.objectContaining({ code: 'FRAME_NOT_FOUND', track: 1 })]);
    });
});
