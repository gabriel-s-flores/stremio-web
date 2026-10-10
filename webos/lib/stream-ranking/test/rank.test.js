/* global describe, it, expect, jest */
// Ranking by the C8 rules: name signals at once, probe output when present, stable ties, the
// frozen order and the choice of the streams to probe.

const rules = require('../../c8-rules');
const { probeUrlOf, canProbe, isUncached, streamKey, createRanker, applyFrozenOrder, orderOf, pickProbeTargets } = require('../rank');
const { probeFixture } = require('../../c8-rules/test/helpers');

const stream = (description, extra) => Object.assign({ name: '[RD+] Teste', description, url: `https://debrid.example/${encodeURIComponent(description)}` }, extra);
const descriptions = (ranked) => ranked.map((entry) => entry.stream.description);

describe('probeable streams', () => {
    it('only direct HTTP(S) links are probed', () => {
        expect(probeUrlOf(stream('a'))).toBe('https://debrid.example/a');
        expect(probeUrlOf({ url: 'http://10.0.2.2:8099/redirect/a.mkv' })).toBe('http://10.0.2.2:8099/redirect/a.mkv');
        expect(probeUrlOf({ ytId: 'abc' })).toBeNull();
        expect(probeUrlOf({ externalUrl: 'https://imdb.com' })).toBeNull();
        expect(probeUrlOf({ url: 'magnet:?xt=urn:btih:abc' })).toBeNull();
        expect(probeUrlOf(null)).toBeNull();
    });

    it('streams not in the debrid cache are never probed (the addon would start the download)', () => {
        const uncached = [
            { name: '[RD download] Torrentio\n4k', url: 'https://torrentio.example/a' },
            { name: '[RD⬇️] Comet\n4k', url: 'https://comet.example/a' },
            { name: '⏳ MediaFusion\n1080p', url: 'https://mf.example/a' },
            { name: 'AIO', description: 'uncached', url: 'https://aio.example/a' },
        ];
        uncached.forEach((entry) => {
            expect(isUncached(entry)).toBe(true);
            expect(canProbe(entry)).toBe(false);
        });
        ['[RD+] Torrentio\n4k', '[RD⚡] Comet', '⚡ MediaFusion'].forEach((name) => {
            expect(canProbe({ name, url: 'https://x.example/a' })).toBe(true);
        });
    });

    it('the key joins the source and the text the rules read', () => {
        const a = stream('Movie.2160p.DV.mkv');
        expect(streamKey(a)).toBe(streamKey(Object.assign({}, a)));
        expect(streamKey(a)).not.toBe(streamKey(Object.assign({}, a, { name: 'other' })));
        expect(streamKey(a)).not.toBe(streamKey(Object.assign({}, a, { behaviorHints: { filename: 'x.mp4' } })));
        expect(streamKey(a)).not.toBe(streamKey(Object.assign({}, a, { url: 'https://debrid.example/b' })));
    });
});

describe('createRanker', () => {
    it('orders by tier and score from the names, keeping the addon order on ties', () => {
        const ranker = createRanker({ rules });
        const list = [
            stream('Movie.2160p.BluRay.REMUX.DV.P5.HEVC.TrueHD.7.1.Atmos.mkv'),
            stream('Movie.1080p.WEB-DL.H264.AAC.mp4'),
            stream('Movie.2160p.WEB-DL.AV1.Opus.mp4'),
            stream('Movie.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.mkv'),
            stream('Movie.1080p.WEB-DL.x265.AC3.mkv'),
            stream('Movie.2160p.WEB-DL.DV.HEVC.mp4'),
            stream('Movie.1080p.BluRay.DTS-HD.MA.mkv'),
        ];
        expect(descriptions(ranker.rank(list))).toEqual([
            'Movie.2160p.WEB-DL.DV.HEVC.mp4', // DV active (MP4): +30
            'Movie.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.mkv', // HDR10 nesta TV + Atmos: +25
            'Movie.1080p.WEB-DL.H264.AAC.mp4', // ok, 0: addon order
            'Movie.1080p.WEB-DL.x265.AC3.mkv',
            'Movie.1080p.BluRay.DTS-HD.MA.mkv', // demoted: DTS to confirm
            'Movie.2160p.BluRay.REMUX.DV.P5.HEVC.TrueHD.7.1.Atmos.mkv', // demoted: DV P5 in MKV + TrueHD
            'Movie.2160p.WEB-DL.AV1.Opus.mp4', // hidden: AV1
        ]);
    });

    it('is stable with more than 10 ties (Chromium 53 sorts those with QuickSort)', () => {
        const ranker = createRanker({ rules });
        const list = Array.from({ length: 30 }, (_, index) => stream(`Movie.${index}.1080p.WEB-DL.mkv`));
        expect(descriptions(ranker.rank(list))).toEqual(list.map((entry) => entry.description));
    });

    it('uses the probe output when there is one, and evaluates each stream once per probe', async () => {
        const evaluate = jest.fn(rules.evaluate);
        const ranker = createRanker({ rules: Object.assign({}, rules, { evaluate }) });
        const unnamed = stream('Movie.2160p.UHD.BluRay.REMUX.mkv');
        const plain = stream('Movie.1080p.WEB-DL.mkv');
        const probe = await probeFixture('dv-p5-truehd-atmos-mkv');
        const probes = new Map();
        const rank = () => ranker.rank([unnamed, plain], { probeOf: (item) => probes.get(item.url) || null });

        expect(descriptions(rank())).toEqual(['Movie.2160p.UHD.BluRay.REMUX.mkv', 'Movie.1080p.WEB-DL.mkv']);
        rank();
        expect(evaluate).toHaveBeenCalledTimes(2);

        probes.set(unnamed.url, probe);
        const ranked = rank();
        expect(descriptions(ranked)).toEqual(['Movie.1080p.WEB-DL.mkv', 'Movie.2160p.UHD.BluRay.REMUX.mkv']);
        expect(ranked[1].result.sources.probe).toBe(true);
        expect(ranked[1].result.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['DV_WRONG_COLORS', 'AUDIO_UNSUPPORTED']));
        expect(evaluate).toHaveBeenCalledTimes(3);
    });

    it('re-evaluates when the audio languages change', () => {
        const evaluate = jest.fn(rules.evaluate);
        const ranker = createRanker({ rules: Object.assign({}, rules, { evaluate }) });
        const list = [stream('Movie.1080p.mkv')];
        ranker.rank(list, { preferences: { audioLanguages: ['por'] } });
        ranker.rank(list, { preferences: { audioLanguages: ['por'] } });
        ranker.rank(list, { preferences: { audioLanguages: ['eng'] } });
        expect(evaluate).toHaveBeenCalledTimes(2);
    });

    it('items without a stream stay where they are, neutral', () => {
        const ranker = createRanker({ rules });
        const ranked = ranker.rank(['x', 'y'], { streamOf: (item) => (item === 'y' ? stream('Movie.2160p.DV.HEVC.mp4') : null) });
        expect(ranked.map((entry) => entry.item)).toEqual(['y', 'x']);
        expect(ranked[1].result).toBeNull();
    });
});

describe('frozen order', () => {
    const ranker = createRanker({ rules });
    const a = stream('Movie.2160p.WEB-DL.DV.HEVC.mp4');
    const b = stream('Movie.1080p.WEB-DL.mkv');
    const c = stream('Movie.720p.WEB-DL.mkv');
    const late = stream('Movie.2160p.WEB-DL.DV.P8.HEVC.mp4');

    it('keeps the order the user saw; streams that arrive later follow, ranked', () => {
        const frozen = orderOf(ranker.rank([c, b, a]));
        expect(Array.from(frozen.values())).toEqual([0, 1, 2]);
        // A new addon answered with `late`, which ranks first: it goes after what is on screen.
        const ranked = ranker.rank([c, b, late, a], { streamOf: (item) => item });
        const reordered = applyFrozenOrder(ranked, frozen);
        expect(descriptions(reordered)).toEqual([a, c, b, late].map((entry) => entry.description));
    });

    it('does nothing without a frozen order', () => {
        const ranked = ranker.rank([c, b, a]);
        expect(applyFrozenOrder(ranked, null)).toBe(ranked);
        expect(applyFrozenOrder(ranked, new Map())).toBe(ranked);
    });
});

describe('pickProbeTargets', () => {
    const ranker = createRanker({ rules });

    it('takes the first probeable streams of the ranked list, once per URL, and skips the known ones', () => {
        const ranked = ranker.rank([
            stream('Movie.2160p.WEB-DL.DV.HEVC.mp4'),
            { name: '[RD download] Teste', description: 'Movie.2160p.HDR10.mkv', url: 'https://debrid.example/u' },
            { name: 'YouTube', ytId: 'abc' },
            stream('Movie.1080p.WEB-DL.mkv'),
            Object.assign(stream('Movie.1080p.WEB-DL.mkv'), { name: 'other addon' }),
            stream('Movie.720p.WEB-DL.mkv'),
            stream('Movie.480p.WEB-DL.mkv'),
        ]);
        expect(pickProbeTargets(ranked, 3).map((entry) => entry.description)).toEqual([
            'Movie.2160p.WEB-DL.DV.HEVC.mp4',
            'Movie.1080p.WEB-DL.mkv',
            'Movie.720p.WEB-DL.mkv',
        ]);
        const known = (url) => url === 'https://debrid.example/Movie.1080p.WEB-DL.mkv';
        // The 4th probeable stream is not visible yet: it is not probed in place of the known one.
        expect(pickProbeTargets(ranked, 3, known).map((entry) => entry.description)).toEqual([
            'Movie.2160p.WEB-DL.DV.HEVC.mp4',
            'Movie.720p.WEB-DL.mkv',
        ]);
        expect(pickProbeTargets(ranked, 0)).toEqual([]);
    });
});
