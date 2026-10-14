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
// - PullNotifications, for a guest, asks Cinemeta for the last episodes of every series of the library (~1.2 MB
//   for 100 series; webos/lib/catalog-trim trims it). It is never sent right away: it waits until the app has
//   been idle for `idleMs` (no key, pointer or route change, and not in the Player), or at most `maxDeferMs`
//   (10 min) after it was asked even if the app never goes idle, and goes at most once per `intervalMs` (the
//   core's own interval, REQUEST_LAST_VIDEOS_EVERY: 6 h), counted across launches (localStorage, written once
//   the core took the dispatch; a time in the future, like a TV clock set back, counts as none), since the core
//   only keeps its time when the notifications change. The repeated asks (every focus of the window) only keep
//   the one that is waiting. With a session it goes as it came.
// - The core's warm-up (transport.warmUp, webos/core/warm-up.patch): in wasm2js on the TV the first run of a
//   code path of the core costs hundreds of ms, and the first title opened paid it for every step. It runs
//   once per launch, when the app is idle: `warmUpIdleMs` (3 s) without input after the Board shows its first
//   row (a `board` state with a Ready catalog), or after `warmUpFallbackMs` (20 s) from the first `ctx` when no
//   Board comes (a launch straight into another screen); not in the Player.
// The idle stretch starts, at the earliest, when the Board shows its first row: until then the app is busy
// loading (on the C8 the Board shows ~14 s after launch, and an idle stretch counted from the launch put the
// guest's PullAddonsFromAPI right where a title opened at +8 s had to wait for it).
// No timer is set for more than MAX_DELAY_MS (1 h): a longer wait is checked again then.
//
// wrap(transport, options) -> the transport with getState (to see the `ctx`) and dispatch wrapped.

const SESSION_PULLS = ['PullUserFromAPI', 'SyncLibraryWithAPI'];
const PULL_ADDONS = 'PullAddonsFromAPI';
const PULL_NOTIFICATIONS = 'PullNotifications';
const STORAGE_KEY = 'webos.pullNotifications.at';
const IDLE_MS = 20 * 1000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const WARM_UP_IDLE_MS = 3 * 1000;
const WARM_UP_FALLBACK_MS = 20 * 1000;
const MAX_DEFER_MS = 10 * 60 * 1000;
// setTimeout keeps its delay in 32 bits: a longer one fires at once.
const MAX_DELAY_MS = 60 * 60 * 1000;
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
    const warmUpFallbackMs = options.warmUpFallbackMs === undefined ? WARM_UP_FALLBACK_MS : options.warmUpFallbackMs;
    const maxDeferMs = options.maxDeferMs === undefined ? MAX_DEFER_MS : options.maxDeferMs;
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
            // A time in the future (the clock went back) would hold the pull until then: none instead.
            return Number.isFinite(value) && value > 0 && value <= now() ? value : 0;
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

    // The idle tasks: PullNotifications (at most every intervalMs, across launches), for a guest one
    // PullAddonsFromAPI per launch, and the warm-up.
    let addonsWanted = false;
    let wantedAt = 0;
    // The warm-up: null before the first ctx; 'board' waiting for the Board's first row (or the fallback);
    // true armed; false done.
    let warmUp = null;
    let ctxAt = 0;
    let boardShown = false;
    const warmUpDueIn = () => Math.max(warmUp === 'board' ? ctxAt + warmUpFallbackMs - now() : 0, lastActivity + warmUpIdleMs - now(), 0);
    const notificationsDueIn = () => Math.max(Math.min(lastActivity + idleMs, wantedAt + maxDeferMs) - now(), readPulledAt() + intervalMs - now(), 0);
    const addonsDueIn = () => Math.max(lastActivity + idleMs - now(), 0);
    const dueIn = () => Math.min(wanted ? notificationsDueIn() : Infinity, addonsWanted ? addonsDueIn() : Infinity, warmUp ? warmUpDueIn() : Infinity);
    const schedule = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
        if (!wanted && !addonsWanted && !warmUp) return;
        timer = setTimer(fire, Math.min(dueIn(), MAX_DELAY_MS));
    };
    function fire() {
        timer = null;
        if (inPlayer()) {
            // Watching a video: wait for the next idle stretch.
            lastActivity = now();
        } else {
            if (warmUp && warmUpDueIn() === 0) {
                warmUp = false;
                try {
                    Promise.resolve(transport.warmUp()).catch(() => null);
                } catch (_e) { /* the worker is gone: nothing to warm */ }
            }
            if (addonsWanted && addonsDueIn() === 0) {
                addonsWanted = false;
                transport.dispatch({ action: 'Ctx', args: { action: PULL_ADDONS } });
            }
            if (wanted && notificationsDueIn() === 0) {
                wanted = false;
                // The time counts once the core took it (a dispatch that fails is asked again on the next focus).
                Promise.resolve(transport.dispatch({ action: 'Ctx', args: { action: PULL_NOTIFICATIONS } }))
                    .then(() => writePulledAt(now()), () => null);
            }
        }
        schedule();
    }
    const onBoardShown = () => {
        if (boardShown) return;
        boardShown = true;
        lastActivity = Math.max(lastActivity, now());
        if (warmUp === 'board') warmUp = true;
        schedule();
    };
    const onActivity = () => {
        lastActivity = now();
    };
    if (win && typeof win.addEventListener === 'function') {
        ACTIVITY_EVENTS.forEach((name) => win.addEventListener(name, onActivity, true));
    }

    const getState = (model) => {
        const answer = transport.getState(model);
        if ((model !== 'ctx' && model !== 'board') || !answer || typeof answer.then !== 'function') return answer;
        return answer.then((state) => {
            if (model === 'board') {
                const catalogs = state && Array.isArray(state.catalogs) ? state.catalogs : [];
                if (catalogs.some((catalog) => catalog && catalog.content && catalog.content.type === 'Ready')) onBoardShown();
                return state;
            }
            const profile = state && state.profile;
            if (profile && typeof profile === 'object') signedIn = !!profile.auth;
            if (warmUp === null && typeof transport.warmUp === 'function') {
                warmUp = boardShown ? true : 'board';
                ctxAt = now();
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
        if (name === PULL_NOTIFICATIONS && signedIn !== true) {
            if (!wanted) {
                wanted = true;
                wantedAt = now();
                schedule();
            }
            return Promise.resolve();
        }
        return transport.dispatch(action, ...rest);
    };

    return { ...transport, getState, dispatch };
};

module.exports = { wrap, STORAGE_KEY, IDLE_MS, INTERVAL_MS, WARM_UP_IDLE_MS, WARM_UP_FALLBACK_MS, MAX_DEFER_MS, MAX_DELAY_MS };
