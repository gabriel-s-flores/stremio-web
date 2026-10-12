/* global describe, it, expect, jest */
// The final URL of a stream link (F8.1): one first-byte request that follows the debrid redirect,
// shared by whoever asks at the same time, kept for a while, and the original link whenever the
// request fails or takes too long. Plus the probes that note the redirect they followed.

const { createFinalUrls, isKeepable, readFinalUrlSetting, FINAL_URL_KEY, RESOLVE_TIMEOUT_MS, REUSE_MS } = require('../index');
const { createFetchReadRange } = require('../../header-probe');

const RESOLVER = 'https://torrentio.example/resolve/realdebrid/KEY/hash/null/0/file.mkv';
const FINAL = 'https://lon1.download.debrid.example/d/TOKEN/file.mkv';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// fetch() whose answers the test controls: every request is pending until answer()/fail().
const controlledFetch = () => {
    const requests = [];
    const fetchImpl = jest.fn((url, init) => new Promise((resolve, reject) => {
        const body = { cancel: jest.fn(() => Promise.resolve()) };
        requests.push({
            url,
            init,
            body,
            answer: (status, finalUrl) => resolve({ status, url: finalUrl === undefined ? url : finalUrl, body }),
            fail: () => reject(new TypeError('Failed to fetch')),
        });
    }));
    return { fetchImpl, requests };
};

// Timers on a manual clock.
const createClock = () => {
    const clock = { t: 0, timers: [] };
    clock.now = () => clock.t;
    clock.setTimeout = (fn, ms) => {
        const timer = { at: clock.t + ms, fn };
        clock.timers.push(timer);
        return timer;
    };
    clock.clearTimeout = (timer) => {
        clock.timers = clock.timers.filter((entry) => entry !== timer);
    };
    clock.advance = (ms) => {
        clock.t += ms;
        const due = clock.timers.filter((timer) => timer.at <= clock.t);
        clock.timers = clock.timers.filter((timer) => timer.at > clock.t);
        due.forEach((timer) => timer.fn());
    };
    return clock;
};

const setup = () => {
    const clock = createClock();
    const net = controlledFetch();
    const urls = createFinalUrls({ fetch: net.fetchImpl, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    return { clock, net, urls };
};

describe('final URL', () => {
    it('follows the redirect with a first-byte request, drops the body, and keeps the answer', async () => {
        const { net, urls } = setup();
        const pending = urls.resolve(RESOLVER);
        expect(net.requests).toHaveLength(1);
        expect(net.requests[0].url).toBe(RESOLVER);
        expect(net.requests[0].init).toEqual({ headers: { Range: 'bytes=0-0' }, credentials: 'omit' });
        net.requests[0].answer(206, FINAL);
        expect(await pending).toMatchObject({ url: FINAL, source: 'redirect', host: 'lon1.download.debrid.example' });
        expect(net.requests[0].body.cancel).toHaveBeenCalled();
        expect(urls.peek(RESOLVER)).toBe(FINAL);
        expect(await urls.resolve(RESOLVER)).toMatchObject({ url: FINAL, source: 'known', ms: 0 });
        expect(net.requests).toHaveLength(1);
    });

    it('one request for whoever asks while it is in flight (the load and the Player probe)', async () => {
        const { net, urls } = setup();
        const load = urls.resolve(RESOLVER);
        const probe = urls.resolve(RESOLVER);
        expect(net.requests).toHaveLength(1);
        net.requests[0].answer(206, FINAL);
        expect((await load).url).toBe(FINAL);
        expect((await probe).url).toBe(FINAL);
    });

    // Torrentio answers /resolve/… with its own notice video while Real-Debrid caches the torrent
    // (/videos/downloading_v2.mp4, failed_access_v3.mp4…), on the resolver's origin.
    const NOTICE = 'https://torrentio.example/videos/downloading_v2.mp4';

    it('a redirect on the resolver\'s own origin (its notice video) is told as a notice and not kept', async () => {
        const { net, urls } = setup();
        const first = urls.resolve(RESOLVER);
        net.requests[0].answer(206, NOTICE);
        expect(await first).toMatchObject({ url: NOTICE, source: 'notice' });
        expect(urls.peek(RESOLVER)).toBeNull();
        // Opened again once the debrid service has the file: the resolver is asked again.
        const again = urls.resolve(RESOLVER);
        expect(net.requests).toHaveLength(2);
        net.requests[1].answer(206, FINAL);
        expect(await again).toMatchObject({ url: FINAL, source: 'redirect' });
        expect(urls.peek(RESOLVER)).toBe(FINAL);
    });

    it('note() keeps neither a redirect on the resolver\'s origin (the list probe saw the notice video)', () => {
        const { urls } = setup();
        urls.note(RESOLVER, NOTICE);
        urls.note(RESOLVER, 'HTTPS://TORRENTIO.EXAMPLE/videos/failed_access_v3.mp4');
        expect(urls.peek(RESOLVER)).toBeNull();
        urls.note(RESOLVER, FINAL);
        expect(urls.peek(RESOLVER)).toBe(FINAL);
    });

    it('a notice video served from another host is a notice too, and not kept (F8.5, B1)', async () => {
        const { net, urls } = setup();
        const other = 'https://cdn.other.example/videos/failed_access_v3.mp4';
        const first = urls.resolve(RESOLVER);
        net.requests[0].answer(206, other);
        expect(await first).toMatchObject({ url: other, source: 'notice' });
        expect(urls.peek(RESOLVER)).toBeNull();
        urls.note(RESOLVER, other);
        expect(urls.peek(RESOLVER)).toBeNull();
        expect(isKeepable(RESOLVER, other)).toBe(false);
        expect(isKeepable(RESOLVER, 'https://cdn.other.example/videos/film.mp4')).toBe(true);
    });

    it('isKeepable: the same link, or another origin (scheme, host or port)', () => {
        expect(isKeepable(FINAL, FINAL)).toBe(true);
        expect(isKeepable(RESOLVER, FINAL)).toBe(true);
        expect(isKeepable(RESOLVER, NOTICE)).toBe(false);
        expect(isKeepable('http://10.0.2.2:8099/resolve/a', 'http://10.0.2.2:8100/a.mp4')).toBe(true);
        expect(isKeepable('http://10.0.2.2:8099/resolve/a', 'http://10.0.2.2:8099/videos/a.mp4')).toBe(false);
    });

    it('a link without a redirect is played as it is, and its next load does not wait', async () => {
        const { net, urls } = setup();
        const pending = urls.resolve(FINAL);
        net.requests[0].answer(206);
        expect(await pending).toMatchObject({ url: FINAL, source: 'direct' });
        expect(await urls.resolve(FINAL)).toMatchObject({ url: FINAL, source: 'known' });
        expect(net.requests).toHaveLength(1);
    });

    it('an HTTP error or a network failure: the original link, nothing kept', async () => {
        const { net, urls } = setup();
        const refused = urls.resolve(RESOLVER);
        net.requests[0].answer(403, FINAL);
        expect(await refused).toMatchObject({ url: RESOLVER, source: 'failed' });
        expect(urls.peek(RESOLVER)).toBeNull();
        const offline = urls.resolve(RESOLVER);
        net.requests[1].fail();
        expect(await offline).toMatchObject({ url: RESOLVER, source: 'failed' });
        expect(urls.peek(RESOLVER)).toBeNull();
    });

    it('a resolver slower than the timeout: the original link at the timeout; the late answer is kept', async () => {
        const { clock, net, urls } = setup();
        const pending = urls.resolve(RESOLVER);
        clock.advance(RESOLVE_TIMEOUT_MS - 1);
        await flush();
        let settled = null;
        pending.then((result) => {
            settled = result;
        });
        await flush();
        expect(settled).toBeNull();
        clock.advance(1);
        await flush();
        expect(settled).toMatchObject({ url: RESOLVER, source: 'timeout', ms: RESOLVE_TIMEOUT_MS });
        net.requests[0].answer(206, FINAL);
        await flush();
        expect(urls.peek(RESOLVER)).toBe(FINAL);
    });

    it('a final URL is reused for REUSE_MS; forget() makes the next load ask again', async () => {
        const { clock, net, urls } = setup();
        urls.note(RESOLVER, FINAL);
        clock.advance(REUSE_MS);
        expect(urls.peek(RESOLVER)).toBe(FINAL);
        clock.advance(1);
        expect(urls.peek(RESOLVER)).toBeNull();
        urls.note(RESOLVER, FINAL);
        urls.forget(RESOLVER);
        urls.resolve(RESOLVER);
        expect(net.requests).toHaveLength(1);
    });

    it('note() ignores what is not an HTTP URL; resolve() skips links that are not HTTP', async () => {
        const { net, urls } = setup();
        urls.note(RESOLVER, 'blob:abc');
        urls.note(RESOLVER, null);
        expect(urls.peek(RESOLVER)).toBeNull();
        expect(await urls.resolve('magnet:?xt=urn:btih:abc')).toMatchObject({ url: 'magnet:?xt=urn:btih:abc', source: 'skipped' });
        expect(net.requests).toHaveLength(0);
    });

    it('without fetch() the link is played as it is', async () => {
        const urls = createFinalUrls({ fetch: null });
        const original = global.fetch;
        delete global.fetch;
        try {
            expect(await urls.resolve(RESOLVER)).toMatchObject({ url: RESOLVER, source: 'skipped' });
        } finally {
            if (original !== undefined) global.fetch = original;
        }
    });
});

describe('the header probe notes the redirect it followed (onFinalUrl)', () => {
    const answer = (url) => Promise.resolve({
        status: 206,
        url,
        redirected: url !== RESOLVER,
        headers: { get: (name) => (name === 'Content-Range' ? 'bytes 0-3/100' : null) },
        body: null,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer),
    });

    it('once, with the URL of the first answer', async () => {
        const seen = [];
        const fetchImpl = jest.fn(() => answer(FINAL));
        const readRange = createFetchReadRange(RESOLVER, { fetch: fetchImpl, onFinalUrl: (url) => seen.push(url) });
        await readRange(0, 4);
        await readRange(0, 4);
        expect(seen).toEqual([FINAL]);
        expect(fetchImpl.mock.calls[1][0]).toBe(FINAL);
    });

    it('the stream list\'s probe keeps it for the Player\'s load', async () => {
        const { probeStream } = require('../../stream-ranking');
        const urls = createFinalUrls({ fetch: () => new Promise(() => null) });
        const fetchImpl = () => answer(FINAL);
        await probeStream(RESOLVER, { url: RESOLVER }, fetchImpl, urls).catch(() => null);
        expect(urls.peek(RESOLVER)).toBe(FINAL);
    });

    it('the Player\'s probe reads the final URL the load also waits for', async () => {
        const { probeFinalUrl } = require('../../tracks/probe-cache');
        const net = controlledFetch();
        const urls = createFinalUrls({ fetch: net.fetchImpl });
        const read = jest.fn(() => answer(FINAL));
        const original = global.fetch;
        global.fetch = read;
        try {
            const probing = probeFinalUrl(RESOLVER, () => false, urls).catch(() => null);
            const load = urls.resolve(RESOLVER);
            expect(net.requests).toHaveLength(1);
            net.requests[0].answer(206, FINAL);
            await load;
            await probing;
            expect(read.mock.calls.length).toBeGreaterThan(0);
            expect(read.mock.calls.every((call) => call[0] === FINAL)).toBe(true);
        } finally {
            global.fetch = original;
        }
    });
});

describe('webos.player.finalUrl = off', () => {
    it('readFinalUrlSetting: on unless the key is "off"', () => {
        const storage = (value) => ({ getItem: (key) => (key === FINAL_URL_KEY ? value : null) });
        expect(readFinalUrlSetting(null)).toBe(true);
        expect(readFinalUrlSetting(storage('off'))).toBe(false);
    });

    it('the Player\'s probe goes back to the resolver\'s link (probeCancellable, no first-byte request)', async () => {
        const reads = [];
        const original = global.fetch;
        // The app reads window.localStorage when the module loads (this suite runs in Node: no window).
        global.window = { localStorage: { getItem: (key) => (key === FINAL_URL_KEY ? 'off' : null) } };
        global.fetch = jest.fn((url, init) => {
            reads.push([url, init.headers.Range]);
            return new Promise(() => null);
        });
        try {
            let probeCache = null;
            jest.isolateModules(() => {
                probeCache = require('../../tracks/probe-cache').probeCache;
            });
            probeCache.get(RESOLVER);
            await flush();
            expect(reads).toEqual([[RESOLVER, 'bytes=0-262143']]);
        } finally {
            global.fetch = original;
            delete global.window;
        }
    });
});
