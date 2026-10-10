/* global describe, it, expect */
// Probe queue: cache by URL, concurrency limit, the focused stream first, cancel and failures.

const { createProbeQueue } = require('../queue');

// A probe function whose calls the test resolves by hand.
const manualProbe = () => {
    const calls = [];
    const probe = (url) => new Promise((resolve, reject) => {
        calls.push({ url, resolve, reject });
    });
    return { calls, probe };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createProbeQueue', () => {
    it('runs at most `concurrency` probes and starts the next one when one ends', async () => {
        const { calls, probe } = manualProbe();
        const queue = createProbeQueue({ probe, concurrency: 2 });
        ['a', 'b', 'c', 'd'].forEach((url) => queue.request(url, { url }));
        expect(calls.map((call) => call.url)).toEqual(['a', 'b']);
        expect(queue.stats()).toEqual({ queued: 2, running: 2, done: 0, failed: 0 });
        calls[0].resolve({ version: 1 });
        await flush();
        expect(calls.map((call) => call.url)).toEqual(['a', 'b', 'c']);
        expect(queue.resultOf('a')).toEqual({ version: 1 });
        expect(queue.get('c').status).toBe('running');
    });

    it('probes each URL once: later requests hit the cache, failures included', async () => {
        const { calls, probe } = manualProbe();
        const queue = createProbeQueue({ probe, concurrency: 1 });
        queue.request('a', {});
        queue.request('a', {}, true);
        calls[0].reject(Object.assign(new Error('nope'), { code: 'HTTP' }));
        await flush();
        queue.request('a', {}, true);
        expect(calls).toHaveLength(1);
        expect(queue.get('a')).toMatchObject({ status: 'failed', error: 'HTTP' });
        expect(queue.resultOf('a')).toBeNull();
    });

    it('puts the focused stream ahead of the queue', async () => {
        const { calls, probe } = manualProbe();
        const queue = createProbeQueue({ probe, concurrency: 1 });
        ['a', 'b', 'c'].forEach((url) => queue.request(url, {}));
        queue.request('d', {}, true);
        queue.request('c', {}, true);
        calls[0].resolve({});
        await flush();
        calls[1].resolve({});
        await flush();
        calls[2].resolve({});
        await flush();
        expect(calls.map((call) => call.url)).toEqual(['a', 'c', 'd', 'b']);
    });

    it('cancel drops queued requests only; they can be asked for again', async () => {
        const { calls, probe } = manualProbe();
        const queue = createProbeQueue({ probe, concurrency: 1 });
        ['a', 'b', 'c'].forEach((url) => queue.request(url, {}));
        queue.cancel(['a', 'b']);
        expect(queue.get('a').status).toBe('running');
        expect(queue.has('b')).toBe(false);
        calls[0].resolve({});
        await flush();
        expect(calls.map((call) => call.url)).toEqual(['a', 'c']);
        queue.request('b', {});
        calls[1].resolve({});
        await flush();
        expect(calls.map((call) => call.url)).toEqual(['a', 'c', 'b']);
    });

    it('tells the listeners which URL finished; a throwing probe counts as a failure', async () => {
        const seen = [];
        const queue = createProbeQueue({
            probe: (url) => {
                if (url === 'bad') throw new Error('sync');
                return Promise.resolve({ url });
            },
        });
        const unsubscribe = queue.subscribe((url) => seen.push(url));
        queue.request('ok', {});
        queue.request('bad', {});
        await flush();
        expect(seen.sort()).toEqual(['bad', 'ok']);
        expect(queue.get('bad')).toMatchObject({ status: 'failed', error: 'sync' });
        unsubscribe();
        queue.request('other', {});
        await flush();
        expect(seen).toHaveLength(2);
    });

    it('keeps at most `maxEntries` finished entries, dropping the oldest', async () => {
        const queue = createProbeQueue({ probe: (url) => Promise.resolve({ url }), concurrency: 4, maxEntries: 2 });
        ['a', 'b', 'c'].forEach((url) => queue.request(url, {}));
        await flush();
        expect(queue.has('a')).toBe(false);
        expect(queue.resultOf('b')).toEqual({ url: 'b' });
        expect(queue.resultOf('c')).toEqual({ url: 'c' });
    });
});
