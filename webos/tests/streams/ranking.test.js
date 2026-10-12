/* global describe, it, expect, beforeAll, afterAll */
// F6.2: the test addon list (webos/tests/addon) ordered and labelled by the C8 rules, from the
// names alone (the list as it opens) and with the header probe of every file (the list once the
// probes are done). Same streams and media as the emulator run (webos/tests/streams/emulator.sh).

const rules = require('../../lib/c8-rules');
const ranking = require('../../lib/stream-ranking');
const { setup, entryOf } = require('./helpers');

const codesOf = (result) => result.labels.map((label) => label.code).concat(result.warnings.map((warning) => warning.code));
const idsOf = (ranked) => ranked.map((entry) => entryOf(entry.stream).id);

let media;
const probes = new Map();

beforeAll(async () => {
    media = setup();
    if (media.missing.length > 0) {
        console.warn('[F6.2] mídias do kit ausentes (webos/tools/gen-media.sh); sem probe para: ' + media.missing.join(', '));
    }
    for (const stream of media.streams) {
        if (ranking.canProbe(stream)) {
            const result = await media.probeUrl(stream.url);
            if (result !== null) probes.set(stream.url, result);
        }
    }
});

afterAll(() => media.cleanup());

describe('test addon: names only (the list as it opens)', () => {
    it('each stream gets the tier, labels and warnings of the catalogue', () => {
        media.streams.forEach((stream) => {
            const [tier, ...codes] = entryOf(stream).expect.name;
            const result = rules.evaluate({ stream });
            expect({ id: entryOf(stream).id, tier: result.tier }).toEqual({ id: entryOf(stream).id, tier });
            expect(codesOf(result)).toEqual(expect.arrayContaining(codes));
        });
    });

    it('DV in MP4 first, then HDR10 nesta TV + Atmos; DTS plays (F8.4); TrueHD and DV P5 in MKV demoted; AV1 last', () => {
        const ranked = ranking.createRanker({ rules }).rank(media.streams);
        expect(idsOf(ranked)).toEqual([
            'web-dv-p81-mp4',
            'web-dv-p5-mp4',
            'web-dv-hdr10-atmos-mkv',
            'uncached-hdr10',
            'remux-unnamed',
            'dts-hd-ma',
            'web-hevc10-ddp',
            'web-multi-mkv',
            'web-unnamed-atmos',
            'web-h264-aac',
            'truehd-only',
            'remux-dv-p5-truehd',
            'web-av1',
        ]);
    });

    it('the first probes go to the top 4 probeable streams, never to the uncached one', () => {
        const ranked = ranking.createRanker({ rules }).rank(media.streams);
        const targets = ranking.pickProbeTargets(ranked, ranking.LIST_SETTINGS.initialProbes);
        expect(targets.map((stream) => entryOf(stream).id)).toEqual(['web-dv-p81-mp4', 'web-dv-p5-mp4', 'web-dv-hdr10-atmos-mkv', 'remux-unnamed']);
        expect(media.streams.filter((stream) => !ranking.canProbe(stream)).map((stream) => entryOf(stream).id)).toEqual(['uncached-hdr10']);
    });
});

describe('test addon: with the header probe', () => {
    it('each probed stream gets the tier, labels and warnings of the catalogue', () => {
        media.streams.forEach((stream) => {
            const entry = entryOf(stream);
            if (!probes.has(stream.url)) return;
            const [tier, ...codes] = entry.expect.probe;
            const result = rules.evaluate({ stream, probe: probes.get(stream.url) });
            expect(result.sources.probe).toBe(true);
            expect({ id: entry.id, tier: result.tier }).toEqual({ id: entry.id, tier });
            expect(codesOf(result)).toEqual(expect.arrayContaining(codes));
        });
        // The fixtures and the F0.10 headers are in git: those are always probed.
        ['remux-dv-p5-truehd', 'remux-unnamed', 'web-dv-hdr10-atmos-mkv', 'truehd-only', 'web-dv-p81-mp4', 'web-dv-p5-mp4', 'dts-hd-ma', 'web-unnamed-atmos', 'web-av1']
            .forEach((id) => expect(media.streams.some((stream) => entryOf(stream).id === id && probes.has(stream.url))).toBe(true));
    });

    it('the probe moves the unnamed REMUX (DV P5 + TrueHD) down and gives the unnamed 720p its Atmos', () => {
        const ranked = ranking.createRanker({ rules }).rank(media.streams, { probeOf: (stream) => probes.get(stream.url) || null });
        const ids = idsOf(ranked);
        expect(ids.slice(0, 4)).toEqual(['web-dv-p81-mp4', 'web-dv-p5-mp4', 'web-dv-hdr10-atmos-mkv', 'web-unnamed-atmos']);
        expect(ids.indexOf('remux-unnamed')).toBeGreaterThan(ids.indexOf('truehd-only'));
        expect(ids[ids.length - 1]).toBe('web-av1');
        const atmos = ranked.filter((entry) => entryOf(entry.stream).id === 'web-unnamed-atmos')[0];
        expect(ranking.describe(atmos).labels.map((label) => label.text)).toEqual(['Atmos']);
        const remux = ranked.filter((entry) => entryOf(entry.stream).id === 'remux-unnamed')[0];
        expect(ranking.describe(remux).warnings.map((warning) => warning.text)).toEqual(['DV P5: cores erradas', 'TrueHD: sem som nesta TV']);
    });
});
