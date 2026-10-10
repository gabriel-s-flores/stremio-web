/* global describe, it, expect, jest */
const { createSource, ProbeError } = require('../source');
const { createFetchReadRange } = require('../fetch-reader');
const { bufferReadRange } = require('./replay');

const bytes = (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = i & 0xff;
    return out;
};

describe('createSource', () => {
    it('reads whole blocks once and serves later reads from the cache', async () => {
        const readRange = jest.fn(bufferReadRange(bytes(10000)));
        const source = createSource(readRange, { blockSize: 4096 });
        expect(Array.from(await source.read(10, 4))).toEqual([10, 11, 12, 13]);
        expect(Array.from(await source.read(100, 2))).toEqual([100, 101]);
        expect(readRange).toHaveBeenCalledTimes(1);
        expect(readRange).toHaveBeenCalledWith(10, 4096);
        expect(source.size()).toBe(10000);
    });

    it('joins a cached head with a new tail', async () => {
        const source = createSource(bufferReadRange(bytes(10000)), { blockSize: 1024 });
        await source.read(0, 1);
        const data = await source.read(1020, 8);
        expect(Array.from(data)).toEqual([252, 253, 254, 255, 0, 1, 2, 3]);
        expect(source.stats.requests).toBe(2);
    });

    it('returns short data at the end of the file and rejects readExact', async () => {
        const source = createSource(bufferReadRange(bytes(100)), { blockSize: 64 });
        expect((await source.read(90, 50)).length).toBe(10);
        await expect(source.readExact(90, 50)).rejects.toMatchObject({ code: 'TRUNCATED' });
    });

    it('enforces maxRequests and maxBytes', async () => {
        const limited = createSource(bufferReadRange(bytes(100000)), { blockSize: 1024, maxRequests: 2 });
        await limited.read(0, 1);
        await limited.read(5000, 1);
        await expect(limited.read(9000, 1)).rejects.toBeInstanceOf(ProbeError);
        const small = createSource(bufferReadRange(bytes(100000)), { blockSize: 1024, maxBytes: 1500 });
        await small.read(0, 1);
        await expect(small.read(5000, 1000)).rejects.toMatchObject({ code: 'LIMIT' });
    });
});

describe('createFetchReadRange', () => {
    const file = bytes(5000);
    const headers = (values) => ({ get: (name) => values[name.toLowerCase()] || null });
    const stream = (data) => {
        let sent = false;
        return { getReader: () => ({
            read: () => Promise.resolve(sent ? { done: true } : (sent = true, { done: false, value: data })),
            cancel: jest.fn(() => Promise.resolve()),
        }) };
    };
    // Fake server: honours Range unless `ignoreRange`, redirects /redirect once.
    const fakeFetch = (ignoreRange) => jest.fn((url, init) => {
        const match = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), file.length - 1);
        const finalUrl = url.replace('/redirect', '');
        if (ignoreRange) {
            return Promise.resolve({ status: 200, url: finalUrl, redirected: url !== finalUrl, headers: headers({ 'content-length': String(file.length) }), body: stream(file) });
        }
        if (start >= file.length) {
            return Promise.resolve({ status: 416, url: finalUrl, headers: headers({ 'content-range': 'bytes */' + file.length }) });
        }
        return Promise.resolve({
            status: 206,
            url: finalUrl,
            redirected: url !== finalUrl,
            headers: headers({ 'content-range': 'bytes ' + start + '-' + end + '/' + file.length }),
            body: stream(file.subarray(start, end + 1)),
        });
    });

    it('sends a Range header, reads the size and reuses the redirected URL', async () => {
        const fetchMock = fakeFetch(false);
        const readRange = createFetchReadRange('http://host/redirect/a.mkv', { fetch: fetchMock });
        const first = await readRange(10, 20);
        expect(first.size).toBe(5000);
        expect(Array.from(first.data.subarray(0, 3))).toEqual([10, 11, 12]);
        await readRange(100, 10);
        expect(fetchMock.mock.calls[0][1].headers.Range).toBe('bytes=10-29');
        expect(fetchMock.mock.calls[1][0]).toBe('http://host/a.mkv');
    });

    it('treats 416 as end of file', async () => {
        const readRange = createFetchReadRange('http://host/a.mkv', { fetch: fakeFetch(false) });
        expect((await readRange(6000, 10)).data.length).toBe(0);
    });

    it('copes with a server that ignores Range near the start of the file', async () => {
        const readRange = createFetchReadRange('http://host/a.mkv', { fetch: fakeFetch(true), maxSkipBytes: 1000 });
        const result = await readRange(500, 4);
        expect(Array.from(result.data)).toEqual([500 & 0xff, 501 & 0xff, 502 & 0xff, 503 & 0xff]);
        await expect(readRange(2000, 4)).rejects.toMatchObject({ code: 'RANGE_NOT_SUPPORTED' });
    });

    it('rejects partial responses that do not start at the requested offset', async () => {
        const partial = (values, data) => () => Promise.resolve({ status: 206, url: 'http://host/a.mkv', headers: headers(values), body: stream(data) });
        const late = createFetchReadRange('http://host/a.mkv', { fetch: partial({ 'content-range': 'bytes 200-299/5000' }, file.subarray(200, 300)) });
        await expect(late(100, 100)).rejects.toMatchObject({ code: 'HTTP' });
        // Content-Range hidden (CORS): a body larger than the requested range cannot be trusted…
        const hiddenLarge = createFetchReadRange('http://host/a.mkv', { fetch: partial({ 'content-length': '5000' }, file) });
        await expect(hiddenLarge(100, 100)).rejects.toMatchObject({ code: 'HTTP' });
        // …but one no larger than the range is the range.
        const hiddenExact = createFetchReadRange('http://host/a.mkv', { fetch: partial({ 'content-length': '100' }, file.subarray(100, 200)) });
        expect(Array.from((await hiddenExact(100, 100)).data.subarray(0, 2))).toEqual([100, 101]);
    });

    it('maps HTTP errors and network failures to ProbeError', async () => {
        const notFound = createFetchReadRange('http://host/a.mkv', { fetch: () => Promise.resolve({ status: 404, headers: headers({}) }) });
        await expect(notFound(0, 10)).rejects.toMatchObject({ code: 'HTTP' });
        const offline = createFetchReadRange('http://host/a.mkv', { fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
        await expect(offline(0, 10)).rejects.toMatchObject({ code: 'NETWORK' });
    });
});
