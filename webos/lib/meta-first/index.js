// The meta of a title before its streams, in the core worker (F8.7).
//
// Opening Details, the core asks the meta addons for the meta and the stream addons for the streams, and
// handles the answers in the order they arrive. When the streams come first (on the emulator the local test
// addon answers before Cinemeta; on the TV a fast debrid answer can too), the wasm2js core reads every
// stream (224 from Torrentio + a debrid: ~2 s on the C8 profile), and the page's next get_state serializes
// them all with their deep links (~2.5 s) before the meta can reach the screen.
//
// install(scope) wraps scope.fetch: the answer to a GET of …/stream/<type>/<video id>.json waits while the
// meta of the same title (…/meta/<type>/<id>.json, the video id being the id or "<id>:…") is on its way:
// until the core has read the meta and the page has taken the state that has it (its next
// getState('meta_details'), seen on the worker's messages), or `afterMetaMs` after the core read it, or
// `maxHoldMs` after the stream answer arrived, whichever comes first. A meta that fails (network error,
// another status) lets the streams go at once. Nothing else is held, and nothing changes in what the core
// gets: only the order of two answers, which was already the network's.

const META_PATH = /\/meta\/([^/?#]+)\/([^/?#]+)\.json(?:[?#]|$)/;
const STREAM_PATH = /\/stream\/([^/?#]+)\/([^/?#]+)\.json(?:[?#]|$)/;
const READ_STATUSES = [200, 201];
const MAX_HOLD_MS = 1500;
const AFTER_META_MS = 400;

const requestUrl = (input) => (typeof input === 'string' ? input : input && input.url);
const isGet = (input, init) => String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase() === 'GET';
const decode = (part) => {
    try {
        return decodeURIComponent(part);
    } catch (_e) {
        return part;
    }
};

export const install = (scope, options = {}) => {
    const inner = scope.fetch;
    if (typeof inner !== 'function' || scope.__webosMetaFirstInstalled) return;
    scope.__webosMetaFirstInstalled = true;
    const maxHoldMs = options.maxHoldMs === undefined ? MAX_HOLD_MS : options.maxHoldMs;
    const afterMetaMs = options.afterMetaMs === undefined ? AFTER_META_MS : options.afterMetaMs;
    const setTimer = (fn, ms) => scope.setTimeout(fn, ms);
    const clearTimer = (id) => scope.clearTimeout(id);

    // The metas on their way, by "<type>/<id>": { open, read, waiters, timer }.
    const metas = new Map();
    const release = (key, entry) => {
        if (!entry.open) return;
        entry.open = false;
        if (entry.timer !== null) clearTimer(entry.timer);
        entry.timer = null;
        if (metas.get(key) === entry) metas.delete(key);
        entry.waiters.splice(0).forEach((resolve) => resolve());
    };
    // The core read the meta (its handling runs in the microtasks after the text): wait for the page's
    // getState, at most afterMetaMs.
    const metaRead = (key, entry) => {
        if (!entry.open || entry.read) return;
        entry.read = true;
        entry.timer = setTimer(() => release(key, entry), afterMetaMs);
    };
    if (typeof scope.addEventListener === 'function') {
        scope.addEventListener('message', (event) => {
            const request = event && event.data && event.data.request;
            if (!request || !Array.isArray(request.path) || request.path[0] !== 'getState' || !request.args || request.args[0] !== 'meta_details') return;
            // The Bridge serves it in this same task: let the streams go right after.
            metas.forEach((entry, key) => {
                if (entry.read) setTimer(() => release(key, entry), 0);
            });
        });
    }

    const metaFetch = (key, answer) => {
        const previous = metas.get(key);
        if (previous) release(key, previous);
        const entry = { open: true, read: false, waiters: [], timer: null };
        metas.set(key, entry);
        return answer.then((response) => {
            if (!response || READ_STATUSES.indexOf(response.status) === -1 || typeof response.text !== 'function') {
                release(key, entry);
                return response;
            }
            const text = response.text;
            response.text = function () {
                return text.apply(response, arguments).then((body) => {
                    // After the microtasks in which the core handles it.
                    setTimer(() => metaRead(key, entry), 0);
                    return body;
                }, (error) => {
                    release(key, entry);
                    throw error;
                });
            };
            return response;
        }, (error) => {
            release(key, entry);
            throw error;
        });
    };

    const metaOf = (type, videoId) => {
        let found = null;
        metas.forEach((entry, key) => {
            const slash = key.indexOf('/');
            const id = key.slice(slash + 1);
            if (key.slice(0, slash) === type && (videoId === id || videoId.indexOf(`${id}:`) === 0)) found = [key, entry];
        });
        return found;
    };

    scope.fetch = function fetch(input, init) {
        const answer = inner.call(scope, input, init);
        const url = requestUrl(input);
        if (typeof url !== 'string' || !isGet(input, init)) return answer;
        const meta = META_PATH.exec(url);
        if (meta) return metaFetch(`${decode(meta[1])}/${decode(meta[2])}`, answer);
        const stream = STREAM_PATH.exec(url);
        if (!stream) return answer;
        const held = metaOf(decode(stream[1]), decode(stream[2]));
        if (!held) return answer;
        const entry = held[1];
        return answer.then((response) => {
            if (!entry.open) return response;
            return new Promise((resolve) => {
                const timer = setTimer(resolve, maxHoldMs);
                entry.waiters.push(() => {
                    clearTimer(timer);
                    resolve();
                });
            }).then(() => response);
        });
    };
};
