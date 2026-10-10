/* global describe, it, expect */
const codecs = require('../codecs');
const { BitReader } = require('../bytes');
const { pack, eac3Frame, truehdFrame } = require('./bits');

const dovi = (profile, level, rpu, el, bl, compatibility) => pack([
    [1, 8], [0, 8], [profile, 7], [level, 6], [rpu, 1], [el, 1], [bl, 1], [compatibility, 4], [0, 28], [0, 32], [0, 32], [0, 32], [0, 32],
]);

describe('parseDoviConfig', () => {
    it('reads profile 8.1 (HDR10 base layer)', () => {
        const data = dovi(8, 6, 1, 0, 1, 1);
        expect(codecs.parseDoviConfig(data, 0, data.length)).toEqual({
            profile: 8, profileName: '8.1', level: 6, compatibilityId: 1, baseLayer: 'hdr10',
            rpuPresent: true, elPresent: false, blPresent: true, version: '1.0', source: 'config',
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

    it('leaves Atmos unknown when the extension byte is absent', () => {
        const data = dec3(7, 1, 0, 0);
        expect(codecs.parseDec3(data, 0, data.length)).toEqual({ channels: 6, sampleRate: 48000, atmos: null, complexityIndex: null });
    });

    it('leaves Atmos unknown when the extension has the JOC flag off (the first frame decides)', () => {
        const data = dec3(7, 1, 0, 0, false);
        expect(codecs.parseDec3(data, 0, data.length)).toEqual({ channels: 6, sampleRate: 48000, atmos: null, complexityIndex: null });
    });

    it('returns null for a box that promises more substreams than it has', () => {
        const data = dec3(7, 1, 0, 0);
        data[1] |= 0x07;
        expect(codecs.parseDec3(data, 0, data.length)).toBeNull();
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
    const frame = (joc) => eac3Frame(joc);

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
        expect(codecs.sniffDtsFrame(withSyncs([[0x64, 0x58, 0x20, 0x25], [0x41, 0xa2, 0x95, 0x47], [0x02, 0x00, 0x08, 0x50]])).profile).toBe('DTS-HD MA + DTS:X');
    });
});

describe('sniffTrueHdFrame', () => {
    it('reports Atmos only with 4 substreams and the Atmos bit', () => {
        expect(codecs.sniffTrueHdFrame(truehdFrame(4, 0x80))).toMatchObject({ substreams: 4, atmos: true, channels: 8, sampleRate: 48000 });
        expect(codecs.sniffTrueHdFrame(truehdFrame(3, 0x80)).atmos).toBe(false);
        expect(codecs.sniffTrueHdFrame(truehdFrame(4, 0x00)).atmos).toBe(false);
    });

    it('returns null without a major sync', () => {
        expect(codecs.sniffTrueHdFrame(new Uint8Array(64))).toBeNull();
    });
});

describe('Dolby Vision RPU', () => {
    // RPU NAL (type 62) header up to disable_residual_flag; vdr_rpu_profile 1 -> 4/7/8, 0 -> 5.
    const ue = (value) => [value + 1, 2 * (value + 1).toString(2).length - 1];
    const rpu = (vdrProfile, fullRange, vdrBitDepthMinus8, elResampling, disableResidual) => pack([
        [0x7c01, 16], [25, 8], [2, 6], [18, 11], [vdrProfile, 4], [0, 4], [1, 1], [0, 1], [0, 2], ue(22),
        [0, 2], [fullRange, 1], ue(2), ue(2), ue(vdrBitDepthMinus8), [0, 1], [0, 3], [elResampling, 1], [disableResidual, 1], [0xff, 16],
    ]);

    it('tells profiles 5, 7 and 8 apart like dovi_tool', () => {
        expect(codecs.parseDoviRpu(rpu(0, 1, 4, 0, 1)).profile).toBe(5);
        expect(codecs.parseDoviRpu(rpu(1, 0, 4, 1, 0)).profile).toBe(7);
        expect(codecs.parseDoviRpu(rpu(1, 0, 4, 0, 1)).profile).toBe(8);
        expect(codecs.parseDoviRpu(new Uint8Array([0x7c, 0x01, 0x00, 0x00]))).toBeNull();
    });

    it('builds the description from the RPU and the video colour', () => {
        const p81 = codecs.doviFromRpu({ profile: 8 }, false, { transfer: 'pq' });
        expect(p81).toMatchObject({ profileName: '8.1', compatibilityId: 1, baseLayer: 'hdr10', source: 'rpu' });
        expect(codecs.doviFromRpu({ profile: 5 }, false, null)).toMatchObject({ profileName: '5', baseLayer: 'none' });
        expect(codecs.doviFromRpu({ profile: 8 }, false, null)).toMatchObject({ profileName: '8', baseLayer: 'unknown' });
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
