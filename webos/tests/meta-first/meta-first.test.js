// webos/lib/meta-first: the meta of a title reaches the core before its streams (F8.7).
import { install } from '../../lib/meta-first';

// The pending promise callbacks (the fake timers also fake setImmediate).
const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

// A worker scope with a fetch whose answers the test resolves by hand, and fake timers.
const setup = (options) => {
    jest.useFakeTimers();
    const pending = new Map();
    const listeners = [];
    const scope = {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id),
        addEventListener: (name, fn) => { if (name === 'message') listeners.push(fn); },
        fetch: (input) => new Promise((resolve, reject) => pending.set(typeof input === 'string' ? input : input.url, { resolve, reject })),
    };
    install(scope, options);
    const response = (body, status = 200) => ({ status, text: () => Promise.resolve(body) });
    const answer = (url, body, status) => pending.get(url).resolve(response(body, status));
    const fail = (url) => pending.get(url).reject(new TypeError('Failed to fetch'));
    const pageGetState = (model) => listeners.forEach((fn) => fn({ data: { request: { id: 'x', path: ['getState'], args: [model] } } }));
    // What the core does with an answer: reads its text, in order.
    const order = [];
    const core = (url) => scope.fetch(url).then((r) => (r.text ? r.text() : null)).then(() => order.push(url), () => order.push(`${url} failed`));
    return { scope, answer, fail, pageGetState, order, core };
};

afterEach(() => jest.useRealTimers());

const META = 'https://v3-cinemeta.strem.io/meta/movie/tt1.json';
const STREAMS = 'http://addon.example/stream/movie/tt1.json';

test('streams that arrive first wait until the core read the meta and the page took its state', async () => {
    const t = setup();
    t.core(META);
    t.core(STREAMS);
    t.answer(STREAMS, '{"streams":[]}');
    await flush();
    jest.advanceTimersByTime(1000);
    await flush();
    expect(t.order).toEqual([]);
    t.answer(META, '{"meta":{}}');
    await flush();
    jest.advanceTimersByTime(0);
    await flush();
    expect(t.order).toEqual([META]);
    t.pageGetState('ctx');
    jest.advanceTimersByTime(0);
    await flush();
    expect(t.order).toEqual([META]);
    t.pageGetState('meta_details');
    jest.advanceTimersByTime(0);
    await flush();
    expect(t.order).toEqual([META, STREAMS]);
});

test('without the page asking, afterMetaMs after the meta; never more than maxHoldMs', async () => {
    const t = setup({ afterMetaMs: 400, maxHoldMs: 1500 });
    t.core(META);
    t.core(STREAMS);
    t.answer(STREAMS, '{}');
    t.answer(META, '{}');
    await flush();
    jest.advanceTimersByTime(399);
    await flush();
    expect(t.order).toEqual([META]);
    jest.advanceTimersByTime(1);
    await flush();
    expect(t.order).toEqual([META, STREAMS]);

    const slow = setup({ maxHoldMs: 1500 });
    slow.core(META);
    slow.core(STREAMS);
    slow.answer(STREAMS, '{}');
    await flush();
    jest.advanceTimersByTime(1499);
    await flush();
    expect(slow.order).toEqual([]);
    jest.advanceTimersByTime(1);
    await flush();
    expect(slow.order).toEqual([STREAMS]);
});

test('a meta that fails or answers another status lets the streams go at once', async () => {
    const failed = setup();
    failed.core(META);
    failed.core(STREAMS);
    failed.answer(STREAMS, '{}');
    failed.fail(META);
    await flush();
    await flush();
    expect(failed.order).toEqual([`${META} failed`, STREAMS]);

    const missing = setup();
    missing.core(META);
    missing.core(STREAMS);
    missing.answer(META, 'not found', 404);
    await flush();
    missing.answer(STREAMS, '{}');
    await flush();
    await flush();
    expect(missing.order).toEqual([META, STREAMS]);
});

test('streams that come after the meta, of another title or type, and other requests are not held', async () => {
    const t = setup();
    t.core(META);
    t.answer(META, '{}');
    await flush();
    jest.advanceTimersByTime(0);
    t.pageGetState('meta_details');
    jest.advanceTimersByTime(0);
    await flush();
    t.core(STREAMS);
    t.answer(STREAMS, '{}');
    await flush();
    expect(t.order).toEqual([META, STREAMS]);

    const other = setup();
    other.core(META);
    const otherTitle = 'http://addon.example/stream/movie/tt12.json';
    const otherType = 'http://addon.example/stream/series/tt1.json';
    const catalog = 'https://v3-cinemeta.strem.io/catalog/movie/top.json';
    [otherTitle, otherType, catalog].forEach((url) => other.core(url));
    [otherTitle, otherType, catalog].forEach((url) => other.answer(url, '{}'));
    await flush();
    await flush();
    expect(other.order).toEqual([otherTitle, otherType, catalog]);
});

test('the episodes of a series wait for the series meta (video id "<id>:<season>:<episode>")', async () => {
    const t = setup();
    const meta = 'https://v3-cinemeta.strem.io/meta/series/tt9.json';
    const episode = 'http://addon.example/stream/series/tt9%3A1%3A2.json';
    t.core(meta);
    t.core(episode);
    t.answer(episode, '{}');
    await flush();
    expect(t.order).toEqual([]);
    t.answer(meta, '{}');
    await flush();
    jest.advanceTimersByTime(0);
    t.pageGetState('meta_details');
    jest.advanceTimersByTime(0);
    await flush();
    expect(t.order).toEqual([meta, episode]);
});

test('a new meta of the same title (Details opened again) lets the old waiters go; installing twice wraps once', async () => {
    const t = setup();
    t.core(META);
    t.core(STREAMS);
    t.answer(STREAMS, '{}');
    await flush();
    t.core(META);
    await flush();
    expect(t.order).toEqual([STREAMS]);
    const fetch = t.scope.fetch;
    install(t.scope);
    expect(t.scope.fetch).toBe(fetch);
    expect(() => install({})).not.toThrow();
});
