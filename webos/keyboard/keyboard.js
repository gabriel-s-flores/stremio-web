// System keyboard (VKB) for the text fields of the app on webOS TV 4.x (owner: F3.4).
// Behaviour, measurements and the emulator/TV differences: webos/keyboard/README.md.
//
// The system shows the keyboard for a focused text field and hides it on Back (webos/back handles
// what comes after). What the page has to settle is the Enter key, which on a TV is two different
// things for the same keyCode 13:
//
// - OK on a field while the keyboard is down: the user means "type here". It must not submit (a
//   search would be sent with whatever is in the field, and push a history entry for nothing): the
//   keyboard is opened instead, by the system if it does that itself, by a focus cycle if not.
// - the Enter of the keyboard itself, while it is up: the user is done. The field's own handler
//   submits (TextInput onSubmit) and the keyboard is closed, with the focus kept on the field, so the
//   arrows move on from it to the results instead of going to a keyboard nobody is using.
//
// Only single-line text fields are affected; buttons, links and everything else keep their Enter.
// Not installed here: index.js does it when the app loads, before React renders, like webos/back.

const ENTER_KEY_CODE = 13;

// How long after the keyboard came up an Enter is still "the key that opened it" and not the user's.
const OPEN_GUARD_MS = 400;
// Wait for the system to open the keyboard by itself before opening it from the page.
const OPEN_DELAY_MS = 150;
// readOnly is put back after the focus event of the close has passed (a read-only field shows no keyboard).
const CLOSE_RESTORE_MS = 50;

const TEXT_TYPES = ['text', 'search', 'url', 'email', 'password', 'tel', 'number'];

const isTextField = (element) => (
    Boolean(element) &&
    element.tagName === 'INPUT' &&
    TEXT_TYPES.indexOf((element.getAttribute('type') || 'text').toLowerCase()) !== -1
);

const install = (win, { now = () => Date.now() } = {}) => {
    const doc = win.document;
    let visible = null;
    let shownAt = 0;

    // keyboardStateChange is the source of truth. PalmSystem.isKeyboardVisible stays true after the
    // system hides the keyboard on Back (measured in the emulator), so it only counts before the
    // first event.
    const isKeyboardVisible = () => (visible !== null ? visible : Boolean(win.PalmSystem && win.PalmSystem.isKeyboardVisible === true));

    const onKeyboardStateChange = (event) => {
        if (event.detail && typeof event.detail.visibility === 'boolean') {
            visible = event.detail.visibility;
            if (visible) {
                shownAt = now();
            }
        }
    };

    const consume = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    // Focus programmatically (a focus event the system turns into the keyboard).
    const openKeyboard = (field) => {
        win.setTimeout(() => {
            if (!isKeyboardVisible() && doc.activeElement === field) {
                field.blur();
                field.focus();
            }
        }, OPEN_DELAY_MS);
    };

    // blur() hides the keyboard; focusing again while the field is read-only brings the focus back
    // without bringing the keyboard back.
    const closeKeyboard = (field) => {
        if (!isKeyboardVisible() || !doc.contains(field) || doc.activeElement !== field) {
            return;
        }
        const readOnly = field.readOnly;
        field.blur();
        field.readOnly = true;
        field.focus();
        win.setTimeout(() => {
            field.readOnly = readOnly;
        }, CLOSE_RESTORE_MS);
    };

    const onKeyDown = (event) => {
        if (event.keyCode !== ENTER_KEY_CODE || event.isComposing || !isTextField(event.target)) {
            return;
        }
        const field = event.target;
        if (!isKeyboardVisible()) {
            consume(event);
            if (!event.repeat) {
                openKeyboard(field);
            }
            return;
        }
        if (now() - shownAt < OPEN_GUARD_MS) {
            // The Enter of the OK that opened the keyboard, arriving after it.
            consume(event);
            return;
        }
        if (!event.repeat) {
            // After the field's own handlers, which run later in this same event.
            win.setTimeout(() => closeKeyboard(field), 0);
        }
    };

    doc.addEventListener('keyboardStateChange', onKeyboardStateChange);
    win.addEventListener('keydown', onKeyDown, true);
    return () => {
        doc.removeEventListener('keyboardStateChange', onKeyboardStateChange);
        win.removeEventListener('keydown', onKeyDown, true);
    };
};

module.exports = {
    OPEN_GUARD_MS,
    OPEN_DELAY_MS,
    CLOSE_RESTORE_MS,
    isTextField,
    install,
};
