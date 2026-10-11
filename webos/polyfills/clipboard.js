// navigator.clipboard for Chromium 53 (webOS TV 4.x; native since 66). Without it the "copy link"
// actions of the Player and the stream menu throw a TypeError before their own error toast.
//
// Not a full polyfill, just enough for what the app does:
// - writeText() copies through a hidden textarea and execCommand('copy'), which the engine allows
//   inside the click that asked for it; it rejects when the copy did not happen, so the callers'
//   `.catch` shows their error toast instead of a success that did not happen;
// - readText() rejects (NotAllowedError): there is no clipboard to read from on the TV, and the
//   search field already takes pasted text through the `paste` event.

const rejection = (name, message) => {
    const error = new Error(message);
    error.name = name;
    return Promise.reject(error);
};

const copyWithTextarea = (doc, text) => {
    const textarea = doc.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    const active = doc.activeElement;
    doc.body.appendChild(textarea);
    let copied = false;
    try {
        textarea.select();
        copied = doc.execCommand('copy');
    } catch (error) {
        copied = false;
    }
    doc.body.removeChild(textarea);
    if (active && typeof active.focus === 'function') {
        active.focus();
    }
    return copied;
};

export const install = (global) => {
    const navigator = global.navigator;
    if (!navigator || navigator.clipboard || !global.document) {
        return;
    }
    const clipboard = {
        writeText: (text) => {
            if (copyWithTextarea(global.document, String(text))) {
                return Promise.resolve();
            }
            return rejection('NotAllowedError', 'Write permission denied.');
        },
        readText: () => rejection('NotAllowedError', 'Read permission denied.'),
    };
    try {
        Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true, enumerable: true });
    } catch (error) {
        // navigator is frozen or the property is locked: leave it as the engine has it.
    }
};
