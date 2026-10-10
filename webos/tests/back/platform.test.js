// webos/back/platform.js: the virtual keyboard layer and quitting the app.

const { EXIT_FALLBACK_MS, closeVirtualKeyboard, exitApp } = require('../../back/platform');

const setup = ({ keyboardVisible, focused = 'input' }) => {
    const body = { blur: jest.fn() };
    const input = { blur: jest.fn() };
    const doc = { body, activeElement: focused === 'input' ? input : focused === 'body' ? body : null };
    const win = { document: doc };
    if (keyboardVisible !== undefined) {
        win.PalmSystem = { isKeyboardVisible: keyboardVisible };
    }
    return { win, input, body };
};

describe('closeVirtualKeyboard', () => {
    test('blurs the focused field while the keyboard is up', () => {
        const { win, input } = setup({ keyboardVisible: true });
        expect(closeVirtualKeyboard(win)).toBe(true);
        expect(input.blur).toHaveBeenCalledTimes(1);
    });

    test('passes the press on when the keyboard is down or there is no PalmSystem (desktop)', () => {
        [setup({ keyboardVisible: false }), setup({})].forEach(({ win, input }) => {
            expect(closeVirtualKeyboard(win)).toBe(false);
            expect(input.blur).not.toHaveBeenCalled();
        });
    });

    test('passes the press on when nothing can be blurred, so a stale flag never blocks Back', () => {
        const onBody = setup({ keyboardVisible: true, focused: 'body' });
        expect(closeVirtualKeyboard(onBody.win)).toBe(false);
        expect(onBody.body.blur).not.toHaveBeenCalled();
        expect(closeVirtualKeyboard(setup({ keyboardVisible: true, focused: null }).win)).toBe(false);
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
