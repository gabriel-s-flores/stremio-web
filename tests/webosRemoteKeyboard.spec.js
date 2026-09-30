const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');

const compile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

const exportsFor = (file) => {
    const context = { exports: {} };
    vm.runInNewContext(compile(file), context);
    return context.exports;
};

const keyboard = exportsFor('src/common/Shortcuts/keyboard.ts');
const dispatchWebOSShortcut = exportsFor('src/common/Shortcuts/dispatchWebOSShortcut.ts').default;

const keyboardEvent = (values = {}) => ({
    key: 'Unidentified',
    code: 'Unidentified',
    keyCode: 0,
    which: 0,
    ...values,
});

test.each([
    [{ keyCode: 461 }, 'Back'],
    [{ which: 415 }, 'MediaPlay'],
    [{ keyCode: 19 }, 'MediaPause'],
    [{ keyCode: 413 }, 'MediaStop'],
    [{ keyCode: 417 }, 'MediaFastForward'],
    [{ which: 412 }, 'MediaRewind'],
    [{ keyCode: 403 }, 'ColorRed'],
    [{ keyCode: 404 }, 'ColorGreen'],
    [{ keyCode: 405 }, 'ColorYellow'],
    [{ keyCode: 406 }, 'ColorBlue'],
])('normalizes webOS key codes and which fallback %p', (values, expected) => {
    expect(keyboard.getKeyboardShortcutKey(keyboardEvent(values))).toBe(expected);
});

test.each([
    ['Back', 'XF86Back', 'Back'],
    ['GoBack', 'Back', 'Back'],
    ['Play', 'MediaPlay', 'MediaPlay'],
    ['Pause', 'MediaPause', 'MediaPause'],
    ['Stop', 'MediaStop', 'MediaStop'],
    ['FastForward', 'MediaFastForward', 'MediaFastForward'],
    ['Rewind', 'MediaRewind', 'MediaRewind'],
    ['Red', 'ColorF0Red', 'ColorRed'],
    ['Green', 'ColorF1Green', 'ColorGreen'],
    ['Yellow', 'ColorF2Yellow', 'ColorYellow'],
    ['Blue', 'ColorF3Blue', 'ColorBlue'],
])('canonicalizes key/code aliases %s and %s once', (key, code, expected) => {
    const event = keyboardEvent({ key, code });
    expect(keyboard.getKeyboardShortcutKey(event)).toBe(expected);
    expect(keyboard.getKeyboardShortcutKeys(event)).toEqual([expected]);
});

test('keeps Escape and common desktop shortcut identities separate from Back', () => {
    expect(keyboard.getKeyboardShortcutKey(keyboardEvent({ key: 'Escape', code: 'Escape', keyCode: 27 }))).toBe('Escape');
    expect(keyboard.getKeyboardShortcutKey(keyboardEvent({ key: 'Backspace', code: 'Backspace', keyCode: 8 }))).toBe('Backspace');
    expect(keyboard.getKeyboardShortcutKeys(keyboardEvent({ key: 'a', code: 'KeyA', keyCode: 65 }))).toEqual(['KeyA', 'A']);
});

test('preserves unknown keys and normalizes code and key as unique candidates', () => {
    expect(keyboard.getKeyboardShortcutKey(keyboardEvent({ key: 'Unidentified', keyCode: 902 }))).toBe('Unidentified');
    expect(keyboard.getKeyboardShortcutKeys(keyboardEvent({ key: 'Play', code: 'MediaPlay' }))).toEqual(['MediaPlay']);
});

test('only Back bypasses focused text fields; seek keys are the only repeatable remote actions', () => {
    expect(keyboard.getWebOSShortcut(['MediaPlay'], true)).toBeUndefined();
    expect(keyboard.getWebOSShortcut(['Back'], true)).toBe('Back');
    expect(keyboard.getWebOSShortcut(['ColorRed'], false)).toBe('ColorRed');
    expect(keyboard.isWebOSShortcutRepeatable('MediaFastForward')).toBe(true);
    expect(keyboard.isWebOSShortcutRepeatable('MediaRewind')).toBe(true);
    expect(keyboard.isWebOSShortcutRepeatable('MediaStop')).toBe(false);
});

test('throttles repeated key events while allowing the next interval', () => {
    const lastRepeatTime = new Map();
    expect(keyboard.shouldThrottleRepeatedKey(lastRepeatTime, 'MediaFastForward', 1000)).toBe(false);
    expect(keyboard.shouldThrottleRepeatedKey(lastRepeatTime, 'MediaFastForward', 1129)).toBe(true);
    expect(keyboard.shouldThrottleRepeatedKey(lastRepeatTime, 'MediaFastForward', 1130)).toBe(false);
});

test('dispatches a remote shortcut once and consumes it only when a handler reports success', () => {
    const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
    const listener = jest.fn(() => true);
    const onShortcut = jest.fn();

    expect(dispatchWebOSShortcut(event, 'MediaPlay', new Set([listener]), onShortcut)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
});

test('leaves unavailable remote actions and Back unconsumed unless the central handler accepts it', () => {
    const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
    const listener = jest.fn(() => true);
    const onShortcut = jest.fn(() => false);

    expect(dispatchWebOSShortcut(event, 'ColorRed', new Set([() => false]), onShortcut)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(dispatchWebOSShortcut(event, 'Back', new Set([listener]), onShortcut)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(onShortcut).toHaveBeenCalledTimes(2);
    expect(event.stopPropagation).not.toHaveBeenCalled();

    onShortcut.mockReturnValue(true);
    expect(dispatchWebOSShortcut(event, 'Back', [], onShortcut)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
});
