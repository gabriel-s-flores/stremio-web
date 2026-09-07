// Copyright (C) 2017-2026 Smart code 203358507

const writeTextToClipboard = (text) => {
    let clipboard = null;
    let writeText = null;

    try {
        clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard;
        writeText = clipboard && clipboard.writeText;
    } catch (error) {
        return Promise.reject(error);
    }

    if (typeof writeText !== 'function') {
        return Promise.reject(new Error('Clipboard API is unavailable'));
    }

    try {
        return Promise.resolve(writeText.call(clipboard, text));
    } catch (error) {
        return Promise.reject(error);
    }
};

module.exports = writeTextToClipboard;
