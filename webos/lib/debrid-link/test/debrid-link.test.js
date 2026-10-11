/* global describe, it, expect, jest */
// F6.3: the link check behind a Player error: what each HTTP answer and each failure means, the
// reuse of the list's probe, the request (one byte, redirect, request headers, body dropped) and
// that the stream URL (it holds the debrid key) never leaves the result.

const debridLink = require('..');

const SECRET = 'KEY-abc123';
const URL = `https://resolver.example/resolve/realdebrid/${SECRET}/hash/file.mkv`;
const stream = { url: URL };

const answer = (status, extra) => Promise.resolve(Object.assign({
    status,
    redirected: true,
    url: 'https://cdn.example/f/file.mkv',
    body: { cancel: jest.fn(() => Promise.resolve()) },
}, extra));

const diagnoser = (fetchImpl, queueEntry, extra) => debridLink.createDiagnoser(Object.assign({
    fetch: fetchImpl,
    getQueue: () => ({ get: () => queueEntry || null }),
    getFailure: () => null,
}, extra));

describe('kindOfStatus', () => {
    it('maps the answers of an expired, missing or limited link', () => {
        expect(debridLink.kindOfStatus(403)).toBe('expired');
        expect(debridLink.kindOfStatus(410)).toBe('expired');
        expect(debridLink.kindOfStatus(401)).toBe('unauthorized');
        expect(debridLink.kindOfStatus(404)).toBe('not-found');
        expect(debridLink.kindOfStatus(429)).toBe('rate-limited');
        expect(debridLink.kindOfStatus(503)).toBe('server-error');
        expect(debridLink.kindOfStatus(451)).toBe('refused');
        expect(debridLink.kindOfStatus(200)).toBeNull();
        expect(debridLink.kindOfStatus(206)).toBeNull();
        expect(debridLink.kindOfStatus(302)).toBeNull();
    });
});

describe('describe', () => {
    it('has a message and a hint for every kind, with the status in it', () => {
        Object.keys(debridLink.PROBLEMS).forEach((kind) => {
            const text = debridLink.describe({ kind, status: 403 });
            expect(text.key).toMatch(/^WEBOS_LINK_/);
            expect(text.hintKey).toMatch(/_HINT$/);
            expect(text.message).toBeTruthy();
            expect(text.message).not.toContain('{{');
            expect(text.hint).toBeTruthy();
        });
        expect(debridLink.describe({ kind: 'expired', status: 410 }).message).toContain('HTTP 410');
    });

    it('has nothing to say about a link that answers or an unknown cause', () => {
        expect(debridLink.describe({ kind: 'ok', status: 206 })).toBeNull();
        expect(debridLink.describe({ kind: 'unknown', status: null })).toBeNull();
        expect(debridLink.describe(null)).toBeNull();
    });
});

describe('diagnose', () => {
    it('asks for one byte, follows the redirect and drops the body', async () => {
        const fetchImpl = jest.fn(() => answer(403));
        const result = await diagnoser(fetchImpl).diagnose(stream, 83);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][0]).toBe(URL);
        expect(fetchImpl.mock.calls[0][1]).toEqual({ headers: { Range: 'bytes=0-0' }, credentials: 'omit' });
        expect(result).toMatchObject({ kind: 'expired', status: 403, source: 'request', redirected: true, host: 'cdn.example' });
    });

    it('sends the request headers the addon asks for', async () => {
        const fetchImpl = jest.fn(() => answer(206));
        const withHeaders = { url: URL, behaviorHints: { proxyHeaders: { request: { Authorization: 'x' } } } };
        await diagnoser(fetchImpl).diagnose(withHeaders, 83);
        expect(fetchImpl.mock.calls[0][1].headers).toEqual({ Authorization: 'x', Range: 'bytes=0-0' });
    });

    it('tells a link that answers (the Player message stands)', async () => {
        const result = await diagnoser(() => answer(206)).diagnose(stream, 83);
        expect(result).toMatchObject({ kind: 'ok', status: 206 });
        expect(debridLink.describe(result)).toBeNull();
    });

    it('drops the body even when the server ignores Range (200)', async () => {
        const cancel = jest.fn(() => Promise.resolve());
        const result = await diagnoser(() => answer(200, { body: { cancel } })).diagnose(stream, 81);
        expect(result.kind).toBe('ok');
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('classifies 404, 410, 429 and 5xx', async () => {
        const kinds = {};
        for (const status of [404, 410, 429, 502]) {
            kinds[status] = (await diagnoser(() => answer(status)).diagnose(stream, 83)).kind;
        }
        expect(kinds).toEqual({ 404: 'not-found', 410: 'expired', 429: 'rate-limited', 502: 'server-error' });
    });

    it('does not decode-check: a decode error is not a link problem and costs no request', async () => {
        const fetchImpl = jest.fn(() => answer(200));
        const result = await diagnoser(fetchImpl).diagnose(stream, 82);
        expect(result.kind).toBe('ok');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('reuses a recent HTTP failure of the stream list probe without a request', async () => {
        const fetchImpl = jest.fn(() => answer(200));
        const entry = { status: 'failed', error: 'HTTP', httpStatus: 404, finishedAt: 1000 };
        const result = await diagnoser(fetchImpl, entry, { now: () => 1000 + 60 * 1000 }).diagnose(stream, 83);
        expect(result).toMatchObject({ kind: 'not-found', status: 404, source: 'list-probe' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('reuses the HTTP failure of the Player\'s own probe, the most recent one first', async () => {
        const fetchImpl = jest.fn(() => answer(200));
        const entry = { status: 'failed', error: 'HTTP', httpStatus: 404, finishedAt: 1000 };
        const checker = diagnoser(fetchImpl, entry, { now: () => 5000, getFailure: () => ({ httpStatus: 403, at: 4000 }) });
        expect(await checker.diagnose(stream, 83)).toMatchObject({ kind: 'expired', status: 403, source: 'player-probe' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('does not trust an old probe failure, a network failure or a good probe', async () => {
        const fetchImpl = jest.fn(() => answer(206));
        const old = { status: 'failed', error: 'HTTP', httpStatus: 403, finishedAt: 0 };
        await diagnoser(fetchImpl, old, { now: () => debridLink.REUSE_MS + 1 }).diagnose(stream, 83);
        await diagnoser(fetchImpl, { status: 'failed', error: 'NETWORK', finishedAt: 5 }, { now: () => 6 }).diagnose(stream, 83);
        await diagnoser(fetchImpl, { status: 'done', result: {}, finishedAt: 5 }, { now: () => 6 }).diagnose(stream, 83);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('keeps the answer for the same link (no second request)', async () => {
        const fetchImpl = jest.fn(() => answer(403));
        const checker = diagnoser(fetchImpl);
        await checker.diagnose(stream, 83);
        const again = await checker.diagnose(stream, 83);
        expect(again.kind).toBe('expired');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('says network when the request fails and the host cannot be reached either', async () => {
        const fetchImpl = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
        const result = await diagnoser(fetchImpl).diagnose(stream, 83);
        expect(result).toMatchObject({ kind: 'network', source: 'request', host: 'resolver.example' });
        // The second request is a HEAD in no-cors mode: no preflight, no body.
        expect(fetchImpl.mock.calls[1]).toEqual([URL, { method: 'HEAD', mode: 'no-cors', credentials: 'omit' }]);
    });

    it('says network when the host does not answer the HEAD in time', async () => {
        jest.useFakeTimers();
        try {
            const fetchImpl = jest.fn()
                .mockReturnValueOnce(Promise.reject(new TypeError('Failed to fetch')))
                .mockReturnValueOnce(new Promise(() => null));
            const pending = diagnoser(fetchImpl, null, { timeout: 5000 }).diagnose(stream, 83);
            await Promise.resolve();
            await Promise.resolve();
            jest.advanceTimersByTime(5000);
            expect((await pending).kind).toBe('network');
        } finally {
            jest.useRealTimers();
        }
    });

    it('does not blame the network when the host answers but fetch() cannot read it (no CORS)', async () => {
        const fetchImpl = jest.fn()
            .mockReturnValueOnce(Promise.reject(new TypeError('Failed to fetch')))
            .mockReturnValueOnce(Promise.resolve({ type: 'opaque', status: 0 }));
        const result = await diagnoser(fetchImpl).diagnose(stream, 83);
        expect(result.kind).toBe('unknown');
        expect(debridLink.describe(result)).toBeNull();
    });

    it('says network at once when the TV is offline', async () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
        try {
            const fetchImpl = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
            expect((await diagnoser(fetchImpl).diagnose(stream, 83)).kind).toBe('network');
            expect(fetchImpl).toHaveBeenCalledTimes(1);
        } finally {
            if (original) Object.defineProperty(globalThis, 'navigator', original);
            else delete globalThis.navigator;
        }
    });

    it('says timeout when the server does not answer', async () => {
        jest.useFakeTimers();
        try {
            const pending = diagnoser(() => new Promise(() => null), null, { timeout: 5000 }).diagnose(stream, 83);
            jest.advanceTimersByTime(5000);
            expect((await pending).kind).toBe('timeout');
        } finally {
            jest.useRealTimers();
        }
    });

    it('has no answer for a stream without an HTTP URL', async () => {
        const fetchImpl = jest.fn();
        expect((await diagnoser(fetchImpl).diagnose({ ytId: 'abc' }, 83)).kind).toBe('unknown');
        expect((await diagnoser(fetchImpl).diagnose(null, 83)).kind).toBe('unknown');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('never puts the URL (with the key) in a result', async () => {
        const results = [
            await diagnoser(() => answer(403, { url: URL })).diagnose(stream, 83),
            await diagnoser(() => Promise.reject(new Error(URL))).diagnose(stream, 81),
            await diagnoser(() => null, { status: 'failed', httpStatus: 404, finishedAt: 1 }, { now: () => 2 }).diagnose({ url: URL + '2' }, 83),
        ];
        results.forEach((result) => expect(JSON.stringify(result)).not.toContain(SECRET));
    });
});

describe('the last loaded stream', () => {
    it('is what the Player loaded last', () => {
        debridLink.rememberStream(stream);
        expect(debridLink.lastLoadedStream()).toBe(stream);
        debridLink.rememberStream(undefined);
        expect(debridLink.lastLoadedStream()).toBeNull();
    });
});
