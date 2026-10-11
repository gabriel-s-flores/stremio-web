/* global describe, it, expect, jest */

const { createProbeCache, probeCancellable } = require('../probe-cache');
const fs = require('fs');
const path = require('path');
const { bufferReadRange } = require('../../header-probe/test/replay');

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

    it('keeps only the HTTP status of a refused request (failureOf, F6.3), until a probe succeeds', async () => {
        const refused = Object.assign(new Error('HTTP 403'), { httpStatus: 403 });
        const probe = jest.fn()
            .mockReturnValueOnce(Promise.reject(refused))
            .mockReturnValueOnce(Promise.reject(new Error('NETWORK')))
            .mockReturnValueOnce(Promise.resolve({ ok: true }));
        const cache = createProbeCache({ probe });
        expect(cache.failureOf('u1')).toBeNull();
        await expect(cache.get('u1')).rejects.toThrow('HTTP 403');
        expect(cache.failureOf('u1')).toMatchObject({ httpStatus: 403 });
        expect(cache.peek('u1')).toBeNull();
        await expect(cache.get('u2')).rejects.toThrow('NETWORK');
        expect(cache.failureOf('u2')).toBeNull();
        await cache.get('u1');
        expect(cache.failureOf('u1')).toBeNull();
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

    it('cancel: a probe still running is told to stop, rejects and is not kept; a finished one stays', async () => {
        let isCancelled = null;
        let finish = null;
        const probe = jest.fn((url, cancelled) => {
            isCancelled = cancelled;
            return new Promise((resolve, reject) => {
                finish = () => (cancelled() ? reject(new Error('cancelled')) : resolve({ url }));
            });
        });
        const cache = createProbeCache({ probe });
        const running = cache.get('u1');
        await flush();
        expect(isCancelled()).toBe(false);
        cache.cancel('u1');
        expect(isCancelled()).toBe(true);
        finish();
        await expect(running).rejects.toThrow('cancelled');
        expect(cache.peek('u1')).toBeNull();

        const done = cache.get('u2');
        await flush();
        finish();
        await done;
        cache.cancel('u2');
        expect(cache.peek('u2')).toEqual({ url: 'u2' });
        cache.cancel('unknown');
    });
});

describe('probeCancellable', () => {
    // A real header from the F0.10 catalogue (AC-3, DD+ Atmos, DTS-HD MA, TrueHD Atmos, PGS).
    const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tests', 'media', 'headers', 'mkv-multitrack-ac3-eac3joc-dtshdma-truehd-pgs.mkv')));
    const counting = () => {
        const calls = [];
        const readRange = bufferReadRange(bytes);
        return { calls, create: () => (offset, length) => {
            calls.push([offset, length]);
            return readRange(offset, length);
        } };
    };

    it('probes normally while not cancelled', async () => {
        const reads = counting();
        const result = await probeCancellable('http://x/a.mkv', () => false, reads.create);
        expect(result.summary.audioTracks).toBe(4);
        expect(reads.calls.length).toBeGreaterThan(0);
    });

    it('once cancelled, refuses the reads not yet made (ProbeError, no request)', async () => {
        const reads = counting();
        await expect(probeCancellable('http://x/a.mkv', () => true, reads.create)).rejects.toMatchObject({ code: 'NETWORK', message: 'cancelled' });
        expect(reads.calls).toEqual([]);
    });
});
