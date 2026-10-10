// App lifecycle on webOS TV 4.x (F3.3). Framework free: React mounts it in LifecycleHandler.js.
//
// What the emulator (webOS 4.0, same WAM as the TV) does, measured:
// - HOME opens the launcher bar over the running app. The page only gets `blur`; it stays visible
//   (document.hidden false) and keeps running. The same goes for a system panel such as Settings.
//   There is no visibilitychange in these cases, so blur is not treated as "background".
// - A relaunch (launcher tile, ares-launch) of an app with handlesRelaunch does not reload the
//   page: `webOSRelaunch` is dispatched on `document`, with the launch parameters as `detail`.
//   Nothing brings the app to front by itself: that is PalmSystem.activate()'s job.
// - On a TV, an app that another app fully covers gets visibilitychange (hidden), as in any browser.
//
// What the app does with it:
// - hidden: pause the player (and any media); take a snapshot of focus and scroll. The system pauses
//   a playing <video> by itself when the page is hidden and resumes it when the app is back: a
//   guard (media.js) pauses that `play` again, in the background and for RESUME_GUARD_MS after
//   coming back, unless a key or click came first. Nothing resumes the media: that is the user's.
// - visible / relaunch / window focus: put the focus and scroll back if the system took them;
//   window.focus() so the App's own `focus` refresh (addons, user, library, notifications) runs
//   when the window had none.
// - relaunch: PalmSystem.activate() to bring the app to front, then open the deep link in the
//   launch parameters, if there is one (webos/lifecycle/launchParams.js).
// - Recent events are kept in window.__webosLifecycle for the emulator tests (bounded).

const { resolveDeepLink } = require('./launchParams');
const { pauseMedia, createPlayGuard } = require('./media');
const { capture, restore, describeElement } = require('./snapshot');

const MAX_LOG_ENTRIES = 50;
// How long after coming back a `play` nobody asked for is still paused again (see media.js).
const RESUME_GUARD_MS = 5000;

const createLifecycle = ({ window: win, onDeepLink, now = Date.now }) => {
    const doc = win.document;
    const log = [];
    let snapshot = null;
    let background = false;
    const playGuard = createPlayGuard(win);
    let started = false;

    const record = (type, detail = {}) => {
        log.push({ time: now(), type, hidden: doc.hidden === true, ...detail });
        if (log.length > MAX_LOG_ENTRIES) {
            log.shift();
        }
    };

    const takeSnapshot = () => {
        snapshot = capture(win);
        return snapshot;
    };

    const putBack = () => {
        if (snapshot === null) {
            return null;
        }
        const result = restore(win, snapshot);
        snapshot = null;
        return result;
    };

    const activate = () => {
        const palm = win.PalmSystem;
        let activated = false;
        try {
            if (palm && typeof palm.activate === 'function') {
                palm.activate();
                activated = true;
            }
        } catch (_) {
            activated = false;
        }
        try {
            if (typeof win.focus === 'function') {
                win.focus();
            }
        } catch (_) {
            // no window focus to take
        }
        return activated;
    };

    const goBackground = (reason) => {
        if (background) {
            return;
        }
        background = true;
        const taken = takeSnapshot();
        const paused = pauseMedia(doc).length;
        playGuard.arm();
        record('background', { reason, paused, focus: describeElement(taken.focus), hash: taken.hash });
    };

    const comeForeground = (reason) => {
        if (!background) {
            return;
        }
        background = false;
        playGuard.arm(RESUME_GUARD_MS);
        if (typeof win.focus === 'function' && typeof doc.hasFocus === 'function' && !doc.hasFocus()) {
            win.focus();
        }
        record('foreground', { reason, restored: putBack() });
    };

    const onVisibilityChange = () => {
        if (doc.hidden) {
            goBackground('visibilitychange');
        } else {
            comeForeground('visibilitychange');
        }
    };

    const onRelaunch = (event) => {
        const path = resolveDeepLink(event && event.detail);
        const wasBackground = background;
        const activated = activate();
        // The relaunch brings the app to the foreground even if no visibilitychange followed.
        if (wasBackground) {
            comeForeground('relaunch');
        }
        let restored = null;
        if (path === null) {
            restored = restore(win, snapshot || capture(win));
            snapshot = null;
        } else {
            snapshot = null;
            onDeepLink(path);
        }
        record('relaunch', { activated, deepLink: path, restored });
    };

    // The window lost the focus (HOME bar, a system panel): remember where the user was, so that
    // the focus can be put back if the system moved it.
    const onBlur = () => {
        if (!background) {
            takeSnapshot();
        }
        record('blur');
    };

    const onFocus = () => {
        if (!background) {
            const restored = putBack();
            record('focus', { restored });
        }
    };

    const start = () => {
        if (started) {
            return;
        }
        started = true;
        doc.addEventListener('visibilitychange', onVisibilityChange);
        doc.addEventListener('webOSRelaunch', onRelaunch);
        win.addEventListener('blur', onBlur);
        win.addEventListener('focus', onFocus);
        win.__webosLifecycle = {
            get events() {
                return log.slice();
            },
            get background() {
                return background;
            },
        };
        // Cold start with a deep link (voice search, "open this title" from the launcher).
        const path = resolveDeepLink(win.PalmSystem && win.PalmSystem.launchParams);
        if (path !== null) {
            onDeepLink(path);
            record('launch', { deepLink: path });
        }
        if (doc.hidden) {
            goBackground('start');
        }
    };

    const stop = () => {
        if (!started) {
            return;
        }
        started = false;
        doc.removeEventListener('visibilitychange', onVisibilityChange);
        doc.removeEventListener('webOSRelaunch', onRelaunch);
        win.removeEventListener('blur', onBlur);
        win.removeEventListener('focus', onFocus);
        playGuard.disarm();
        background = false;
        snapshot = null;
    };

    return { start, stop };
};

module.exports = createLifecycle;
