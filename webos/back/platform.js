// webOS pieces of the Back dispatcher (owner: F3.2): the virtual keyboard and quitting the app.

// The system keyboard is up while a text field has the focus; PalmSystem.isKeyboardVisible is what
// webOS.keyboard.isShowing() of webOSTV.js reads. Taking the focus away from the field closes it.
// Without a field to blur the press goes on, so a stale flag never leaves Back without effect.
const closeVirtualKeyboard = (win, doc = win.document) => {
    if (!win.PalmSystem || win.PalmSystem.isKeyboardVisible !== true) {
        return false;
    }
    const active = doc.activeElement;
    if (!active || active === doc.body || typeof active.blur !== 'function') {
        return false;
    }
    active.blur();
    return true;
};

// window.close() ends a webOS web app: WebAppMgr closes the app and frees its memory (it does not
// stay suspended like with webOS.platformBack(), which only returns to the launcher). If the window
// is still there after EXIT_FALLBACK_MS, platformBack() at least takes the user out of the app.
const EXIT_FALLBACK_MS = 1000;

const exitApp = (win) => {
    win.close();
    win.setTimeout(() => {
        if (win.webOS && typeof win.webOS.platformBack === 'function') {
            win.webOS.platformBack();
        }
    }, EXIT_FALLBACK_MS);
};

module.exports = {
    EXIT_FALLBACK_MS,
    closeVirtualKeyboard,
    exitApp,
};
