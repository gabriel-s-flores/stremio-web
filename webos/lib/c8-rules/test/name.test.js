/* global describe, it, expect */
// Stream-name signals: release names and addon texts in the forms debrid addons send them.

const { parseStreamName, normalizeLanguage } = require('../index');

const pick = (text) => {
    const signals = parseStreamName(text);
    return {
        container: signals.container, videoCodec: signals.videoCodec, dolbyVision: signals.dolbyVision,
        dvProfile: signals.dvProfile, hdr10: signals.hdr10, hdr10plus: signals.hdr10plus, hlg: signals.hlg,
        atmos: signals.atmos, atmosCodec: signals.atmosCodec, audioCodecs: signals.audioCodecs,
    };
};

describe('parseStreamName', () => {
    it.each([
        ['Movie.2160p.WEB-DL.DV.HDR.H265.DDP5.1.Atmos.mkv', {
            container: 'mkv', videoCodec: 'hevc', dolbyVision: true, dvProfile: null, hdr10: true, hdr10plus: false, hlg: false,
            atmos: true, atmosCodec: 'eac3', audioCodecs: ['eac3'],
        }],
        ['Movie.2160p.BluRay.REMUX.DV.P7.FEL.HEVC.TrueHD.7.1.Atmos-GRP', {
            container: null, videoCodec: 'hevc', dolbyVision: true, dvProfile: '7', hdr10: false, hdr10plus: false, hlg: false,
            atmos: true, atmosCodec: 'truehd', audioCodecs: ['truehd'],
        }],
        ['Show S01E01 2160p DoVi P8.1 x265 E-AC-3 5.1', {
            container: null, videoCodec: 'hevc', dolbyVision: true, dvProfile: '8.1', hdr10: false, hdr10plus: false, hlg: false,
            atmos: false, atmosCodec: null, audioCodecs: ['eac3'],
        }],
        ['Movie 1080p BluRay x264 DD 5.1 / DTS-HD MA 7.1 [mp4]', {
            container: 'mp4', videoCodec: 'avc', dolbyVision: false, dvProfile: null, hdr10: false, hdr10plus: false, hlg: false,
            atmos: false, atmosCodec: null, audioCodecs: ['ac3', 'dts'],
        }],
        ['Movie.2160p.HDR10Plus.HEVC.DD+5.1', {
            container: null, videoCodec: 'hevc', dolbyVision: false, dvProfile: null, hdr10: true, hdr10plus: true, hlg: false,
            atmos: false, atmosCodec: null, audioCodecs: ['eac3'],
        }],
        ['Movie.2160p.TrueHD.Atmos.7.1.DDP5.1.Atmos', {
            container: null, videoCodec: null, dolbyVision: false, dvProfile: null, hdr10: false, hdr10plus: false, hlg: false,
            atmos: true, atmosCodec: null, audioCodecs: ['truehd', 'eac3'],
        }],
        ['Dolby Vision Profile 5 | AV1 | Opus', {
            container: null, videoCodec: 'av1', dolbyVision: true, dvProfile: '5', hdr10: false, hdr10plus: false, hlg: false,
            atmos: false, atmosCodec: null, audioCodecs: ['opus'],
        }],
        ['Movie.1080p.DVDRip.XviD.AC3', {
            container: null, videoCodec: null, dolbyVision: false, dvProfile: null, hdr10: false, hdr10plus: false, hlg: false,
            atmos: false, atmosCodec: null, audioCodecs: ['ac3'],
        }],
        ['Broadcast.2160p.HLG.HEVC.AAC2.0.webm', {
            container: 'webm', videoCodec: 'hevc', dolbyVision: false, dvProfile: null, hdr10: false, hdr10plus: false, hlg: true,
            atmos: false, atmosCodec: null, audioCodecs: ['aac'],
        }],
    ])('%s', (text, expected) => {
        expect(pick(text)).toEqual(expected);
    });

    it('reads name, title, description and behaviorHints.filename; the file extension wins', () => {
        const signals = parseStreamName({
            name: '[RD+] Addon\n4k DV',
            title: 'Movie (2024)\n💾 20 GB mkv',
            description: '🔊 DDP5.1 Atmos',
            behaviorHints: { filename: 'Movie.2024.2160p.WEB-DL.mp4' },
        });
        expect(signals).toMatchObject({ container: 'mp4', dolbyVision: true, atmos: true, atmosCodec: 'eac3' });
    });

    it('does not take words or other tokens for signals', () => {
        // "mel"/"fel" are Portuguese words: only a profile 7 hint next to DV; "P7" needs a boundary.
        expect(pick('Lua de Mel 1080p').dvProfile).toBeNull();
        expect(pick('Lua de Mel 1080p').dolbyVision).toBe(false);
        expect(pick('Movie.1080p7.1').dvProfile).toBeNull();
        expect(pick('Movie DDP7.1').dvProfile).toBeNull();
        expect(pick('Movie.Hdrama.2020').hdr10).toBe(false);
        expect(pick('Movie.2020.E-AC-3').audioCodecs).toEqual(['eac3']);
    });

    it('accepts no stream at all', () => {
        expect(pick(null)).toMatchObject({ container: null, dolbyVision: false, audioCodecs: [] });
        expect(parseStreamName({}).text).toBe('');
    });
});

describe('normalizeLanguage', () => {
    it.each([
        ['por', 'por'], ['pt', 'por'], ['pt-BR', 'por'], ['POR', 'por'],
        ['fre', 'fra'], ['fra', 'fra'], ['fr', 'fra'], ['ger', 'deu'], ['de', 'deu'], ['chi', 'zho'],
        ['eng', 'eng'], ['en', 'eng'], ['und', null], ['', null], [null, null], ['xyz', 'xyz'],
    ])('%s -> %s', (code, expected) => {
        expect(normalizeLanguage(code)).toBe(expected);
    });
});
