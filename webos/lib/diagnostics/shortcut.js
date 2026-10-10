// Remote-control shortcut that opens the diagnostics screen from any route (F3.6): the four colour
// keys in order, RED GREEN YELLOW BLUE, each within a couple of seconds of the previous one. The
// navigation bar is not reachable with the arrows yet (F4.1) and the Phase 8 session on the TV
// must not depend on it. A wrong key restarts the sequence; the keys are not consumed (no
// preventDefault), so whatever else listens to them still works.

// keyCode of the webOS colour keys (the same ones the emulator remote sends, tools/remote.mjs).
const COLOR_KEYS = { RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };
const SEQUENCE = [COLOR_KEYS.RED, COLOR_KEYS.GREEN, COLOR_KEYS.YELLOW, COLOR_KEYS.BLUE];
const SEQUENCE_GAP_MS = 2500;
const DIAGNOSTICS_HASH = '#/webos-diagnostics';

// Returns onKey(keyCode, at): true when the key completes the sequence. `at` is a millisecond
// timestamp (the event's timeStamp or Date.now()).
const createSequenceMatcher = (sequence, gapMs) => {
    let position = 0;
    let last = 0;
    return (keyCode, at) => {
        if (position > 0 && at - last > gapMs) position = 0;
        last = at;
        if (keyCode === sequence[position]) {
            position += 1;
        } else {
            position = keyCode === sequence[0] ? 1 : 0;
        }
        if (position === sequence.length) {
            position = 0;
            return true;
        }
        return false;
    };
};

// Starts listening on `win` (capture phase on window). Opens the screen by setting the hash of the
// HashRouter, so Back returns to where the user was. Returns a function that stops listening.
const installDiagnosticsShortcut = (win, options) => {
    const target = win || (typeof window !== 'undefined' ? window : null);
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    const settings = options || {};
    const matcher = createSequenceMatcher(settings.sequence || SEQUENCE, settings.gapMs || SEQUENCE_GAP_MS);
    const open = settings.open || (() => {
        if (target.location.hash !== DIAGNOSTICS_HASH) target.location.hash = DIAGNOSTICS_HASH;
    });
    const onKeyDown = (event) => {
        if (event.repeat) return;
        if (matcher(event.keyCode, Date.now())) open();
    };
    target.addEventListener('keydown', onKeyDown, true);
    return () => target.removeEventListener('keydown', onKeyDown, true);
};

module.exports = {
    COLOR_KEYS,
    SEQUENCE,
    SEQUENCE_GAP_MS,
    DIAGNOSTICS_HASH,
    createSequenceMatcher,
    installDiagnosticsShortcut,
};
