const createLifecycle = require('../../lifecycle/controller');
const { createWindow } = require('./helpers');

const setup = (options = {}) => {
    const win = createWindow(options);
    const doc = win.document;
    const onDeepLink = jest.fn();
    const lifecycle = createLifecycle({ window: win, onDeepLink });
    const video = doc.create('video');
    const scroller = doc.create('div');
    const card = doc.create('a', scroller);
    const types = () => win.__webosLifecycle.events.map((event) => event.type);
    const last = () => win.__webosLifecycle.events[win.__webosLifecycle.events.length - 1];
    return { win, doc, onDeepLink, lifecycle, video, scroller, card, types, last };
};

const hide = ({ doc }) => {
    doc.hidden = true;
    doc.dispatch('visibilitychange');
};

const show = ({ doc }) => {
    doc.hidden = false;
    doc.dispatch('visibilitychange');
};

describe('visibilitychange', () => {
    test('hidden pauses the player and visible does not resume it', () => {
        const t = setup();
        t.lifecycle.start();
        t.video.paused = false;

        hide(t);
        expect(t.video.paused).toBe(true);
        expect(t.last()).toMatchObject({ type: 'background', reason: 'visibilitychange', paused: 1 });
        expect(t.win.__webosLifecycle.background).toBe(true);

        show(t);
        expect(t.video.paused).toBe(true);
        expect(t.last()).toMatchObject({ type: 'foreground', reason: 'visibilitychange' });
        expect(t.win.__webosLifecycle.background).toBe(false);
    });

    test('a load that finishes buffering in the background does not start playing', () => {
        const t = setup();
        t.lifecycle.start();

        hide(t);
        t.video.play();
        expect(t.video.paused).toBe(true);
    });

    test('what the system resumes when the app is back is paused again, until the user presses a key', () => {
        const t = setup();
        t.lifecycle.start();
        t.video.paused = false;
        hide(t);
        show(t);

        // webOS resumes the <video> it paused itself, a moment after the app is back
        t.win.advance(200);
        t.video.play();
        expect(t.video.paused).toBe(true);

        t.doc.dispatch('keydown', { keyCode: 13 });
        t.video.play();
        expect(t.video.paused).toBe(false);
    });

    test('the resume guard expires: playback the user started later is left alone', () => {
        const t = setup();
        t.lifecycle.start();
        hide(t);
        show(t);
        t.win.advance(5000);
        t.video.play();
        expect(t.video.paused).toBe(false);
    });

    test('a relaunch from the background is guarded the same way', () => {
        const t = setup();
        t.lifecycle.start();
        hide(t);
        t.doc.dispatch('webOSRelaunch', { detail: {} });
        t.video.play();
        expect(t.video.paused).toBe(true);
    });

    test('a second hidden without a visible in between is one background', () => {
        const t = setup();
        t.lifecycle.start();
        hide(t);
        hide(t);
        expect(t.types().filter((type) => type === 'background')).toHaveLength(1);
    });

    test('the focus the system took while hidden comes back', () => {
        const t = setup();
        t.lifecycle.start();
        t.scroller.scrollTop = 300;
        t.card.focus();

        hide(t);
        t.doc.activeElement = t.doc.body;
        t.scroller.scrollTop = 0;
        show(t);

        expect(t.doc.activeElement).toBe(t.card);
        expect(t.scroller.scrollTop).toBe(300);
        expect(t.last().restored).toMatchObject({ focus: 'restored', scroll: 1, routeChanged: false });
    });

    test('takes the window focus when the system gave it to nobody', () => {
        const t = setup();
        t.lifecycle.start();
        hide(t);
        t.doc.hasFocusValue = false;
        show(t);
        expect(t.win.focusCalls).toBe(1);
    });

    test('starting while already hidden is a background', () => {
        const t = setup({ hidden: true });
        t.video.paused = false;
        t.lifecycle.start();
        expect(t.video.paused).toBe(true);
        expect(t.last()).toMatchObject({ type: 'background', reason: 'start' });
    });
});

describe('blur and focus (HOME bar, system panel)', () => {
    test('are not a background: the player keeps playing', () => {
        const t = setup();
        t.lifecycle.start();
        t.video.paused = false;

        t.win.dispatch('blur');

        expect(t.video.paused).toBe(false);
        expect(t.win.__webosLifecycle.background).toBe(false);
        expect(t.last()).toMatchObject({ type: 'blur' });
    });

    test('the focus comes back if the system took it in between', () => {
        const t = setup();
        t.lifecycle.start();
        t.card.focus();

        t.win.dispatch('blur');
        t.doc.activeElement = t.doc.body;
        t.win.dispatch('focus');

        expect(t.doc.activeElement).toBe(t.card);
        expect(t.last()).toMatchObject({ type: 'focus', restored: { focus: 'restored' } });
    });

    test('an untouched focus stays', () => {
        const t = setup();
        t.lifecycle.start();
        t.card.focus();
        t.card.focusCalls = 0;

        t.win.dispatch('blur');
        t.win.dispatch('focus');

        expect(t.card.focusCalls).toBe(0);
        expect(t.last().restored.focus).toBe('kept');
    });
});

describe('webOSRelaunch', () => {
    test('brings the app to front and keeps route and focus', () => {
        const t = setup();
        t.lifecycle.start();
        t.card.focus();
        t.win.dispatch('blur');
        t.doc.dispatch('webOSRelaunch', { detail: { displayAffinity: 0 } });

        expect(t.win.PalmSystem.activateCalls).toBe(1);
        expect(t.win.location.hash).toBe('#/');
        expect(t.doc.activeElement).toBe(t.card);
        expect(t.onDeepLink).not.toHaveBeenCalled();
        expect(t.last()).toMatchObject({ type: 'relaunch', activated: true, deepLink: null, restored: { focus: 'kept' } });
    });

    test('puts the focus back when the system took it', () => {
        const t = setup();
        t.lifecycle.start();
        t.card.focus();
        t.win.dispatch('blur');
        t.doc.activeElement = t.doc.body;
        t.doc.dispatch('webOSRelaunch', { detail: {} });

        expect(t.doc.activeElement).toBe(t.card);
        // activate() takes the window focus, and the focus handler is the one that puts it back
        expect(t.win.__webosLifecycle.events.find((event) => event.type === 'focus').restored.focus).toBe('restored');
    });

    test('while in the background it is also the way back to the foreground (no resume of the player)', () => {
        const t = setup();
        t.lifecycle.start();
        t.video.paused = false;
        hide(t);

        t.doc.dispatch('webOSRelaunch', { detail: {} });

        expect(t.types()).toEqual(['background', 'foreground', 'relaunch']);
        expect(t.video.paused).toBe(true);
        expect(t.win.__webosLifecycle.background).toBe(false);
    });

    test('opens the deep link and does not restore the old position over it', () => {
        const t = setup();
        t.lifecycle.start();
        t.card.focus();
        t.doc.dispatch('webOSRelaunch', { detail: { contentTarget: 'stremio:///detail/movie/tt0111161' } });

        expect(t.onDeepLink).toHaveBeenCalledWith('/detail/movie/tt0111161');
        expect(t.last()).toMatchObject({ type: 'relaunch', deepLink: '/detail/movie/tt0111161', restored: null });
    });

    test('a target outside the app is ignored', () => {
        const t = setup();
        t.lifecycle.start();
        t.doc.dispatch('webOSRelaunch', { detail: { contentTarget: 'https://example.com/' } });
        expect(t.onDeepLink).not.toHaveBeenCalled();
        expect(t.last().deepLink).toBeNull();
    });

    test('without PalmSystem (desktop) it still works', () => {
        const t = setup();
        delete t.win.PalmSystem;
        t.lifecycle.start();
        t.doc.dispatch('webOSRelaunch', { detail: {} });
        expect(t.last()).toMatchObject({ type: 'relaunch', activated: false });
    });

    test('an activate() that throws does not break the relaunch', () => {
        const t = setup();
        t.win.PalmSystem.activate = () => {
            throw new Error('no window');
        };
        t.lifecycle.start();
        t.doc.dispatch('webOSRelaunch', { detail: {} });
        expect(t.last()).toMatchObject({ type: 'relaunch', activated: false });
    });
});

describe('cold start', () => {
    test('opens the deep link of the launch parameters', () => {
        const t = setup();
        t.win.PalmSystem.launchParams = '{"contentTarget":"stremio:///discover"}';
        t.lifecycle.start();
        expect(t.onDeepLink).toHaveBeenCalledWith('/discover');
        expect(t.types()).toEqual(['launch']);
    });

    test('plain launch parameters do nothing', () => {
        const t = setup();
        t.win.PalmSystem.launchParams = '{"displayAffinity":0}';
        t.lifecycle.start();
        expect(t.onDeepLink).not.toHaveBeenCalled();
        expect(t.types()).toEqual([]);
    });
});

describe('start and stop', () => {
    test('stop removes every listener, start twice adds them once', () => {
        const t = setup();
        t.lifecycle.start();
        t.lifecycle.start();
        expect(t.doc.listenerCount('visibilitychange')).toBe(1);
        expect(t.doc.listenerCount('webOSRelaunch')).toBe(1);
        expect(t.win.listenerCount('blur')).toBe(1);
        expect(t.win.listenerCount('focus')).toBe(1);

        hide(t);
        expect(t.doc.listenerCount('play')).toBe(1);
        t.lifecycle.stop();
        expect(t.win.pendingTimers()).toBe(0);

        expect(t.doc.listenerCount('visibilitychange')).toBe(0);
        expect(t.doc.listenerCount('webOSRelaunch')).toBe(0);
        expect(t.win.listenerCount('blur')).toBe(0);
        expect(t.win.listenerCount('focus')).toBe(0);
        expect(t.doc.listenerCount('play')).toBe(0);
    });

    test('the log is bounded', () => {
        const t = setup();
        t.lifecycle.start();
        for (let i = 0; i < 120; i++) {
            t.win.dispatch('blur');
        }
        expect(t.win.__webosLifecycle.events).toHaveLength(50);
    });
});
