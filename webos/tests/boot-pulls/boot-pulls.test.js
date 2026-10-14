// webos/lib/boot-pulls: the Ctx pulls of App.js on the TV (F8.7).
const { wrap, STORAGE_KEY, MAX_DEFER_MS, MAX_DELAY_MS, WARM_UP_FALLBACK_MS } = require('../../lib/boot-pulls');

const IDLE = 20000;
const INTERVAL = 6 * 3600 * 1000;

const READY_BOARD = { catalogs: [{ content: { type: 'Loading' } }, { content: { type: 'Ready', content: [] } }] };

const setup = ({ pulledAt = null, hash = '#/', auth = null, start = 1e12, board = { model: 'board' } } = {}) => {
    let clock = start;
    const timers = [];
    const delays = [];
    const listeners = {};
    const store = {};
    if (pulledAt !== null) store[STORAGE_KEY] = String(pulledAt);
    const win = {
        location: { hash },
        addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    };
    const storage = {
        getItem: (key) => (key in store ? store[key] : null),
        setItem: (key, value) => { store[key] = String(value); },
    };
    const sent = [];
    const ctx = { profile: { auth } };
    const inner = {
        getState: jest.fn((model) => Promise.resolve(model === 'ctx' ? ctx : model === 'board' ? board : { model })),
        dispatch: jest.fn((action, field) => { sent.push([action, field]); return Promise.resolve('sent'); }),
        analytics: jest.fn(),
    };
    const transport = wrap(inner, {
        window: win,
        storage,
        now: () => clock,
        idleMs: IDLE,
        intervalMs: INTERVAL,
        setTimeout: (fn, ms) => { delays.push(ms); const t = { fn, at: clock + ms, done: false }; timers.push(t); return t; },
        clearTimeout: (t) => { if (t) t.done = true; },
    });
    // Advances the fake clock, running the timers that come due in order (a timer set again and again for the
    // same time fails the test instead of hanging it).
    const advance = (ms) => {
        const end = clock + ms;
        for (let runs = 0; ; runs++) {
            if (runs > 10000) throw new Error('timer loop');
            const next = timers.filter((t) => !t.done && t.at <= end).sort((a, b) => a.at - b.at)[0];
            if (!next) break;
            clock = Math.max(clock, next.at);
            next.done = true;
            next.fn();
        }
        clock = end;
    };
    const fireEvent = (name) => (listeners[name] || []).forEach((fn) => fn());
    return { transport, inner, sent, store, win, advance, fireEvent, ctx, delays, setClock: (value) => { clock = value; } };
};

// The pulled time is written once the dispatch resolved.
const flush = () => new Promise((resolve) => setImmediate(resolve));

const ctx = (action) => ({ action: 'Ctx', args: { action } });
const pulls = (sent) => sent.filter(([a]) => a.args && a.args.action === 'PullNotifications').length;

describe('API pulls', () => {
    test('user and library pulls dropped for a guest once the ctx is known; other actions go as they came', async () => {
        const { transport, sent } = setup({ auth: null });
        await transport.getState('ctx');
        await expect(transport.dispatch({ action: 'Ctx', args: { action: 'PullUserFromAPI', args: {} } })).resolves.toBeUndefined();
        transport.dispatch(ctx('SyncLibraryWithAPI'));
        expect(sent).toEqual([]);
        await expect(transport.dispatch(ctx('InstallAddon'), null)).resolves.toBe('sent');
        transport.dispatch({ action: 'Load', args: { model: 'MetaDetails' } }, 'meta_details');
        expect(sent.map(([a, f]) => [a.args.action || a.args.model, f])).toEqual([['InstallAddon', null], ['MetaDetails', 'meta_details']]);
    });

    test('with a session, or before any ctx, they go as they came', async () => {
        const unknown = setup({ auth: null });
        unknown.transport.dispatch(ctx('PullAddonsFromAPI'));
        unknown.transport.dispatch(ctx('PullUserFromAPI'));
        unknown.transport.dispatch(ctx('SyncLibraryWithAPI'));
        expect(unknown.sent.map(([a]) => a.args.action)).toEqual(['PullAddonsFromAPI', 'PullUserFromAPI', 'SyncLibraryWithAPI']);
        const signedIn = setup({ auth: { key: 'k', user: {} } });
        await signedIn.transport.getState('ctx');
        signedIn.transport.dispatch(ctx('PullAddonsFromAPI'));
        signedIn.transport.dispatch(ctx('SyncLibraryWithAPI'));
        signedIn.transport.dispatch(ctx('PullNotifications'));
        expect(signedIn.sent.map(([a]) => a.args.action)).toEqual(['PullAddonsFromAPI', 'SyncLibraryWithAPI', 'PullNotifications']);
    });

    test('a guest\'s PullAddonsFromAPI (official addons upgrade) goes once per launch, when idle', async () => {
        const { transport, sent, advance, fireEvent } = setup({ auth: null });
        await transport.getState('ctx');
        const addons = () => sent.filter(([a]) => a.args.action === 'PullAddonsFromAPI').length;
        transport.dispatch(ctx('PullAddonsFromAPI'));
        expect(addons()).toBe(0);
        advance(10000);
        fireEvent('keydown');
        advance(IDLE - 1);
        expect(addons()).toBe(0);
        advance(1);
        expect(addons()).toBe(1);
        // Every focus of the window asks again: not in this launch.
        transport.dispatch(ctx('PullAddonsFromAPI'));
        advance(10 * IDLE);
        expect(addons()).toBe(1);
    });

    test('a login later in the session lets them through again', async () => {
        const { transport, sent, ctx: state } = setup({ auth: null });
        await transport.getState('ctx');
        transport.dispatch(ctx('PullUserFromAPI'));
        state.profile.auth = { key: 'k' };
        await transport.getState('ctx');
        transport.dispatch(ctx('PullUserFromAPI'));
        expect(sent).toHaveLength(1);
    });

    test('getState of other models is the inner one, untouched', async () => {
        const { transport, inner } = setup({ board: READY_BOARD });
        await expect(transport.getState('board')).resolves.toBe(READY_BOARD);
        await expect(transport.getState('library')).resolves.toEqual({ model: 'library' });
        expect(inner.getState).toHaveBeenCalledWith('board');
        expect(transport.analytics).toBe(inner.analytics);
    });
});

describe('PullNotifications', () => {
    test('never right away: after the app is idle for 20 s, once, and the time is kept', async () => {
        const { transport, sent, store, advance } = setup();
        transport.dispatch(ctx('PullNotifications'));
        expect(pulls(sent)).toBe(0);
        advance(IDLE - 1);
        expect(pulls(sent)).toBe(0);
        advance(1);
        expect(pulls(sent)).toBe(1);
        await flush();
        expect(Number(store[STORAGE_KEY])).toBe(1e12 + IDLE);
        advance(10 * IDLE);
        expect(pulls(sent)).toBe(1);
    });

    test('activity pushes it back: keys, pointer and route changes', () => {
        const { transport, sent, advance, fireEvent } = setup();
        transport.dispatch(ctx('PullNotifications'));
        advance(15000);
        fireEvent('keydown');
        advance(15000);
        fireEvent('hashchange');
        advance(15000);
        fireEvent('mousemove');
        advance(IDLE - 1);
        expect(pulls(sent)).toBe(0);
        advance(1);
        expect(pulls(sent)).toBe(1);
    });

    test('not while a video plays: it waits for the next idle stretch out of the Player', () => {
        const { transport, sent, advance, win } = setup({ hash: '#/player/abc' });
        transport.dispatch(ctx('PullNotifications'));
        advance(5 * IDLE);
        expect(pulls(sent)).toBe(0);
        win.location.hash = '#/';
        advance(2 * IDLE);
        expect(pulls(sent)).toBe(1);
    });

    test('the focus of the window asks again and again: one pull', () => {
        const { transport, sent, advance } = setup();
        for (let i = 0; i < 5; i++) {
            transport.dispatch(ctx('PullNotifications'));
            advance(3000);
        }
        advance(IDLE);
        expect(pulls(sent)).toBe(1);
    });

    test('at most once per 6 h, across launches (the time is in localStorage)', async () => {
        const start = 1e12;
        const recent = setup({ pulledAt: start - 3600 * 1000, start });
        recent.transport.dispatch(ctx('PullNotifications'));
        recent.advance(INTERVAL - 3600 * 1000 - 1);
        expect(pulls(recent.sent)).toBe(0);
        recent.advance(1);
        expect(pulls(recent.sent)).toBe(1);
        await flush();
        // Asked again in the same session: 6 h after this one.
        recent.transport.dispatch(ctx('PullNotifications'));
        recent.advance(INTERVAL - 1);
        expect(pulls(recent.sent)).toBe(1);
        recent.advance(1);
        expect(pulls(recent.sent)).toBe(2);
        const old = setup({ pulledAt: start - INTERVAL - 1, start });
        old.transport.dispatch(ctx('PullNotifications'));
        old.advance(IDLE);
        expect(pulls(old.sent)).toBe(1);
    });

    test('an unreadable or broken storage only means a pull per launch', async () => {
        const { transport, sent, advance, store } = setup({ pulledAt: 'garbage' });
        transport.dispatch(ctx('PullNotifications'));
        advance(IDLE);
        expect(pulls(sent)).toBe(1);
        await flush();
        expect(store[STORAGE_KEY]).not.toBe('garbage');
        const throwing = wrap({ getState: () => null, dispatch: jest.fn(() => Promise.resolve()) }, {
            window: { location: { hash: '#/' } },
            storage: { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } },
            idleMs: 0,
            setTimeout: (fn) => fn(),
        });
        expect(() => throwing.dispatch(ctx('PullNotifications'))).not.toThrow();
    });

    test('a user who is never idle for 20 s still gets it, 10 min after it was asked', () => {
        const { transport, sent, advance, fireEvent } = setup();
        transport.dispatch(ctx('PullNotifications'));
        for (let t = 0; t + 19000 < MAX_DEFER_MS; t += 19000) {
            advance(19000);
            fireEvent('keydown');
        }
        expect(pulls(sent)).toBe(0);
        advance(19000);
        expect(pulls(sent)).toBe(1);
    });

    test('the time is written once the core took the dispatch, not when it fails', async () => {
        const { transport, sent, advance, store, inner } = setup();
        inner.dispatch.mockImplementationOnce(() => Promise.reject(new Error('worker gone')));
        transport.dispatch(ctx('PullNotifications'));
        advance(IDLE);
        expect(inner.dispatch).toHaveBeenCalledTimes(1);
        await flush();
        expect(store[STORAGE_KEY]).toBeUndefined();
        // The next focus asks again, and it goes.
        transport.dispatch(ctx('PullNotifications'));
        advance(IDLE);
        await flush();
        expect(pulls(sent)).toBe(1);
        expect(Number(store[STORAGE_KEY])).toBeGreaterThan(0);
    });

    test('a time saved in the future (the TV clock went back) counts as none, and no timer goes past 1 h', async () => {
        const start = Date.UTC(2018, 0, 1);
        const t = setup({ start, pulledAt: Date.UTC(2026, 9, 13) });
        t.inner.warmUp = jest.fn(() => Promise.resolve(2));
        await t.transport.getState('ctx');
        t.transport.dispatch(ctx('PullNotifications'));
        t.advance(IDLE);
        expect(pulls(t.sent)).toBe(1);
        await flush();
        expect(Number(t.store[STORAGE_KEY])).toBe(start + IDLE);
        // A long wait (the next 6 h) is set in steps of at most 1 h.
        t.transport.dispatch(ctx('PullNotifications'));
        t.advance(INTERVAL);
        expect(pulls(t.sent)).toBe(2);
        expect(t.delays.length).toBeGreaterThan(0);
        t.delays.forEach((ms) => {
            expect(ms).toBeGreaterThanOrEqual(0);
            expect(ms).toBeLessThanOrEqual(MAX_DELAY_MS);
        });
    });
});

describe('warm-up of the core', () => {
    test('not at boot: once per launch, 3 s without input after the Board shows a row', async () => {
        const t = setup({ board: READY_BOARD });
        t.inner.warmUp = jest.fn(() => Promise.resolve(2));
        // The core answers its first ctx 6 s after the page loaded, no key pressed.
        t.advance(6000);
        await t.transport.getState('ctx');
        t.advance(0);
        expect(t.inner.warmUp).not.toHaveBeenCalled();
        t.advance(2000);
        await t.transport.getState('board');
        t.advance(2999);
        expect(t.inner.warmUp).not.toHaveBeenCalled();
        t.advance(1);
        expect(t.inner.warmUp).toHaveBeenCalledTimes(1);
        await t.transport.getState('ctx');
        await t.transport.getState('board');
        t.advance(10 * IDLE);
        expect(t.inner.warmUp).toHaveBeenCalledTimes(1);
    });

    test('a Board still loading does not arm it; without a Board it runs 20 s after the first ctx', async () => {
        const t = setup({ board: { catalogs: [{ content: { type: 'Loading' } }, { content: null }] } });
        t.inner.warmUp = jest.fn(() => Promise.resolve(2));
        await t.transport.getState('ctx');
        await t.transport.getState('board');
        t.advance(WARM_UP_FALLBACK_MS - 1);
        expect(t.inner.warmUp).not.toHaveBeenCalled();
        t.advance(1);
        expect(t.inner.warmUp).toHaveBeenCalledTimes(1);
    });

    test('pushed back by input, not in the Player; a failure is ignored', async () => {
        const t = setup({ hash: '#/player/x', board: READY_BOARD });
        t.inner.warmUp = jest.fn(() => Promise.reject(new Error('worker gone')));
        await t.transport.getState('ctx');
        await t.transport.getState('board');
        t.advance(10000);
        expect(t.inner.warmUp).not.toHaveBeenCalled();
        t.win.location.hash = '#/';
        t.fireEvent('hashchange');
        t.advance(2999);
        expect(t.inner.warmUp).not.toHaveBeenCalled();
        t.advance(1);
        expect(t.inner.warmUp).toHaveBeenCalledTimes(1);
    });

    test('a warm-up that throws does not stop the pulls', async () => {
        const t = setup({ board: READY_BOARD });
        t.inner.warmUp = jest.fn(() => { throw new Error('no worker'); });
        await t.transport.getState('ctx');
        await t.transport.getState('board');
        t.transport.dispatch(ctx('PullNotifications'));
        expect(() => t.advance(IDLE)).not.toThrow();
        expect(t.inner.warmUp).toHaveBeenCalledTimes(1);
        expect(pulls(t.sent)).toBe(1);
    });
});
