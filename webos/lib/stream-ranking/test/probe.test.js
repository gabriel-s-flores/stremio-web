/* global describe, it, expect */
// The list's probe (index.js probeStream): the header probe over a fetch() whose transfers can be
// stopped (Chromium 53 has no AbortController), with the list's budget.

const fs = require('fs');
const path = require('path');
const { probeStream, createCancellableFetch, LIST_PROBE_OPTIONS } = require('../index');

const HEADERS = path.join(__dirname, '..', '..', '..', 'tests', 'media', 'headers');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// fetch() over a byte array with Range (206). `hang`: the body never ends until cancelled.
const fakeFetch = (bytes, options) => {
    const settings = options || {};
    const log = { requests: [], cancels: 0, inits: [] };
    const fetchImpl = (url, init) => {
        log.inits.push(init);
        const range = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
        const start = Number(range[1]);
        const end = Math.min(Number(range[2]), bytes.length - 1);
        log.requests.push([start, end]);
        let sent = false;
        let finish = null;
        const reader = {
            read: () => {
                if (settings.hang) return new Promise((resolve) => { finish = resolve; });
                if (sent) return Promise.resolve({ done: true });
                sent = true;
                return Promise.resolve({ done: false, value: bytes.subarray(start, end + 1) });
            },
            cancel: () => {
                log.cancels += 1;
                if (finish) finish({ done: true });
                return Promise.resolve();
            },
        };
        const headers = { 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': String(end - start + 1) };
        return Promise.resolve({
            status: settings.status || 206,
            url,
            redirected: false,
            headers: { get: (name) => headers[name.toLowerCase()] || null },
            body: { getReader: () => reader, cancel: () => reader.cancel() },
            arrayBuffer: () => Promise.resolve(bytes.buffer),
        });
    };
    return { fetchImpl, log };
};

const header = (name) => new Uint8Array(fs.readFileSync(path.join(HEADERS, name)));

describe('probeStream', () => {
    it('probes through the cancellable fetch with the list budget and the addon headers', async () => {
        const { fetchImpl, log } = fakeFetch(header('dts-hd-ma.mkv'));
        const stream = { url: 'https://debrid.example/a.mkv', behaviorHints: { proxyHeaders: { request: { 'X-Token': 't' } } } };
        const result = await probeStream(stream.url, stream, fetchImpl);
        expect(result.summary.audioCodecs).toEqual(['dts']);
        expect(log.inits.every((init) => init.headers['X-Token'] === 't' && init.credentials === 'omit')).toBe(true);
        expect(log.requests.every(([start, end]) => end - start + 1 <= 256 * 1024)).toBe(true);
        expect(LIST_PROBE_OPTIONS).toEqual({ maxBytes: 2 * 1024 * 1024, maxRequests: 8, timeout: 10000, maxSkipBytes: 0 });
    });

    it('a server that ignores Range is only read at offset 0 (maxSkipBytes 0)', async () => {
        // A small file read whole from offset 0 still works with 200 answers…
        const { fetchImpl } = fakeFetch(header('dts-hd-ma.mkv'), { status: 200 });
        const bytes = new Uint8Array(4 * 1024 * 1024);
        bytes.set(header('dts-hd-ma.mkv'));
        const big = fakeFetch(bytes, { status: 200 });
        await expect(probeStream('https://x/a.mkv', {}, fetchImpl)).resolves.toBeTruthy();
        // …but a read further in is refused instead of downloading the bytes before it.
        const { createFetchReadRange } = require('../../header-probe');
        const readRange = createFetchReadRange('https://x/b.mkv', Object.assign({}, LIST_PROBE_OPTIONS, { fetch: big.fetchImpl }));
        await expect(readRange(300 * 1024, 1024)).rejects.toMatchObject({ code: 'RANGE_NOT_SUPPORTED' });
    });

    it('cancel() closes the open transfer and the probe fails at once', async () => {
        const { fetchImpl, log } = fakeFetch(header('dts-hd-ma.mkv'), { hang: true });
        const promise = probeStream('https://debrid.example/a.mkv', {}, fetchImpl);
        let settled = null;
        promise.then(() => { settled = 'resolved'; }, (error) => { settled = error; });
        await flush();
        expect(settled).toBeNull();
        expect(log.requests).toHaveLength(1);
        promise.cancel();
        await flush();
        expect(log.cancels).toBe(1);
        expect(settled).toBeInstanceOf(Error);
        expect(log.requests).toHaveLength(1);
    });
});

describe('createCancellableFetch', () => {
    it('refuses new requests and pending reads after cancel()', async () => {
        const { fetchImpl, log } = fakeFetch(new Uint8Array(10), { hang: true });
        const transfer = createCancellableFetch(fetchImpl);
        const response = await transfer.fetch('https://x/a', { headers: { Range: 'bytes=0-9' } });
        const read = response.body.getReader().read();
        transfer.cancel();
        await expect(read).rejects.toThrow('probe cancelled');
        await expect(transfer.fetch('https://x/a', { headers: { Range: 'bytes=0-9' } })).rejects.toThrow('probe cancelled');
        expect(log.cancels).toBe(1);
    });

    it('passes responses through until then', async () => {
        const { fetchImpl } = fakeFetch(new Uint8Array([1, 2, 3]));
        const transfer = createCancellableFetch(fetchImpl);
        const response = await transfer.fetch('https://x/a', { headers: { Range: 'bytes=0-2' } });
        expect(response.status).toBe(206);
        expect(response.headers.get('Content-Range')).toBe('bytes 0-2/3');
        const step = await response.body.getReader().read();
        expect(Array.from(step.value)).toEqual([1, 2, 3]);
    });
});
