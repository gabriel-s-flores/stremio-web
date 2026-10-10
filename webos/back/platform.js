// webOS pieces of the Back dispatcher (owner: F3.2): the virtual keyboard and quitting the app.

// While the system keyboard is up, the system takes Back itself and hides the keyboard: the page
// gets no key at all (measured on the emulator). PalmSystem.isKeyboardVisible (what
// webOS.keyboard.isShowing() of webOSTV.js reads) stays true after that, so the visibility comes
// from the keyboardStateChange events the system sends; the PalmSystem flag is only used until the
// first event. Without this, the next Back would be spent on a keyboard that is already hidden.
const trackKeyboard = (win, doc = win.document) => {
    let visible = null;
    doc.addEventListener('keyboardStateChange', (event) => {
        if (event.detail && typeof event.detail.visibility === 'boolean') {
            visible = event.detail.visibility;
        }
    });
    return () => (visible !== null ? visible : Boolean(win.PalmSystem && win.PalmSystem.isKeyboardVisible === true));
};

// If Back does reach the page with the keyboard up (a system that leaves it to the app), taking
// the focus away from the text field closes the keyboard. Without a field to blur the press goes
// on, so a stale state never leaves Back without effect.
const closeVirtualKeyboard = (win, isKeyboardVisible, doc = win.document) => {
    if (!isKeyboardVisible()) {
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
    trackKeyboard,
    closeVirtualKeyboard,
    exitApp,
};
