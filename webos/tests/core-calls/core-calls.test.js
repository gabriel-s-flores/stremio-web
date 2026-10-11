// webos/lib/core-calls: getState requests that pile up for the same model share one answer (F7.2).
const { coalesceGetState } = require('../../lib/core-calls');

// A core worker that answers in order, when told to: state is a counter per model, dispatch bumps it.
const fakeTransport = () => {
    const queue = [];
    const state = {};
    const calls = [];
    const enqueue = (run) => new Promise((resolve, reject) => queue.push(() => {
        try {
            resolve(run());
        } catch (error) {
            reject(error);
        }
    }));
    return {
        calls,
        state,
        // Answers the next n requests, letting each answer's callbacks run before the next one, as
        // separate worker messages do.
        answer: async (n = queue.length) => {
            for (let i = 0; i < n && queue.length; i++) {
                queue.shift()();
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        },
        transport: {
            init: () => enqueue(() => calls.push(['init'])),
            getState: (model) => {
                calls.push(['getState', model]);
                return enqueue(() => {
                    if (model === 'broken') throw new Error('no such model');
                    return { model, version: state[model] || 0 };
                });
            },
            dispatch: (action, model) => {
                calls.push(['dispatch', model]);
                return enqueue(() => {
                    state[model] = (state[model] || 0) + 1;
                });
            },
            constant: 42,
        },
    };
};

describe('coalesceGetState', () => {
    test('requests for the same model before the answer share it; other models do not', async () => {
        const fake = fakeTransport();
        const transport = coalesceGetState(fake.transport);
        const a = transport.getState('ctx');
        const b = transport.getState('ctx');
        const c = transport.getState('board');
        expect(b).toBe(a);
        expect(fake.calls).toEqual([['getState', 'ctx'], ['getState', 'board']]);
        await fake.answer();
        expect(await a).toEqual({ model: 'ctx', version: 0 });
        expect(await c).toEqual({ model: 'board', version: 0 });
    });

    test('once answered, the next request goes to the worker', async () => {
        const fake = fakeTransport();
        const transport = coalesceGetState(fake.transport);
        const first = transport.getState('ctx');
        await fake.answer();
        await first;
        const second = transport.getState('ctx');
        expect(second).not.toBe(first);
        expect(fake.calls).toEqual([['getState', 'ctx'], ['getState', 'ctx']]);
    });

    test('a getState after a dispatch is not shared with one before it, so it sees the dispatch', async () => {
        const fake = fakeTransport();
        const transport = coalesceGetState(fake.transport);
        const before = transport.getState('ctx');
        transport.dispatch({ action: 'Ctx' }, 'ctx');
        const after = transport.getState('ctx');
        const again = transport.getState('ctx');
        expect(after).not.toBe(before);
        expect(again).toBe(after);
        await fake.answer();
        expect(await before).toEqual({ model: 'ctx', version: 0 });
        expect(await after).toEqual({ model: 'ctx', version: 1 });
    });

    test('every other call ends the sharing, and non-functions are copied as they are', async () => {
        const fake = fakeTransport();
        const transport = coalesceGetState(fake.transport);
        const before = transport.getState('ctx');
        transport.init({});
        expect(transport.getState('ctx')).not.toBe(before);
        expect(transport.constant).toBe(42);
        await fake.answer();
    });

    test('a failed request fails for every caller that shared it, and the next one is new', async () => {
        const fake = fakeTransport();
        const transport = coalesceGetState(fake.transport);
        const a = transport.getState('broken');
        const b = transport.getState('broken');
        expect(b).toBe(a);
        await fake.answer();
        await expect(a).rejects.toThrow('no such model');
        await expect(b).rejects.toThrow('no such model');
        expect(transport.getState('broken')).not.toBe(a);
        await fake.answer();
        await expect(transport.getState('ctx')).toBeDefined();
    });
});
