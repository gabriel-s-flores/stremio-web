/* global describe, it, expect, jest */
// F6.3: the stream list's real probe queue and the Player's real probe cache against a fake debrid
// that answers 403: the HTTP status they keep is what the link check uses, so the Player's error
// layer sends no request of its own.

const debridLink = require('..');
const ranking = require('../../stream-ranking');
const { createProbeCache } = require('../../tracks/probe-cache');
const headerProbe = require('../../header-probe');

const stream = { url: 'https://resolver.example/resolve/KEY/file.mkv' };
const refusing = (status) => jest.fn(() => Promise.resolve({ status, redirected: true, url: 'https://cdn.example/f.mkv', headers: { get: () => null }, body: null }));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('link check after a refused probe', () => {
    it('reuses the list probe: 403 on the file host, no new request', async () => {
        const fetchImpl = refusing(403);
        const queue = ranking.createProbeQueue({ probe: (url, item) => ranking.probeStream(url, item, fetchImpl) });
        queue.request(stream.url, stream);
        await flush();
        await flush();
        expect(queue.get(stream.url)).toMatchObject({ status: 'failed', error: 'HTTP', httpStatus: 403 });

        const checkFetch = jest.fn();
        const checker = debridLink.createDiagnoser({ fetch: checkFetch, getQueue: () => queue, getFailure: () => null });
        expect(await checker.diagnose(stream, 83)).toMatchObject({ kind: 'expired', status: 403, source: 'list-probe' });
        expect(checkFetch).not.toHaveBeenCalled();
    });

    it('reuses the Player probe: 404', async () => {
        const fetchImpl = refusing(404);
        const cache = createProbeCache({ probe: (url) => headerProbe.probe(headerProbe.createFetchReadRange(url, { fetch: fetchImpl })) });
        await expect(cache.get(stream.url)).rejects.toMatchObject({ code: 'HTTP', httpStatus: 404 });

        const checkFetch = jest.fn();
        const checker = debridLink.createDiagnoser({ fetch: checkFetch, getQueue: () => ({ get: () => null }), getFailure: (url) => cache.failureOf(url) });
        expect(await checker.diagnose(stream, 83)).toMatchObject({ kind: 'not-found', status: 404, source: 'player-probe' });
        expect(checkFetch).not.toHaveBeenCalled();
    });
});
