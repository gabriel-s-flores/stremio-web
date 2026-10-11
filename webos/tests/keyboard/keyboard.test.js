/**
 * @jest-environment jsdom
 */
// webos/keyboard/keyboard.js: Enter on a text field, as OK (open the keyboard) and as the keyboard's
// own Enter (submit, then close it with the focus kept).

const { OPEN_GUARD_MS, OPEN_DELAY_MS, CLOSE_RESTORE_MS, isTextField, install } = require('../../keyboard/keyboard');

let time;
let uninstall;
let field;

const keyboardStateChange = (visibility) => {
    const event = new Event('keyboardStateChange');
    event.detail = { visibility };
    document.dispatchEvent(event);
};

// Enter as the page gets it. `reachedPage` is what a listener of the page (React's root) would see.
const pressEnter = (target = field, init = {}) => {
    const event = new Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { value: init.keyCode === undefined ? 13 : init.keyCode });
    Object.defineProperty(event, 'repeat', { value: Boolean(init.repeat) });
    Object.defineProperty(event, 'isComposing', { value: Boolean(init.isComposing) });
    let reachedPage = false;
    const onPage = () => {
        reachedPage = true;
    };
    document.addEventListener('keydown', onPage);
    target.dispatchEvent(event);
    document.removeEventListener('keydown', onPage);
    return { reachedPage, defaultPrevented: event.defaultPrevented };
};

beforeEach(() => {
    jest.useFakeTimers();
    time = 10000;
    field = document.createElement('input');
    field.setAttribute('type', 'text');
    document.body.appendChild(field);
    field.focus();
    uninstall = install(window, { now: () => time });
});

afterEach(() => {
    uninstall();
    delete window.PalmSystem;
    document.body.innerHTML = '';
    jest.useRealTimers();
});

const advance = (ms) => {
    time += ms;
    jest.advanceTimersByTime(ms);
};

describe('isTextField', () => {
    test.each([
        ['<input>', true],
        ['<input type="text">', true],
        ['<input type="search">', true],
        ['<input type="password">', true],
        ['<input type="url">', true],
        ['<input type="email">', true],
        ['<input type="checkbox">', false],
        ['<input type="range">', false],
        ['<textarea>', false],
        ['<button>', false],
        ['<div>', false],
    ])('%s', (markup, expected) => {
        const holder = document.createElement('div');
        holder.innerHTML = markup;
        expect(isTextField(holder.firstChild)).toBe(expected);
    });

    test('nothing is not a text field', () => {
        expect(isTextField(null)).toBe(false);
    });
});

describe('OK on a text field with the keyboard down', () => {
    test('does not submit: the key never reaches the page', () => {
        expect(pressEnter()).toEqual({ reachedPage: false, defaultPrevented: true });
    });

    test('opens the keyboard from the page when the system does not (blur and focus again)', () => {
        const events = [];
        field.addEventListener('blur', () => events.push('blur'));
        field.addEventListener('focus', () => events.push('focus'));
        pressEnter();
        expect(events).toEqual([]);
        advance(OPEN_DELAY_MS);
        expect(events).toEqual(['blur', 'focus']);
        expect(document.activeElement).toBe(field);
    });

    test('leaves it alone when the system opened the keyboard by itself in the meantime', () => {
        const blur = jest.fn();
        field.addEventListener('blur', blur);
        pressEnter();
        keyboardStateChange(true);
        advance(OPEN_DELAY_MS);
        expect(blur).not.toHaveBeenCalled();
    });

    test('does nothing if the focus moved away before it', () => {
        const blur = jest.fn();
        field.addEventListener('blur', blur);
        pressEnter();
        field.blur();
        blur.mockClear();
        advance(OPEN_DELAY_MS);
        expect(blur).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(field);
    });

    test('holding the key opens it once', () => {
        const focus = jest.fn();
        field.addEventListener('focus', focus);
        pressEnter();
        pressEnter(field, { repeat: true });
        pressEnter(field, { repeat: true });
        advance(OPEN_DELAY_MS);
        expect(focus).toHaveBeenCalledTimes(1);
    });

    test('is the same before the first keyboardStateChange, from PalmSystem (down)', () => {
        window.PalmSystem = { isKeyboardVisible: false };
        expect(pressEnter().reachedPage).toBe(false);
    });
});

describe('the Enter of the keyboard (it is up)', () => {
    beforeEach(() => {
        keyboardStateChange(true);
        advance(OPEN_GUARD_MS);
    });

    test('goes to the page, which submits', () => {
        expect(pressEnter()).toEqual({ reachedPage: true, defaultPrevented: false });
    });

    test('then closes the keyboard and keeps the focus on the field', () => {
        const blur = jest.fn();
        field.addEventListener('blur', blur);
        pressEnter();
        expect(blur).not.toHaveBeenCalled();
        jest.advanceTimersByTime(0);
        expect(blur).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(field);
        // Read-only while it takes the focus back (that is what keeps the keyboard down), then as it was.
        expect(field.readOnly).toBe(true);
        advance(CLOSE_RESTORE_MS);
        expect(field.readOnly).toBe(false);
    });

    test('a field that was read-only stays read-only', () => {
        field.readOnly = true;
        pressEnter();
        advance(0);
        advance(CLOSE_RESTORE_MS);
        expect(field.readOnly).toBe(true);
    });

    test('does not close what the page already took away (the field left the DOM)', () => {
        pressEnter();
        field.remove();
        const spy = jest.spyOn(field, 'blur');
        advance(0);
        expect(spy).not.toHaveBeenCalled();
    });

    test('after it was closed, the next OK opens the keyboard again instead of submitting', () => {
        pressEnter();
        advance(0);
        keyboardStateChange(false);
        expect(pressEnter()).toEqual({ reachedPage: false, defaultPrevented: true });
    });
});

describe('the OK that opened the keyboard', () => {
    test('an Enter right after the keyboard came up is part of that press: not a submit, not a reopen', () => {
        keyboardStateChange(true);
        advance(OPEN_GUARD_MS - 1);
        const blur = jest.fn();
        field.addEventListener('blur', blur);
        expect(pressEnter()).toEqual({ reachedPage: false, defaultPrevented: true });
        advance(OPEN_DELAY_MS);
        advance(0);
        expect(blur).not.toHaveBeenCalled();
    });

    test('and once the guard time has passed it is the user\'s', () => {
        keyboardStateChange(true);
        advance(OPEN_GUARD_MS);
        expect(pressEnter().reachedPage).toBe(true);
    });
});

describe('what is left alone', () => {
    test.each([
        ['a button', () => document.createElement('button')],
        ['a div (a Button of the app)', () => document.createElement('div')],
        ['a checkbox', () => {
            const checkbox = document.createElement('input');
            checkbox.setAttribute('type', 'checkbox');
            return checkbox;
        }],
        ['a textarea', () => document.createElement('textarea')],
    ])('Enter on %s', (name, create) => {
        const element = create();
        document.body.appendChild(element);
        expect(pressEnter(element)).toEqual({ reachedPage: true, defaultPrevented: false });
    });

    test('other keys on a text field', () => {
        expect(pressEnter(field, { keyCode: 40 }).reachedPage).toBe(true);
        expect(pressEnter(field, { keyCode: 461 }).reachedPage).toBe(true);
        expect(pressEnter(field, { keyCode: 65 }).reachedPage).toBe(true);
    });

    test('Enter of an input method composition', () => {
        expect(pressEnter(field, { isComposing: true }).reachedPage).toBe(true);
    });

    test('uninstall gives the key back', () => {
        uninstall();
        expect(pressEnter().reachedPage).toBe(true);
        uninstall = install(window, { now: () => time });
    });
});
