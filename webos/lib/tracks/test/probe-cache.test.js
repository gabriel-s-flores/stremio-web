/* global describe, it, expect, jest */

const { createProbeCache } = require('../probe-cache');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('probe cache', () => {
    it('probes a URL once and shares the result; peek is sync and null until it resolves', async () => {
        const probe = jest.fn((url) => Promise.resolve({ url }));
        const cache = createProbeCache({ probe });
        const a = cache.get('u1');
        const b = cache.get('u1');
        expect(cache.peek('u1')).toBeNull();
        expect(await a).toEqual({ url: 'u1' });
        expect(await b).toBe(await a);
        expect(cache.peek('u1')).toEqual({ url: 'u1' });
        expect(probe).toHaveBeenCalledTimes(1);
        expect(cache.peek('other')).toBeNull();
    });

    it('does not start the probe synchronously (the load goes first)', () => {
        const probe = jest.fn(() => Promise.resolve({}));
        createProbeCache({ probe }).get('u1');
        expect(probe).not.toHaveBeenCalled();
    });

    it('a failure is not kept: the next get tries again', async () => {
        const probe = jest.fn()
            .mockReturnValueOnce(Promise.reject(new Error('TIMEOUT')))
            .mockReturnValueOnce(Promise.resolve({ ok: true }));
        const cache = createProbeCache({ probe });
        await expect(cache.get('u1')).rejects.toThrow('TIMEOUT');
        expect(cache.peek('u1')).toBeNull();
        expect(await cache.get('u1')).toEqual({ ok: true });
        expect(probe).toHaveBeenCalledTimes(2);
    });

    it('keeps the most recently used entries', async () => {
        const probe = jest.fn((url) => Promise.resolve(url));
        const cache = createProbeCache({ probe, maxEntries: 2 });
        cache.get('a');
        cache.get('b');
        await flush();
        cache.get('a');
        cache.get('c');
        await flush();
        expect(cache.peek('a')).toBe('a');
        expect(cache.peek('b')).toBeNull();
        expect(cache.peek('c')).toBe('c');
    });
});
