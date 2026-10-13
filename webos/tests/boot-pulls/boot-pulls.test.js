// webos/lib/boot-pulls: the Ctx pulls of App.js on the TV (F8.7).
const { wrap, STORAGE_KEY } = require('../../lib/boot-pulls');

const IDLE = 20000;
const INTERVAL = 6 * 3600 * 1000;

const setup = ({ pulledAt = null, hash = '#/', auth = null, start = 1e12 } = {}) => {
    let clock = start;
    const timers = [];
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
        getState: jest.fn((model) => Promise.resolve(model === 'ctx' ? ctx : { model })),
        dispatch: jest.fn((action, field) => { sent.push([action, field]); return Promise.resolve('sent'); }),
        analytics: jest.fn(),
    };
    const transport = wrap(inner, {
        window: win,
        storage,
        now: () => clock,
        idleMs: IDLE,
        intervalMs: INTERVAL,
        setTimeout: (fn, ms) => { const t = { fn, at: clock + ms, done: false }; timers.push(t); return t; },
        clearTimeout: (t) => { if (t) t.done = true; },
    });
    // Advances the fake clock, running the timers that come due in order.
    const advance = (ms) => {
        const end = clock + ms;
        for (;;) {
            const next = timers.filter((t) => !t.done && t.at <= end).sort((a, b) => a.at - b.at)[0];
            if (!next) break;
            clock = Math.max(clock, next.at);
            next.done = true;
            next.fn();
        }
        clock = end;
    };
    const fireEvent = (name) => (listeners[name] || []).forEach((fn) => fn());
    return { transport, inner, sent, store, win, advance, fireEvent, ctx };
};

const ctx = (action) => ({ action: 'Ctx', args: { action } });
const pulls = (sent) => sent.filter(([a]) => a.args && a.args.action === 'PullNotifications').length;

describe('API pulls', () => {
    test('dropped for a guest once the ctx is known; other actions go as they came', async () => {
        const { transport, sent } = setup({ auth: null });
        await transport.getState('ctx');
        await expect(transport.dispatch(ctx('PullAddonsFromAPI'))).resolves.toBeUndefined();
        transport.dispatch({ action: 'Ctx', args: { action: 'PullUserFromAPI', args: {} } });
        transport.dispatch(ctx('SyncLibraryWithAPI'));
        expect(sent).toEqual([]);
        await expect(transport.dispatch(ctx('InstallAddon'), null)).resolves.toBe('sent');
        transport.dispatch({ action: 'Load', args: { model: 'MetaDetails' } }, 'meta_details');
        expect(sent.map(([a, f]) => [a.args.action || a.args.model, f])).toEqual([['InstallAddon', null], ['MetaDetails', 'meta_details']]);
    });

    test('with a session, or before any ctx, they go as they came', async () => {
        const unknown = setup({ auth: null });
        unknown.transport.dispatch(ctx('PullAddonsFromAPI'));
        expect(unknown.sent).toHaveLength(1);
        const signedIn = setup({ auth: { key: 'k', user: {} } });
        await signedIn.transport.getState('ctx');
        signedIn.transport.dispatch(ctx('PullAddonsFromAPI'));
        signedIn.transport.dispatch(ctx('SyncLibraryWithAPI'));
        expect(signedIn.sent).toHaveLength(2);
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
        const { transport, inner } = setup();
        await expect(transport.getState('board')).resolves.toEqual({ model: 'board' });
        expect(inner.getState).toHaveBeenCalledWith('board');
        expect(transport.analytics).toBe(inner.analytics);
    });
});

describe('PullNotifications', () => {
    test('never right away: after the app is idle for 20 s, once, and the time is kept', () => {
        const { transport, sent, store, advance } = setup();
        transport.dispatch(ctx('PullNotifications'));
        expect(pulls(sent)).toBe(0);
        advance(IDLE - 1);
        expect(pulls(sent)).toBe(0);
        advance(1);
        expect(pulls(sent)).toBe(1);
        expect(Number(store[STORAGE_KEY])).toBeGreaterThan(0);
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

    test('at most once per 6 h, across launches (the time is in localStorage)', () => {
        const start = 1e12;
        const recent = setup({ pulledAt: start - 3600 * 1000, start });
        recent.transport.dispatch(ctx('PullNotifications'));
        recent.advance(INTERVAL - 3600 * 1000 - 1);
        expect(pulls(recent.sent)).toBe(0);
        recent.advance(1);
        expect(pulls(recent.sent)).toBe(1);
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

    test('an unreadable or broken storage only means a pull per launch', () => {
        const { transport, sent, advance, store } = setup({ pulledAt: 'garbage' });
        transport.dispatch(ctx('PullNotifications'));
        advance(IDLE);
        expect(pulls(sent)).toBe(1);
        expect(store[STORAGE_KEY]).not.toBe('garbage');
        const throwing = wrap({ getState: () => null, dispatch: jest.fn(() => Promise.resolve()) }, {
            window: { location: { hash: '#/' } },
            storage: { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } },
            idleMs: 0,
            setTimeout: (fn) => fn(),
        });
        expect(() => throwing.dispatch(ctx('PullNotifications'))).not.toThrow();
    });
});
