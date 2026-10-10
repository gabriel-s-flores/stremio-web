const { install } = require('../../polyfills/queue-microtask');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('queueMicrotask polyfill', () => {
    let target;

    beforeEach(() => {
        target = {};
        install(target);
    });

    test('installs only when missing', () => {
        const native = () => {};
        const existing = { queueMicrotask: native };
        install(existing);
        expect(existing.queueMicrotask).toBe(native);
        expect(typeof target.queueMicrotask).toBe('function');
    });

    test('runs the callback after the current code and before timers', async () => {
        const order = [];
        setTimeout(() => order.push('timer'), 0);
        target.queueMicrotask(() => order.push('microtask'));
        order.push('sync');
        await flush();
        expect(order).toEqual(['sync', 'microtask', 'timer']);
    });

    test('runs after promise reactions queued earlier', async () => {
        const order = [];
        Promise.resolve().then(() => order.push('promise'));
        target.queueMicrotask(() => order.push('microtask'));
        await flush();
        expect(order).toEqual(['promise', 'microtask']);
    });

    test('calls the callback without arguments', async () => {
        const callback = jest.fn();
        target.queueMicrotask(callback);
        await flush();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0]).toEqual([]);
    });

    test('throws a TypeError for a non-function', () => {
        expect(() => target.queueMicrotask()).toThrow(TypeError);
        expect(() => target.queueMicrotask('x')).toThrow(TypeError);
    });

    test('reports a throwing callback asynchronously, as an uncaught error', async () => {
        jest.useFakeTimers();
        try {
            const error = new Error('boom');
            expect(() => target.queueMicrotask(() => {
                throw error;
            })).not.toThrow();
            // Let the microtask and its rejection handler run; the rethrow then waits for a timer.
            for (let i = 0; i < 5; i++) {
                await Promise.resolve();
            }
            expect(() => jest.runOnlyPendingTimers()).toThrow(error);
        } finally {
            jest.useRealTimers();
        }
    });
});
