// The Ctx pulls of App.js, for the webOS TV (F8.7).
//
// App.js dispatches, at boot and on every `focus` of the window, PullAddonsFromAPI, PullUserFromAPI,
// SyncLibraryWithAPI and PullNotifications. On the TV the core (wasm2js, not optimized: "--no-crankshaft")
// handles one message at a time, and a title opened while the answers of these pulls were being read
// waited for them (F8.6 on the TV: 21 s for the meta, opened 8 s after the Board).
// - PullUserFromAPI and SyncLibraryWithAPI need a session: for a guest the core only answers them with a
//   "not logged in" error event, after a pass through every model. They are dropped while the profile is
//   known to be a guest (the last `ctx` the page got has no `auth`); with a session, or before any `ctx`, they
//   go as they came.
// - PullAddonsFromAPI, for a guest, upgrades the official addons of the profile to the versions bundled with
//   the core: it goes once per launch, when the app is idle (as below); with a session, as it came.
// - PullNotifications asks Cinemeta for the last episodes of every series of the library (~1.2 MB for 100
//   series; webos/lib/catalog-trim trims it). It is never sent right away: it waits until the app has been
//   idle for `idleMs` (no key, pointer or route change, and not in the Player), and goes at most once per
//   `intervalMs` (the core's own interval, REQUEST_LAST_VIDEOS_EVERY: 6 h), counted across launches
//   (localStorage), since the core only keeps its time when the notifications change. The repeated asks
//   (every focus of the window) only keep the one that is waiting.
// - The core's warm-up (transport.warmUp, webos/core/warm-up.patch): in wasm2js on the TV the first run of a
//   code path of the core costs hundreds of ms, and the first title opened paid it for every step. It runs
//   once per launch, once the core answered a `ctx` and the app has been idle for `warmUpIdleMs` (3 s), not in
//   the Player.
//
// wrap(transport, options) -> the transport with getState (to see the `ctx`) and dispatch wrapped.

const SESSION_PULLS = ['PullUserFromAPI', 'SyncLibraryWithAPI'];
const PULL_ADDONS = 'PullAddonsFromAPI';
const PULL_NOTIFICATIONS = 'PullNotifications';
const STORAGE_KEY = 'webos.pullNotifications.at';
const IDLE_MS = 20 * 1000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const WARM_UP_IDLE_MS = 3 * 1000;
const ACTIVITY_EVENTS = ['keydown', 'mousemove', 'wheel', 'hashchange'];

const ctxAction = (action) => (
    action && action.action === 'Ctx' && action.args && typeof action.args.action === 'string' ? action.args.action : null
);

const wrap = (transport, options = {}) => {
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const storage = options.storage || (win && win.localStorage) || null;
    const now = options.now || (() => Date.now());
    const idleMs = options.idleMs === undefined ? IDLE_MS : options.idleMs;
    const intervalMs = options.intervalMs === undefined ? INTERVAL_MS : options.intervalMs;
    const warmUpIdleMs = options.warmUpIdleMs === undefined ? WARM_UP_IDLE_MS : options.warmUpIdleMs;
    const setTimer = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimeout || ((id) => clearTimeout(id));

    // null: no ctx seen yet; true/false: whether the last one had a session.
    let signedIn = null;
    let lastActivity = now();
    let wanted = false;
    let timer = null;
    // The guest's PullAddonsFromAPI of this launch was taken (the next ones, every focus, are dropped).
    let addonsSent = false;

    const readPulledAt = () => {
        try {
            const value = Number(storage && storage.getItem(STORAGE_KEY));
            return Number.isFinite(value) && value > 0 ? value : 0;
        } catch (_e) {
            return 0;
        }
    };
    const writePulledAt = (value) => {
        try {
            if (storage) storage.setItem(STORAGE_KEY, String(value));
        } catch (_e) { /* storage full or unavailable: the next launch pulls again */ }
    };
    const inPlayer = () => !!win && !!win.location && /^#\/player\//.test(win.location.hash || '');

    // The idle tasks: PullNotifications (at most every intervalMs, across launches) and, for a guest, one
    // PullAddonsFromAPI per launch.
    let addonsWanted = false;
    // null: not yet asked (no ctx yet); true: waiting; false: done.
    let warmUpWanted = null;
    const warmUpDueIn = () => Math.max(lastActivity + warmUpIdleMs - now(), 0);
    const notificationsDueIn = () => Math.max(lastActivity + idleMs - now(), readPulledAt() + intervalMs - now(), 0);
    const addonsDueIn = () => Math.max(lastActivity + idleMs - now(), 0);
    const dueIn = () => Math.min(wanted ? notificationsDueIn() : Infinity, addonsWanted ? addonsDueIn() : Infinity, warmUpWanted ? warmUpDueIn() : Infinity);
    const schedule = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
        if (!wanted && !addonsWanted && !warmUpWanted) return;
        timer = setTimer(fire, dueIn());
    };
    function fire() {
        timer = null;
        if (inPlayer()) {
            // Watching a video: wait for the next idle stretch.
            lastActivity = now();
        } else {
            if (warmUpWanted && warmUpDueIn() === 0) {
                warmUpWanted = false;
                Promise.resolve(transport.warmUp()).catch(() => null);
            }
            if (addonsWanted && addonsDueIn() === 0) {
                addonsWanted = false;
                transport.dispatch({ action: 'Ctx', args: { action: PULL_ADDONS } });
            }
            if (wanted && notificationsDueIn() === 0) {
                wanted = false;
                writePulledAt(now());
                transport.dispatch({ action: 'Ctx', args: { action: PULL_NOTIFICATIONS } });
            }
        }
        schedule();
    }
    const onActivity = () => {
        lastActivity = now();
    };
    if (win && typeof win.addEventListener === 'function') {
        ACTIVITY_EVENTS.forEach((name) => win.addEventListener(name, onActivity, true));
    }

    const getState = (model) => {
        const answer = transport.getState(model);
        if (model !== 'ctx' || !answer || typeof answer.then !== 'function') return answer;
        return answer.then((state) => {
            const profile = state && state.profile;
            if (profile && typeof profile === 'object') signedIn = !!profile.auth;
            if (warmUpWanted === null && typeof transport.warmUp === 'function') {
                warmUpWanted = true;
                schedule();
            }
            return state;
        });
    };

    const dispatch = (action, ...rest) => {
        const name = ctxAction(action);
        if (name !== null && SESSION_PULLS.indexOf(name) !== -1 && signedIn === false) {
            return Promise.resolve();
        }
        if (name === PULL_ADDONS && signedIn === false) {
            if (!addonsSent) {
                addonsSent = true;
                addonsWanted = true;
                schedule();
            }
            return Promise.resolve();
        }
        if (name === PULL_NOTIFICATIONS) {
            if (!wanted) {
                wanted = true;
                schedule();
            }
            return Promise.resolve();
        }
        return transport.dispatch(action, ...rest);
    };

    return { ...transport, getState, dispatch };
};

module.exports = { wrap, STORAGE_KEY, IDLE_MS, INTERVAL_MS, WARM_UP_IDLE_MS };
