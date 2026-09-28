const KEY_CODE_MAP: Record<number, string> = {
    8: 'Backspace',
    27: 'Escape',
    461: 'Back',
    32: 'Space',
    19: 'MediaPause',
    37: 'ArrowLeft',
    38: 'ArrowUp',
    39: 'ArrowRight',
    40: 'ArrowDown',
    403: 'ColorRed',
    404: 'ColorGreen',
    405: 'ColorYellow',
    406: 'ColorBlue',
    412: 'MediaRewind',
    413: 'MediaStop',
    415: 'MediaPlay',
    417: 'MediaFastForward',
    122: 'F11',
    187: '=',
    189: '-',
    191: '/',
    219: '[',
    221: ']',
};

const KEY_MAP: Record<string, string> = {
    ' ': 'Space',
    Spacebar: 'Space',
    Esc: 'Escape',
    GoBack: 'Back',
    XF86Back: 'Back',
    Play: 'MediaPlay',
    Pause: 'MediaPause',
    Stop: 'MediaStop',
    FastForward: 'MediaFastForward',
    Rewind: 'MediaRewind',
    Red: 'ColorRed',
    ColorF0Red: 'ColorRed',
    Green: 'ColorGreen',
    ColorF1Green: 'ColorGreen',
    Yellow: 'ColorYellow',
    ColorF2Yellow: 'ColorYellow',
    Blue: 'ColorBlue',
    ColorF3Blue: 'ColorBlue',
    Left: 'ArrowLeft',
    Up: 'ArrowUp',
    Right: 'ArrowRight',
    Down: 'ArrowDown',
    Back: 'Back',
    back: 'Back',
    goback: 'Back',
    xf86back: 'Back',
};

const WEBOS_REMOTE_SHORTCUTS = new Set([
    'Back',
    'ArrowLeft',
    'ArrowRight',
    'MediaPlay',
    'MediaPause',
    'MediaStop',
    'MediaFastForward',
    'MediaRewind',
    'ColorRed',
    'ColorGreen',
    'ColorYellow',
    'ColorBlue',
]);

const REPEATABLE_WEBOS_SHORTCUTS = new Set(['ArrowLeft', 'ArrowRight', 'MediaFastForward', 'MediaRewind']);

const keyFromKeyCode = (keyCode: number) => {
    if (KEY_CODE_MAP[keyCode]) {
        return KEY_CODE_MAP[keyCode];
    }

    if (keyCode >= 48 && keyCode <= 57) {
        return String.fromCharCode(keyCode);
    }

    if (keyCode >= 65 && keyCode <= 90) {
        return String.fromCharCode(keyCode);
    }

    if (keyCode >= 96 && keyCode <= 105) {
        return String(keyCode - 96);
    }

    return null;
};

const normalizeKeyboardKey = ({ key, keyCode, which }: KeyboardEvent) => {
    const mappedKey = KEY_MAP[key] ?? key;
    if (mappedKey && mappedKey !== 'Unidentified') {
        return mappedKey.length === 1 ? mappedKey.toUpperCase() : mappedKey;
    }

    return keyFromKeyCode(keyCode || which) ?? mappedKey;
};

const getKeyboardShortcutKey = (event: KeyboardEvent) => {
    const code = event.code && event.code !== 'Unidentified' ? (KEY_MAP[event.code] ?? event.code) : null;
    return code ?? normalizeKeyboardKey(event);
};

const getKeyboardShortcutKeys = (event: KeyboardEvent) => {
    const normalizedKey = normalizeKeyboardKey(event);
    const code = event.code && event.code !== 'Unidentified' ? (KEY_MAP[event.code] ?? event.code) : '';
    return code && code !== normalizedKey ? [code, normalizedKey] : [normalizedKey];
};

const isBackKeyboardEvent = (event: KeyboardEvent) => getKeyboardShortcutKeys(event).includes('Back');
const getWebOSShortcut = (shortcutKeys: string[], inputFocused: boolean) => {
    const shortcut = shortcutKeys.find((key) => WEBOS_REMOTE_SHORTCUTS.has(key));
    return shortcut === 'Back' || !inputFocused ? shortcut : undefined;
};

const isWebOSShortcutRepeatable = (shortcut: string) => REPEATABLE_WEBOS_SHORTCUTS.has(shortcut);

const shouldThrottleRepeatedKey = (lastRepeatTime: Map<string, number>, key: string, now: number, throttleMs = 130) => {
    const last = lastRepeatTime.get(key) ?? 0;
    if (now - last < throttleMs) return true;
    lastRepeatTime.set(key, now);
    return false;
};

export {
    getKeyboardShortcutKey,
    getKeyboardShortcutKeys,
    isBackKeyboardEvent,
    getWebOSShortcut,
    isWebOSShortcutRepeatable,
    shouldThrottleRepeatedKey,
};
