// Copyright (C) 2017-2026 Smart code 203358507

// Single Clipboard seam for desktop and webOS (Chromium 68).
// Normalizes missing API, missing methods, synchronous throws,
// asynchronous rejections and invalid results as catchable rejections.
// Never logs values: callers must keep copied content out of diagnostics
// and user-visible error output.

const UNAVAILABLE_MESSAGE = 'Clipboard API is unavailable';
const INVALID_READ_MESSAGE = 'Clipboard read returned an invalid result';

const getClipboard = () => {
    if (typeof navigator === 'undefined' || navigator === null) {
        return null;
    }
    return navigator.clipboard || null;
};

const writeTextToClipboard = (text) => {
    let clipboard = null;
    let writeText = null;

    try {
        clipboard = getClipboard();
        writeText = clipboard && clipboard.writeText;
    } catch (error) {
        return Promise.reject(error);
    }

    if (typeof writeText !== 'function') {
        return Promise.reject(new Error(UNAVAILABLE_MESSAGE));
    }

    try {
        return Promise.resolve(writeText.call(clipboard, text)).then(() => undefined);
    } catch (error) {
        return Promise.reject(error);
    }
};

const readTextFromClipboard = () => {
    let clipboard = null;
    let readText = null;

    try {
        clipboard = getClipboard();
        readText = clipboard && clipboard.readText;
    } catch (error) {
        return Promise.reject(error);
    }

    if (typeof readText !== 'function') {
        return Promise.reject(new Error(UNAVAILABLE_MESSAGE));
    }

    let result = null;
    try {
        result = readText.call(clipboard);
    } catch (error) {
        return Promise.reject(error);
    }

    return Promise.resolve(result).then((value) => {
        if (typeof value !== 'string') {
            throw new Error(INVALID_READ_MESSAGE);
        }
        return value;
    });
};

// Selection-based copy, usable only when a selectable field exists.
// Returns true only when execCommand reports success; never throws
// and never touches the Clipboard API. The input must already contain
// the value to copy (readonly TextInput in the fallback modals).
const copyTextBySelection = (input) => {
    try {
        if (!input || typeof input.select !== 'function') {
            return false;
        }
        if (typeof document === 'undefined' || document === null) {
            return false;
        }
        if (typeof document.execCommand !== 'function') {
            return false;
        }
        try {
            input.focus();
        } catch (_) {
            // Focus failure must not block the copy attempt.
        }
        try {
            input.select();
        } catch (_) {
            return false;
        }
        try {
            if (typeof input.setSelectionRange === 'function' && typeof input.value === 'string') {
                input.setSelectionRange(0, input.value.length);
            }
        } catch (_) {
            // Selection range is best-effort; execCommand still decides.
        }
        let succeeded = false;
        try {
            succeeded = document.execCommand('copy');
        } catch (_) {
            return false;
        }
        return succeeded === true;
    } catch (_) {
        return false;
    }
};

module.exports = {
    writeTextToClipboard,
    readTextFromClipboard,
    copyTextBySelection,
    UNAVAILABLE_MESSAGE,
    INVALID_READ_MESSAGE,
};
