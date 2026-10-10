// Header probe results by stream URL (F5.4): the Player probes a stream once per session, and the
// hook reads the result synchronously (peek) to pick the initial audio track. A failed probe is
// not kept, so the next load of the same URL tries again.

const { probeUrl } = require('../header-probe');

const MAX_ENTRIES = 16;

// probe(url) -> Promise<probe result>; injectable for the tests.
const createProbeCache = (options) => {
    const opts = options || {};
    const probe = opts.probe || ((url) => probeUrl(url));
    const maxEntries = opts.maxEntries || MAX_ENTRIES;
    const entries = new Map();

    const get = (url) => {
        const entry = entries.get(url);
        if (entry) {
            // Most recently used last: the first key is the one to drop.
            entries.delete(url);
            entries.set(url, entry);
            return entry.promise;
        }
        const created = { result: null, promise: null };
        created.promise = Promise.resolve().then(() => probe(url)).then((result) => {
            created.result = result;
            return result;
        }, (error) => {
            if (entries.get(url) === created) entries.delete(url);
            throw error;
        });
        entries.set(url, created);
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
        return created.promise;
    };

    const peek = (url) => {
        const entry = entries.get(url);
        return entry ? entry.result : null;
    };

    return { get, peek, clear: () => entries.clear() };
};

module.exports = {
    MAX_ENTRIES,
    createProbeCache,
    // The one the app uses (the video decorator writes it, the useAudio hook reads it).
    probeCache: createProbeCache(),
};
