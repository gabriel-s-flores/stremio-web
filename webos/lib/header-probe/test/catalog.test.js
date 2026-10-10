/* global describe, it, expect */
// The probe over the F0.10 catalogue of real headers (webos/tests/media/headers, sources and
// licences in its CATALOGO.md). Those are whole files, read here through the same readRange
// contract. Expected values are the ffprobe facts listed in the catalogue.

const fs = require('fs');
const path = require('path');
const { probe } = require('../index');
const { bufferReadRange } = require('./replay');

const HEADERS = path.join(__dirname, '..', '..', '..', 'tests', 'media', 'headers');

const run = (name) => probe(bufferReadRange(new Uint8Array(fs.readFileSync(path.join(HEADERS, name)))));

const audio = (result) => result.tracks.filter((track) => track.type === 'audio')
    .map((track) => [track.codec, track.audio.profile, track.audio.channels, track.language]);

const CASES = [
    ['dv-p8.1-mkvmerge.mkv', { dv: ['8.1', 'hdr10'], audio: [] }],
    ['dv-p8.4-hlg-iphone.mov', { dv: ['8.4', 'hlg'], audio: [['aac', 'AAC LC', 2, null]] }],
    ['dv-p9-avc-dvav-head512k.mp4', { dv: ['9', 'sdr'], audio: [] }],
    ['dv-p10-av1-dav1-moov-end.mp4', { dv: ['10.0', 'none'], audio: [] }],
    ['eac3joc-atmos.mp4', { atmos: true, audio: [['eac3', 'E-AC-3 JOC', 6, null]] }],
    ['eac3joc-atmos-fragmented.mp4', { atmos: true, audio: [['eac3', 'E-AC-3 JOC', 6, null]] }],
    ['eac3joc-atmos.mkv', { atmos: true, audio: [['eac3', 'E-AC-3 JOC', 6, null]] }],
    ['eac3-plain-no-joc.mp4', { atmos: false, audio: [['eac3', null, 6, null]] }],
    ['truehd-atmos.mp4', { atmos: true, audio: [['truehd', 'TrueHD Atmos', 8, null]] }],
    ['dts-core.mkv', { atmos: false, audio: [['dts', 'DTS', 6, null]] }],
    ['dts-hd-ma.mkv', { audio: [['dts', 'DTS-HD MA', 8, 'eng']] }],
    ['dts-x.mkv', { audio: [['dts', 'DTS-HD MA + DTS:X', 8, 'eng']] }],
    ['dts-express.mka', { audio: [['dts', 'DTS Express', 6, null]] }],
    ['dts-hd-ma.mp4', { audio: [['dts', 'DTS-HD MA', 8, 'eng']] }],
    ['mkv-video-ac3-pgs.mkv', { audio: [['ac3', null, 1, null]], subtitles: [['pgs', 'eng', false]] }],
    ['mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv', {
        atmos: true,
        audio: [['ac3', null, 1, 'eng'], ['eac3', 'E-AC-3 JOC', 6, 'por'], ['dts', 'DTS-HD MA', 8, 'eng'], ['truehd', 'TrueHD Atmos', 8, 'jpn']],
        subtitles: [['pgs', 'eng', false]],
    }],
];

describe('F0.10 header catalogue', () => {
    it('covers every catalogued file in the repository', () => {
        const files = fs.readdirSync(HEADERS).filter((name) => /\.(mkv|mka|mp4|mov)$/.test(name));
        expect(files.sort()).toEqual(CASES.map((entry) => entry[0]).sort());
    });

    it.each(CASES)('%s', async (name, expected) => {
        const result = await run(name);
        expect(result.warnings).toEqual([]);
        expect(audio(result)).toEqual(expected.audio);
        if (expected.dv) {
            expect([result.summary.dolbyVision.profileName, result.summary.dolbyVision.baseLayer]).toEqual(expected.dv);
        } else {
            expect(result.summary.dolbyVision).toBeNull();
        }
        if (expected.atmos !== undefined) expect(result.summary.atmos).toBe(expected.atmos);
        if (expected.subtitles) {
            expect(result.tracks.filter((track) => track.type === 'subtitle')
                .map((track) => [track.codec, track.language, track.subtitle.text])).toEqual(expected.subtitles);
        }
    });
});
