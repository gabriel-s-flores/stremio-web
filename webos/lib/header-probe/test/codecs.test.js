/* global describe, it, expect */
const codecs = require('../codecs');
const { BitReader } = require('../bytes');

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

const dovi = (profile, level, rpu, el, bl, compatibility) => pack([
    [1, 8], [0, 8], [profile, 7], [level, 6], [rpu, 1], [el, 1], [bl, 1], [compatibility, 4], [0, 28], [0, 32], [0, 32], [0, 32], [0, 32],
]);

describe('parseDoviConfig', () => {
    it('reads profile 8.1 (HDR10 base layer)', () => {
        const data = dovi(8, 6, 1, 0, 1, 1);
        expect(codecs.parseDoviConfig(data, 0, data.length)).toEqual({
            profile: 8, profileName: '8.1', level: 6, compatibilityId: 1, baseLayer: 'hdr10',
            rpuPresent: true, elPresent: false, blPresent: true, version: '1.0',
        });
    });

    it('reads profile 5 (no compatible base layer)', () => {
        const data = dovi(5, 6, 1, 0, 1, 0);
        const config = codecs.parseDoviConfig(data, 0, data.length);
        expect(config.profileName).toBe('5');
        expect(config.baseLayer).toBe('none');
    });

    it('reads profile 7 with enhancement layer (Blu-ray compatibility id 6)', () => {
        const data = dovi(7, 6, 1, 1, 1, 6);
        const config = codecs.parseDoviConfig(data, 0, data.length);
        expect(config.profileName).toBe('7');
        expect(config.elPresent).toBe(true);
        expect(config.baseLayer).toBe('hdr10');
    });

    it('marks an enhancement-layer-only track (MP4 dual track) without base layer', () => {
        const data = dovi(7, 6, 1, 1, 0, 6);
        expect(codecs.parseDoviConfig(data, 0, data.length).baseLayer).toBe('none');
    });
});

describe('parseDec3', () => {
    const dec3 = (acmod, lfeon, numDepSub, chanLoc, joc) => pack([
        [768, 13], [0, 3],
        [0, 2], [16, 5], [0, 1], [0, 1], [0, 3], [acmod, 3], [lfeon, 1], [0, 3], [numDepSub, 4],
        numDepSub > 0 ? [chanLoc, 9] : [0, 1],
    ].concat(joc === undefined ? [] : [[0, 7], [joc ? 1 : 0, 1], [16, 8]]));

    it('reads 5.1 without the Atmos extension', () => {
        const data = dec3(7, 1, 0, 0);
        expect(codecs.parseDec3(data, 0, data.length)).toEqual({ channels: 6, sampleRate: 48000, atmos: false, complexityIndex: null });
    });

    it('reads 5.1 with JOC (Atmos) and its complexity index', () => {
        const data = dec3(7, 1, 0, 0, true);
        expect(codecs.parseDec3(data, 0, data.length)).toEqual({ channels: 6, sampleRate: 48000, atmos: true, complexityIndex: 16 });
    });

    it('adds the channels of a dependent substream (7.1 = 5.1 + Lrs/Rrs)', () => {
        const data = dec3(7, 1, 1, 0x80, false);
        expect(codecs.parseDec3(data, 0, data.length).channels).toBe(8);
    });
});

describe('sniffEac3Frame', () => {
    // Independent 5.1 frame, 6 blocks: no mixing/info metadata, addbsi with the extension flag.
    const frame = (joc) => {
        const header = pack([
            [0x0b77, 16], [0, 2], [0, 3], [767, 11], [0, 2], [3, 2], [7, 3], [1, 1], [16, 5],
            [31, 5], [0, 1], [0, 1], [0, 1], [1, 1], [1, 6], [joc ? 1 : 0, 8], [joc ? 16 : 0, 8],
        ]);
        const out = new Uint8Array(64);
        out.set(header, 0);
        return out;
    };

    it('detects the Atmos (JOC) flag in addbsi', () => {
        expect(codecs.sniffEac3Frame(frame(true))).toEqual({ eac3: true, atmos: true });
    });

    it('reports plain E-AC-3', () => {
        expect(codecs.sniffEac3Frame(frame(false))).toEqual({ eac3: true, atmos: false });
    });

    it('returns null without a sync word', () => {
        expect(codecs.sniffEac3Frame(new Uint8Array(64))).toBeNull();
    });
});

describe('sniffDtsFrame', () => {
    const withSyncs = (syncs) => {
        const out = new Uint8Array(4096);
        out.set([0x7f, 0xfe, 0x80, 0x01], 0);
        syncs.forEach((sync, i) => out.set(sync, 1000 + i * 500));
        return out;
    };

    it('tells core, DTS-HD MA, DTS:X and DTS-HD apart', () => {
        expect(codecs.sniffDtsFrame(withSyncs([])).profile).toBe('DTS');
        expect(codecs.sniffDtsFrame(withSyncs([[0x64, 0x58, 0x20, 0x25], [0x41, 0xa2, 0x95, 0x47]])).profile).toBe('DTS-HD MA');
        expect(codecs.sniffDtsFrame(withSyncs([[0x64, 0x58, 0x20, 0x25]])).profile).toBe('DTS-HD');
        expect(codecs.sniffDtsFrame(withSyncs([[0x64, 0x58, 0x20, 0x25], [0x41, 0xa2, 0x95, 0x47], [0x02, 0x00, 0x08, 0x50]])).profile).toBe('DTS:X');
    });
});

describe('parseTrueHdFormatInfo', () => {
    it('counts the 7.1 presentation (L/R, C, LFE, Ls/Rs, Lrs/Rrs) at 48 kHz', () => {
        const data = pack([[0, 4], [0, 4], [0, 2], [0, 2], [0b01111, 5], [0, 2], [0b1001111, 13]]);
        expect(codecs.parseTrueHdFormatInfo(data, 0)).toEqual({ channels: 8, sampleRate: 48000 });
    });
});

describe('parseAudioSpecificConfig', () => {
    it('reads AAC LC 48 kHz 5.1', () => {
        const data = pack([[2, 5], [3, 4], [6, 4], [0, 3]]);
        expect(codecs.parseAudioSpecificConfig(data, 0, data.length)).toEqual({ profile: 'AAC LC', sampleRate: 48000, channels: 6 });
    });
});

describe('mkvCodec', () => {
    it('normalises Matroska codec IDs', () => {
        expect(codecs.mkvCodec('V_MPEGH/ISO/HEVC')).toBe('hevc');
        expect(codecs.mkvCodec('A_EAC3')).toBe('eac3');
        expect(codecs.mkvCodec('A_TRUEHD')).toBe('truehd');
        expect(codecs.mkvCodec('A_DTS/LOSSLESS')).toBe('dts');
        expect(codecs.mkvCodec('A_AAC/MPEG4/LC')).toBe('aac');
        expect(codecs.mkvCodec('S_HDMV/PGS')).toBe('pgs');
        expect(codecs.mkvCodec('S_TEXT/ASS')).toBe('ass');
        expect(codecs.mkvCodec('X_UNKNOWN')).toBe('unknown');
    });
});

describe('BitReader', () => {
    it('reads exp-Golomb codes', () => {
        // 1 -> 0, 010 -> 1, 011 -> 2, 00100 -> 3
        const reader = new BitReader(pack([[1, 1], [2, 3], [3, 3], [4, 5]]));
        expect([reader.ue(), reader.ue(), reader.ue(), reader.ue()]).toEqual([0, 1, 2, 3]);
    });
});
