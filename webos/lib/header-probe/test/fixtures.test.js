/* global describe, it, expect */
// Real headers recorded with tools/probe.mjs (sources, licences and checksums in
// __fixtures__/SOURCE.md). Expected values are the ffprobe 9.0 output for the same files.
// Fixtures from sources without a redistribution licence (FATE) are not in git: they are
// created by tools/fetch-fate-fixtures.sh, and their tests are skipped with a warning.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { probe } = require('../index');
const { loadFixture, replayReadRange } = require('./replay');

const FIXTURES = path.join(__dirname, '..', '__fixtures__');
const FATE_IDS = ['fate-dv-p7-mkv', 'fate-dv-p7-dual-mp4'];
const hasFixture = (id) => fs.existsSync(path.join(FIXTURES, id + '.json')) && fs.existsSync(path.join(FIXTURES, id + '.bin'));
const missingFate = FATE_IDS.filter((id) => !hasFixture(id));
if (missingFate.length > 0) {
    console.warn('[header-probe] PULANDO ' + missingFate.length + ' teste(s) de Dolby Vision P7 (fixtures FATE ausentes: ' +
        missingFate.join(', ') + '). Rode webos/lib/header-probe/tools/fetch-fate-fixtures.sh para gravá-las.');
}
const itFate = (id) => (hasFixture(id) ? it : it.skip);

const run = (id) => {
    const fixture = loadFixture(id);
    return probe(replayReadRange(fixture), fixture.meta.options);
};

const pick = (track) => ({ id: track.id, type: track.type, codec: track.codec, language: track.language, default: track.default });

const audioOf = (result) => result.tracks.filter((track) => track.type === 'audio');

// Runs a fixture after editing a copy of its bytes: edit(bytes, offsetOfPiece) per piece.
const runPatched = (id, edit, options) => {
    const fixture = loadFixture(id);
    fixture.pieces = fixture.pieces.map((piece) => {
        const data = new Uint8Array(piece.data);
        edit(data, piece.offset);
        return { offset: piece.offset, data };
    });
    return probe(replayReadRange(fixture), Object.assign({}, fixture.meta.options, options));
};

const indexOfText = (data, textValue) => Buffer.from(data.buffer, data.byteOffset, data.length).indexOf(textValue, 0, 'latin1');

describe('fixtures', () => {
    const ids = fs.readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5));

    it.each(ids)('%s matches its recorded checksum and size limit', (id) => {
        const fixture = loadFixture(id);
        const bin = Buffer.concat(fixture.pieces.map((piece) => Buffer.from(piece.data)));
        expect(crypto.createHash('sha256').update(bin).digest('hex')).toBe(fixture.meta.sha256);
        expect(bin.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    });
});

describe('Dolby Vision', () => {
    it('P5 in MP4 (dvh1 + dvcC, moov after mdat)', async () => {
        const result = await run('dv-p5-mp4');
        expect(result.container).toBe('mp4');
        expect(result.moovAtStart).toBe(false);
        expect(result.tracks.map(pick)).toEqual([{ id: 1, type: 'video', codec: 'hevc', language: null, default: true }]);
        expect(result.tracks[0].codecId).toBe('dvh1');
        expect(result.tracks[0].video).toMatchObject({ width: 1920, height: 1080, profile: 'Main 10', bitDepth: 10, hdr: 'dolby-vision' });
        expect(result.summary.dolbyVision).toEqual({
            profile: 5, profileName: '5', level: 5, compatibilityId: 0, baseLayer: 'none',
            rpuPresent: true, elPresent: false, blPresent: true, version: '1.0', source: 'config',
        });
        expect(result.stats.requests).toBe(2);
    });

    it('P5 in MKV with TrueHD Atmos (remux of the same P5 stream)', async () => {
        const result = await run('dv-p5-truehd-atmos-mkv');
        expect(result.summary.dolbyVision).toMatchObject({ profile: 5, level: 5, baseLayer: 'none', blPresent: true });
        expect(result.tracks[1]).toMatchObject({ id: 2, type: 'audio', codec: 'truehd', language: 'eng', name: 'TrueHD Atmos 7.1', default: true });
        expect(result.tracks[1].audio).toMatchObject({ channels: 8, sampleRate: 48000, atmos: true, profile: 'TrueHD Atmos' });
        expect(result.summary.atmos).toBe(true);
        expect(result.warnings).toEqual([]);
    });

    it('P8.1 in MP4 (hvc1 + dvvC, HDR10 base layer)', async () => {
        const result = await run('dv-p81-mp4');
        expect(result.tracks[0].codecId).toBe('hvc1');
        expect(result.summary).toMatchObject({ videoCodec: 'hevc', hdr: 'dolby-vision', dolbyVisionDualTrack: false });
        expect(result.summary.dolbyVision).toMatchObject({ profile: 8, profileName: '8.1', level: 5, compatibilityId: 1, baseLayer: 'hdr10', elPresent: false });
    });

    it('P8.1 in MKV written by mkvmerge (BlockAdditionMapping dvvC)', async () => {
        const result = await run('dv-p81-mkvmerge-mkv');
        expect(result.muxer).toMatch(/^mkvmerge/);
        expect(result.tracks.map(pick)).toEqual([{ id: 1, type: 'video', codec: 'hevc', language: null, default: true }]);
        expect(result.tracks[0].video).toMatchObject({ width: 256, height: 144, profile: 'Main 10' });
        expect(result.tracks[0].video.colour).toMatchObject({ transfer: 'pq', primaries: 'bt2020' });
        expect(result.summary.dolbyVision).toMatchObject({ profile: 8, profileName: '8.1', level: 1, baseLayer: 'hdr10' });
    });

    itFate('fate-dv-p7-mkv')('[FATE] P7 in MKV (single track with enhancement layer, BlockAdditionMapping dvcC)', async () => {
        const result = await run('fate-dv-p7-mkv');
        expect(result.container).toBe('mkv');
        expect(result.tracks.map(pick)).toEqual([{ id: 1, type: 'video', codec: 'hevc', language: null, default: true }]);
        expect(result.tracks[0].video).toMatchObject({ width: 3840, height: 2160, profile: 'Main 10' });
        expect(result.tracks[0].video.colour).toMatchObject({ transfer: 'pq', primaries: 'bt2020' });
        expect(result.summary.dolbyVision).toMatchObject({ profile: 7, level: 6, compatibilityId: 6, baseLayer: 'hdr10', rpuPresent: true, elPresent: true, blPresent: true });
    });

    itFate('fate-dv-p7-dual-mp4')('[FATE] P7 in MP4 as dual track (base layer + enhancement layer tracks)', async () => {
        const result = await run('fate-dv-p7-dual-mp4');
        expect(result.tracks.map(pick)).toEqual([
            { id: 1, type: 'video', codec: 'hevc', language: null, default: true },
            { id: 2, type: 'video', codec: 'hevc', language: null, default: false },
        ]);
        expect(result.tracks[0].video.dolbyVision).toBeNull();
        expect(result.tracks[0].video.hdr).toBe('hdr10');
        expect(result.tracks[1].video.dolbyVision).toMatchObject({ profile: 7, level: 4, elPresent: true, blPresent: false, baseLayer: 'none' });
        expect(result.summary).toMatchObject({ hdr: 'dolby-vision', dolbyVisionDualTrack: true });
        expect(result.summary.dolbyVision).toMatchObject({ profile: 7, baseLayer: 'hdr10' });
    });
});

describe('Dolby Vision in MKV without BlockAdditionMapping (type renamed, as in an old mkvmerge)', () => {
    it('P5 is found from the RPU NAL unit of the first video frame', async () => {
        const result = await run('dv-p5-nobam-mkv');
        expect(result.tracks[0].video.dolbyVision).toMatchObject({ profile: 5, profileName: '5', baseLayer: 'none', rpuPresent: true, elPresent: false, source: 'rpu' });
        expect(result.summary).toMatchObject({ hdr: 'dolby-vision' });
        expect(result.warnings).toEqual([]);
    });

    it('P8.1 (mkvmerge file) is found from the RPU, with the base layer from the PQ colour', async () => {
        const result = await run('dv-p81-nobam-mkv');
        expect(result.summary.dolbyVision).toMatchObject({ profile: 8, profileName: '8.1', compatibilityId: 1, baseLayer: 'hdr10', source: 'rpu' });
    });

    it('a 10-bit HEVC MKV without RPU is not Dolby Vision, without warnings', async () => {
        const result = await run('kit-hevc10-mkv');
        expect(result.tracks[0].video).toMatchObject({ profile: 'Main 10', dolbyVision: null });
        expect(result.summary.dolbyVision).toBeNull();
        expect(result.warnings).toEqual([]);
    });

    it('without frame inspection the output says DV_UNKNOWN for the track', async () => {
        const fixture = loadFixture('dv-p5-nobam-mkv');
        const result = await probe(replayReadRange(fixture), Object.assign({}, fixture.meta.options, { sniffFrames: false }));
        expect(result.tracks[0].video.dolbyVision).toBeNull();
        expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'DV_UNKNOWN', track: 1 }));
    });
});

describe('robustness', () => {
    it('a dec3 promising more substreams than it holds does not break the ProbeError contract', async () => {
        const result = await runPatched('eac3-mp4', (data) => {
            const box = indexOfText(data, 'dec3');
            data[box + 5] = 0x21;
        });
        expect(audioOf(result)[0].codec).toBe('eac3');
    });

    it('NaN Duration and SamplingFrequency floats become null', async () => {
        const fill = (data, id) => {
            const at = Buffer.from(data.buffer, data.byteOffset, data.length).indexOf(Buffer.from(id));
            data.fill(0xff, at + id.length, at + id.length + 8);
        };
        const result = await runPatched('dts-core-mkv', (data, offset) => {
            if (offset !== 0) return;
            fill(data, [0x44, 0x89, 0x88]);
            fill(data, [0xb5, 0x88]);
        });
        expect(result.durationSec).toBeNull();
        expect(audioOf(result)[0].audio.sampleRate).toBeNull();
    });

    it('any parser exception leaves probe() as ProbeError INVALID', async () => {
        const failing = () => Promise.reject(new TypeError('boom'));
        await expect(probe(failing)).rejects.toMatchObject({ name: 'ProbeError', code: 'INVALID' });
    });
});

describe('Dolby audio', () => {
    it('E-AC-3 in MP4 whose dec3 has no JOC extension: Atmos decided from the first sample', async () => {
        // Derived from eac3-joc-mp4: the dec3 box is shortened by its 2 extension bytes.
        const result = await runPatched('eac3-joc-mp4', (data) => {
            const box = indexOfText(data, 'dec3') - 4;
            data[box + 3] -= 2;
        });
        expect(audioOf(result)[0].audio).toMatchObject({ atmos: true, profile: 'E-AC-3 JOC' });
        expect(result.warnings).toEqual([]);
    });

    it('E-AC-3 JOC in MP4 whose dec3 extension was zeroed: the first sample still says Atmos', async () => {
        const result = await runPatched('eac3-joc-mp4', (data) => {
            const box = indexOfText(data, 'dec3') - 4;
            const size = data[box + 3];
            data[box + size - 2] = 0;
            data[box + size - 1] = 0;
        });
        expect(audioOf(result)[0].audio).toMatchObject({ atmos: true, profile: 'E-AC-3 JOC' });
    });

    it('DD+ Atmos (E-AC-3 JOC) in MP4, from dec3', async () => {
        const result = await run('eac3-joc-mp4');
        expect(audioOf(result).map(pick)).toEqual([{ id: 1, type: 'audio', codec: 'eac3', language: null, default: true }]);
        expect(audioOf(result)[0].audio).toMatchObject({ channels: 6, sampleRate: 48000, atmos: true, profile: 'E-AC-3 JOC', complexityIndex: 16 });
        expect(result.summary).toMatchObject({ atmos: true, audioCodecs: ['eac3'] });
    });

    it('plain E-AC-3 5.1 in MP4 is not Atmos', async () => {
        const result = await run('eac3-mp4');
        expect(audioOf(result)[0].audio).toMatchObject({ channels: 6, atmos: false, profile: null });
        expect(result.summary.atmos).toBe(false);
    });

    it('TrueHD Atmos in MP4 (mlpa + dmlp, Atmos from the first sample)', async () => {
        const result = await run('truehd-atmos-mp4');
        expect(audioOf(result).map(pick)).toEqual([{ id: 1, type: 'audio', codec: 'truehd', language: null, default: true }]);
        expect(audioOf(result)[0].audio).toMatchObject({ channels: 8, sampleRate: 48000, atmos: true, profile: 'TrueHD Atmos' });
        expect(result.warnings).toEqual([]);
    });

    it('P8.1 MKV with E-AC-3 JOC, DTS-HD MA, DTS core and a forced SRT (frame sniffing)', async () => {
        const result = await run('dv-p81-multi-mkv');
        expect(result.tracks.map(pick)).toEqual([
            { id: 1, type: 'video', codec: 'hevc', language: null, default: true },
            { id: 2, type: 'audio', codec: 'eac3', language: 'por', default: true },
            { id: 3, type: 'audio', codec: 'dts', language: 'eng', default: false },
            { id: 4, type: 'audio', codec: 'dts', language: 'spa', default: false },
            { id: 5, type: 'subtitle', codec: 'srt', language: 'por', default: false },
        ]);
        expect(result.summary.dolbyVision).toMatchObject({ profileName: '8.1', baseLayer: 'hdr10' });
        expect(result.tracks[0].video.colour).toEqual({ primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020nc', fullRange: false });
        expect(result.tracks[1].audio).toMatchObject({ channels: 6, atmos: true, profile: 'E-AC-3 JOC' });
        expect(result.tracks[2].audio).toMatchObject({ channels: 8, atmos: false, profile: 'DTS-HD MA' });
        expect(result.tracks[2].name).toBe('DTS-HD MA 7.1');
        expect(result.tracks[3].audio).toMatchObject({ channels: 6, atmos: false, profile: 'DTS' });
        expect(result.tracks[4]).toMatchObject({ forced: true, subtitle: { text: true } });
        expect(result.summary).toMatchObject({ atmos: true, audioCodecs: ['eac3', 'dts'], audioTracks: 3, subtitleTracks: 1 });
        expect(result.seekIndex).toBe(true);
        expect(result.warnings).toEqual([]);
    });

    it('without frame sniffing, MKV Atmos and DTS flavour stay unknown', async () => {
        const fixture = loadFixture('dv-p81-multi-mkv');
        const result = await probe(replayReadRange(fixture), Object.assign({}, fixture.meta.options, { sniffFrames: false }));
        expect(result.tracks[1].audio.atmos).toBeNull();
        expect(result.tracks[2].audio.profile).toBeNull();
        expect(result.summary.atmos).toBeNull();
    });
});

describe('DTS', () => {
    it.each([
        ['dts-core-mkv', 'DTS', 6, null, false],
        ['dts-hdma-mkv', 'DTS-HD MA', 8, 'eng', true],
        ['dts-x-mkv', 'DTS-HD MA + DTS:X', 8, 'eng', true],
        ['dts-express-mka', 'DTS Express', 6, null, false],
    ])('%s in Matroska is %s (first frame)', async (id, profile, channels, language, isDefault) => {
        const result = await run(id);
        expect(result.container).toBe('mkv');
        expect(audioOf(result).map(pick)).toEqual([{ id: 1, type: 'audio', codec: 'dts', language, default: isDefault }]);
        expect(audioOf(result)[0].audio).toMatchObject({ channels, sampleRate: 48000, profile, atmos: false });
        expect(result.warnings).toEqual([]);
    });

    it('DTS-HD MA in MP4 (mp4a/esds, moov at the end, flavour from the first sample)', async () => {
        const result = await run('dts-hdma-mp4');
        expect(result.moovAtStart).toBe(false);
        expect(audioOf(result).map(pick)).toEqual([{ id: 1, type: 'audio', codec: 'dts', language: 'eng', default: true }]);
        expect(audioOf(result)[0]).toMatchObject({ codecId: 'mp4a', audio: { channels: 8, sampleRate: 48000, profile: 'DTS-HD MA' } });
    });

    it('DTS in MP4: dtsc (core) and dtsx (DTS-UHD, no core) sample entries', async () => {
        const core = await run('dtsc-mp4');
        expect(core.tracks.map(pick)).toEqual([{ id: 1, type: 'audio', codec: 'dts', language: null, default: true }]);
        expect(core.tracks[0].audio).toMatchObject({ channels: 6, sampleRate: 48000, profile: 'DTS', atmos: false });
        const x = await run('dtsx-mp4');
        expect(x.tracks[0]).toMatchObject({ codec: 'dts', codecId: 'dtsx' });
        expect(x.tracks[0].audio).toMatchObject({ channels: 6, profile: 'DTS-UHD' });
    });
});

describe('general', () => {
    it('multi-audio MKV with languages, default flags and text subtitles (kit t2_multi)', async () => {
        const result = await run('kit-multi-mkv');
        expect(result.tracks.map(pick)).toEqual([
            { id: 1, type: 'video', codec: 'avc', language: null, default: false },
            { id: 2, type: 'audio', codec: 'aac', language: 'eng', default: true },
            { id: 3, type: 'audio', codec: 'aac', language: 'por', default: false },
            { id: 4, type: 'audio', codec: 'ac3', language: 'eng', default: false },
            { id: 5, type: 'subtitle', codec: 'srt', language: 'eng', default: true },
            { id: 6, type: 'subtitle', codec: 'srt', language: 'por', default: false },
        ]);
        expect(result.tracks[3].audio).toMatchObject({ channels: 6, atmos: false });
        expect(result.summary).toMatchObject({ hdr: null, dolbyVision: null, atmos: false });
    });
});
