/* global describe, it, expect, beforeAll, afterAll */
// F6.4: the `e2e` set of the test addon (webos/tests/addon/catalog.js), the list of the end-to-end
// run, ordered and labelled by the C8 rules from the names and with the header probe. The e2e media
// come from webos/tests/e2e/make-media.sh and are not in git: without them only the fixture of the
// REMUX is probed (and the test says so). webos/tests/e2e/run.mjs checks the list the app shows
// against the same libraries.

const fs = require('fs');
const os = require('os');
const path = require('path');
const rules = require('../../lib/c8-rules');
const ranking = require('../../lib/stream-ranking');
const { probe } = require('../../lib/header-probe');
const { E2E_STREAMS, toStreams, fileNameOf } = require('../addon/catalog');
const { prepareMedia } = require('../addon/media');

const MEDIA_URL = 'http://media.test';
const entryOf = (stream) => E2E_STREAMS.filter((entry) => entry.description === stream.description)[0];
const idsOf = (ranked) => ranked.map((entry) => entryOf(entry.stream).id);
const codesOf = (result) => result.labels.map((label) => label.code).concat(result.warnings.map((warning) => warning.code));

const fileReadRange = (file) => {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    return (offset, length) => {
        const end = Math.min(offset + length, size);
        const data = Buffer.alloc(Math.max(0, end - offset));
        if (data.length > 0) fs.readSync(fd, data, 0, data.length, offset);
        return Promise.resolve({ data: new Uint8Array(data.buffer, data.byteOffset, data.length), size });
    };
};

let dir;
let missing;
const streams = toStreams(MEDIA_URL, 'e2e');
const playable = streams.filter((stream) => !stream.infoHash);
const probes = new Map();

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f64-media-'));
    const files = E2E_STREAMS.filter((entry) => entry.media).map((entry) => entry.media)
        .concat(...E2E_STREAMS.map((entry) => (entry.subtitles || []).map((subtitle) => subtitle.file)));
    missing = prepareMedia(dir, files.filter((file, index) => files.indexOf(file) === index));
    if (missing.length > 0) {
        console.warn('[F6.4] mídias do e2e ausentes (webos/tests/e2e/make-media.sh); sem probe para: ' + missing.join(', '));
    }
    for (const stream of playable) {
        const entry = entryOf(stream);
        const file = path.join(dir, entry.media);
        // The expired link answers 410: the probe of the list fails there (no result).
        if (entry.path || !ranking.canProbe(stream) || !fs.existsSync(file)) continue;
        probes.set(stream.url, await probe(fileReadRange(file), { maxBytes: ranking.LIST_PROBE_OPTIONS.maxBytes, maxRequests: ranking.LIST_PROBE_OPTIONS.maxRequests }));
    }
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('e2e set: the addon answer', () => {
    it('every stream but the torrent is a debrid-like link through the resolver (302)', () => {
        expect(playable.every((stream) => stream.url.indexOf(`${MEDIA_URL}/redirect/`) === 0)).toBe(true);
        expect(streams.filter((stream) => stream.infoHash).map((stream) => entryOf(stream).id)).toEqual(['e2e-torrent']);
    });

    it('the expired link redirects to a host that answers 410 (F6.3)', () => {
        const expired = playable.filter((stream) => entryOf(stream).id === 'e2e-expired')[0];
        expect(expired.url).toBe(`${MEDIA_URL}/redirect/status/410/e2e/e2e_1080p_h264_aac.mp4`);
    });

    it('the MKV with several tracks carries two add-on subtitles (eng, por)', () => {
        const multi = playable.filter((stream) => entryOf(stream).id === 'e2e-multi-subs')[0];
        expect(multi.subtitles).toEqual([
            { id: 'e2e-multi-subs-eng', lang: 'eng', url: `${MEDIA_URL}/e2e/e2e_addon_eng.srt` },
            { id: 'e2e-multi-subs-por', lang: 'por', url: `${MEDIA_URL}/e2e/e2e_addon_por.srt` },
        ]);
    });

    it('the file names are unique (the run finds a stream by the 1st line of its description)', () => {
        const names = playable.map((stream) => fileNameOf(entryOf(stream)));
        expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
    });
});

describe('e2e set: C8 order and labels', () => {
    it('names only: the REMUX with DV P5 + TrueHD goes from first to last, the rest keeps the addon order', () => {
        playable.forEach((stream) => {
            const [tier, ...codes] = entryOf(stream).expect.name;
            const result = rules.evaluate({ stream });
            expect({ id: entryOf(stream).id, tier: result.tier }).toEqual({ id: entryOf(stream).id, tier });
            expect(codesOf(result)).toEqual(expect.arrayContaining(codes));
        });
        const ranked = ranking.createRanker({ rules }).rank(playable);
        expect(idsOf(ranked)).toEqual(['e2e-uhd-hdr10', 'e2e-fhd-h264-aac', 'e2e-multi-subs', 'e2e-expired', 'e2e-remux-dv-p5-truehd']);
        expect(ranking.describe(ranked[0]).labels.map((label) => label.text)).toEqual(['HDR10']);
        expect(ranking.describe(ranked[4]).warnings.map((warning) => warning.text)).toEqual(['DV P5: cores erradas', 'TrueHD: pode ficar sem som']);
    });

    it('with the probe: same order, the REMUX warning confirmed by the file', () => {
        expect(probes.size).toBeGreaterThan(0);
        playable.forEach((stream) => {
            if (!probes.has(stream.url)) return;
            const [tier, ...codes] = entryOf(stream).expect.probe;
            const result = rules.evaluate({ stream, probe: probes.get(stream.url) });
            expect(result.sources.probe).toBe(true);
            expect({ id: entryOf(stream).id, tier: result.tier }).toEqual({ id: entryOf(stream).id, tier });
            expect(codesOf(result)).toEqual(expect.arrayContaining(codes));
        });
        const ranked = ranking.createRanker({ rules }).rank(playable, { probeOf: (stream) => probes.get(stream.url) || null });
        expect(idsOf(ranked)).toEqual(['e2e-uhd-hdr10', 'e2e-fhd-h264-aac', 'e2e-multi-subs', 'e2e-expired', 'e2e-remux-dv-p5-truehd']);
        const remux = ranked.filter((entry) => entryOf(entry.stream).id === 'e2e-remux-dv-p5-truehd')[0];
        expect(ranking.describe(remux).warnings.map((warning) => warning.text)).toEqual(['DV P5: cores erradas', 'TrueHD: sem som nesta TV']);
    });

    it('the first probes of the list go to the top 4 (the expired one included: its failure is what F6.3 shows)', () => {
        const ranked = ranking.createRanker({ rules }).rank(playable);
        expect(ranking.pickProbeTargets(ranked, ranking.LIST_SETTINGS.initialProbes).map((stream) => entryOf(stream).id))
            .toEqual(['e2e-uhd-hdr10', 'e2e-fhd-h264-aac', 'e2e-multi-subs', 'e2e-expired']);
    });
});
