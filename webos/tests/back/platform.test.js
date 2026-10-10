// webos/back/platform.js: the virtual keyboard layer and quitting the app.

const { EXIT_FALLBACK_MS, trackKeyboard, closeVirtualKeyboard, exitApp } = require('../../back/platform');

const setup = ({ palmVisible, focused = 'input' } = {}) => {
    const body = { blur: jest.fn() };
    const input = { blur: jest.fn() };
    const doc = new EventTarget();
    doc.body = body;
    doc.activeElement = focused === 'input' ? input : focused === 'body' ? body : null;
    const win = { document: doc };
    if (palmVisible !== undefined) {
        win.PalmSystem = { isKeyboardVisible: palmVisible };
    }
    return { win, doc, input, body };
};

const keyboardStateChange = (doc, detail) => {
    const event = new Event('keyboardStateChange');
    event.detail = detail;
    doc.dispatchEvent(event);
};

describe('trackKeyboard', () => {
    test('uses PalmSystem.isKeyboardVisible until the system sends keyboardStateChange', () => {
        const { win, doc } = setup({ palmVisible: true });
        const isVisible = trackKeyboard(win);
        expect(isVisible()).toBe(true);
        // On Back the system hides the keyboard itself; the PalmSystem flag stays true.
        keyboardStateChange(doc, { visibility: false });
        expect(isVisible()).toBe(false);
        keyboardStateChange(doc, { visibility: true });
        expect(isVisible()).toBe(true);
    });

    test('ignores events without a boolean visibility, and is false without PalmSystem (desktop)', () => {
        const { win, doc } = setup();
        const isVisible = trackKeyboard(win);
        keyboardStateChange(doc, null);
        keyboardStateChange(doc, { visibility: 'yes' });
        expect(isVisible()).toBe(false);
    });
});

describe('closeVirtualKeyboard', () => {
    test('blurs the focused field while the keyboard is up', () => {
        const { win, input } = setup();
        expect(closeVirtualKeyboard(win, () => true)).toBe(true);
        expect(input.blur).toHaveBeenCalledTimes(1);
    });

    test('passes the press on when the keyboard is down', () => {
        const { win, input } = setup();
        expect(closeVirtualKeyboard(win, () => false)).toBe(false);
        expect(input.blur).not.toHaveBeenCalled();
    });

    test('passes the press on when nothing can be blurred, so a stale state never blocks Back', () => {
        const onBody = setup({ focused: 'body' });
        expect(closeVirtualKeyboard(onBody.win, () => true)).toBe(false);
        expect(onBody.body.blur).not.toHaveBeenCalled();
        expect(closeVirtualKeyboard(setup({ focused: null }).win, () => true)).toBe(false);
    });
});

describe('exitApp', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const makeWindow = () => ({
        close: jest.fn(),
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        webOS: { platformBack: jest.fn() },
    });

    test('closes the window and only then falls back to webOS.platformBack()', () => {
        const win = makeWindow();
        exitApp(win);
        expect(win.close).toHaveBeenCalledTimes(1);
        expect(win.webOS.platformBack).not.toHaveBeenCalled();
        jest.advanceTimersByTime(EXIT_FALLBACK_MS);
        expect(win.webOS.platformBack).toHaveBeenCalledTimes(1);
    });

    test('works without webOSTV.js', () => {
        const win = makeWindow();
        delete win.webOS;
        exitApp(win);
        expect(() => jest.runAllTimers()).not.toThrow();
        expect(win.close).toHaveBeenCalledTimes(1);
    });
});
