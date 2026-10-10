/* global describe, it, expect */
// D6: the C8 facts live in perfil-c8.json and phase 8 changes them by configuration. These tests
// check the file itself and that overrides change decisions without code changes.

const { evaluate, compare, sortStreams, mergeProfile, DEFAULT_PROFILE } = require('../index');
const { probeFixture, probeHeader, codes } = require('./helpers');

const STATUSES = ['ok', 'unconfirmed', 'unknown', 'unsupported'];
const SEVERITIES = ['info', 'demote', 'hide'];

describe('perfil-c8.json', () => {
    it('uses only known status and severity values', () => {
        Object.keys(DEFAULT_PROFILE.video.codecs).forEach((codec) => {
            expect(STATUSES).toContain(DEFAULT_PROFILE.video.codecs[codec]);
        });
        Object.keys(DEFAULT_PROFILE.audio.codecs).forEach((codec) => {
            expect(STATUSES).toContain(DEFAULT_PROFILE.audio.codecs[codec].status);
        });
        Object.keys(DEFAULT_PROFILE.warnings).forEach((code) => {
            expect(SEVERITIES).toContain(DEFAULT_PROFILE.warnings[code].severity);
            expect(typeof DEFAULT_PROFILE.warnings[code].score).toBe('number');
        });
    });

    it('states the table and D8: DTS "a confirmar", TrueHD and AV1 unsupported, only 1x', () => {
        expect(DEFAULT_PROFILE.audio.codecs.dts.status).toBe('unconfirmed');
        expect(DEFAULT_PROFILE.audio.codecs.truehd.status).toBe('unsupported');
        expect(DEFAULT_PROFILE.audio.atmosCodecs).toEqual(['eac3']);
        expect(DEFAULT_PROFILE.audio.preference[0]).toBe('eac3-atmos');
        expect(DEFAULT_PROFILE.video.codecs.av1).toBe('unsupported');
        expect(DEFAULT_PROFILE.video.dolbyVision.mkv).toEqual({ default: 'base-layer' });
        expect(DEFAULT_PROFILE.playback.rates).toEqual([1]);
    });

    it('has a rule and a label text for every code the engine emits on the real headers', async () => {
        const results = [
            evaluate({ probe: await probeHeader('mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv'), preferences: { audioLanguages: ['jpn'] } }),
            evaluate({ probe: await probeFixture('dv-p5-truehd-atmos-mkv') }),
            evaluate({ probe: await probeFixture('dv-p81-multi-mkv') }),
            evaluate({ probe: await probeFixture('dv-p5-mp4') }),
            evaluate({ probe: await probeFixture('dts-core-mkv') }),
            evaluate({ probe: await probeHeader('dv-p10-av1-dav1-moov-end.mp4') }),
            evaluate({ stream: 'DV TrueHD Atmos' }),
            evaluate({ stream: 'DTS' }),
        ];
        results.forEach((result) => {
            result.warnings.forEach((warning) => expect(DEFAULT_PROFILE.warnings[warning.code]).toBeDefined());
            result.labels.forEach((label) => expect(DEFAULT_PROFILE.labels[label.code]).toBe(label.text));
        });
    });
});

describe('mergeProfile (phase 8 overrides)', () => {
    it('merges objects deeply and replaces arrays and values, without touching the base', () => {
        const merged = mergeProfile(DEFAULT_PROFILE, { audio: { codecs: { dts: { status: 'ok' } }, preference: ['ac3'] } });
        expect(merged.audio.codecs.dts).toEqual({ status: 'ok' });
        expect(merged.audio.codecs.truehd.status).toBe('unsupported');
        expect(merged.audio.preference).toEqual(['ac3']);
        expect(DEFAULT_PROFILE.audio.codecs.dts.status).toBe('unconfirmed');
        expect(mergeProfile(DEFAULT_PROFILE, null)).toBe(DEFAULT_PROFILE);
    });

    it('DTS confirmed on the TV: the eng DTS-HD MA track is chosen for an eng user', async () => {
        const probe = await probeFixture('dv-p81-multi-mkv');
        const profile = mergeProfile(DEFAULT_PROFILE, { audio: { codecs: { dts: { status: 'ok' } } } });
        const result = evaluate({ probe, profile, preferences: { audioLanguages: ['eng'] } });
        expect(result.audio.initialTrack).toMatchObject({ id: 3, codec: 'dts', language: 'eng', status: 'ok' });
        expect(codes(result.warnings)).not.toContain('AUDIO_TRACK_SKIPPED');
    });

    it('DTS ruled out on the TV: DTS-only becomes mute', async () => {
        const profile = mergeProfile(DEFAULT_PROFILE, { audio: { codecs: { dts: { status: 'unsupported' } } } });
        const result = evaluate({ probe: await probeFixture('dts-hdma-mkv'), profile });
        expect(result.audio.initialTrack).toBeNull();
        expect(codes(result.warnings)).toContain('AUDIO_UNSUPPORTED');
    });

    it('P5 in MKV can be hidden instead of demoted, and AV1 demoted instead of hidden', async () => {
        const profile = mergeProfile(DEFAULT_PROFILE, {
            warnings: { DV_WRONG_COLORS: { severity: 'hide' }, VIDEO_UNSUPPORTED: { severity: 'demote' } },
        });
        expect(evaluate({ probe: await probeFixture('dv-p5-nobam-mkv'), profile }).tier).toBe('hidden');
        expect(evaluate({ probe: await probeHeader('dv-p10-av1-dav1-moov-end.mp4'), profile }).tier).toBe('demoted');
        // the score of an overridden rule stays the default one when only the severity changes
        expect(profile.warnings.DV_WRONG_COLORS.score).toBe(DEFAULT_PROFILE.warnings.DV_WRONG_COLORS.score);
    });

    it('if the C8 turned out to activate DV in MKV for P8.1, one line changes the label', async () => {
        const profile = mergeProfile(DEFAULT_PROFILE, { video: { dolbyVision: { mkv: { '8.1': 'dolby-vision' } } } });
        const result = evaluate({ probe: await probeFixture('dv-p81-mkvmerge-mkv'), profile });
        expect(codes(result.labels)).toEqual(['dv']);
    });

    it('label texts and scores come from the profile', async () => {
        const profile = mergeProfile(DEFAULT_PROFILE, { labels: { 'hdr10-on-tv': 'HDR10 (DV inativo)' }, scoring: { labels: { 'hdr10-on-tv': 99 } } });
        const result = evaluate({ probe: await probeFixture('dv-p81-mkvmerge-mkv'), profile });
        expect(result.labels[0].text).toBe('HDR10 (DV inativo)');
        expect(result.score).toBe(99);
    });
});

describe('evaluate input handling', () => {
    it('ignores a probe output of another format version, with an info warning', async () => {
        const probe = Object.assign({}, await probeFixture('dv-p5-mp4'), { version: 2 });
        const result = evaluate({ probe, stream: 'Movie DV P5 mkv' });
        expect(result.sources).toEqual({ probe: false, name: true });
        expect(codes(result.warnings)).toEqual(['PROBE_IGNORED', 'DV_WRONG_COLORS']);
    });

    it('works with nothing at all', () => {
        const result = evaluate();
        expect(result).toMatchObject({ sources: { probe: false, name: false }, container: null, tier: 'ok', score: 0, needsProbe: false });
        expect(result.audio).toEqual({ status: null, initialTrack: null, tracks: [], atmos: false });
    });

    it('compare returns 0 for equal results', () => {
        const a = evaluate({ stream: 'A 1080p x264 AAC' });
        const b = evaluate({ stream: 'B 1080p x264 AC3' });
        expect(compare(a, b)).toBe(0);
    });

    it('sortStreams keeps the addon order even with an unstable Array#sort (injected)', () => {
        const streams = [];
        for (let i = 0; i < 12; i++) streams.push({ id: i, rules: evaluate({ stream: i % 2 ? 'S 2160p DV P5 HEVC mkv' : 'S 1080p x264 AAC' }) });
        const original = Array.prototype.sort;
        // Stable sort of the reversed array: equal items come out in reverse order.
        Array.prototype.sort = function (comparator) {
            const sorted = original.call(this.slice().reverse(), comparator);
            for (let i = 0; i < sorted.length; i++) this[i] = sorted[i];
            return this;
        };
        let ids;
        let plain;
        try {
            ids = sortStreams(streams, (stream) => stream.rules).map((stream) => stream.id);
            plain = streams.slice().sort((a, b) => compare(a.rules, b.rules)).map((stream) => stream.id);
        } finally {
            Array.prototype.sort = original;
        }
        expect(ids).toEqual([0, 2, 4, 6, 8, 10, 1, 3, 5, 7, 9, 11]);
        expect(plain).not.toEqual(ids);
    });

    it('sortStreams keeps the addon order among equals, also above 10 items (V8 5.3 sort is unstable)', () => {
        const streams = [];
        for (let i = 0; i < 30; i++) {
            const kind = i % 3;
            const text = kind === 0 ? 'S' + i + ' 1080p x264 AAC' : (kind === 1 ? 'S' + i + ' 2160p DV P5 HEVC mkv' : 'S' + i + ' 2160p WEB-DL DV P8.1 HEVC.mp4');
            streams.push({ id: i, rules: evaluate({ stream: text }) });
        }
        const sorted = sortStreams(streams, (stream) => stream.rules).map((stream) => stream.id);
        const ids = (kind) => streams.filter((stream) => stream.id % 3 === kind).map((stream) => stream.id);
        expect(sorted).toEqual(ids(2).concat(ids(0), ids(1)));
        expect(streams.map((stream) => stream.id)).toEqual(streams.map((_, index) => index));
        expect(sortStreams([3, 1].map((n) => evaluate({ stream: n === 3 ? 'AV1' : 'x264' })))[0].tier).toBe('ok');
    });
});
