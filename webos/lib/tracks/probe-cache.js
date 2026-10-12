// Header probe results by stream URL (F5.4): the Player probes a stream once per session, and the
// hook reads the result synchronously (peek) to pick the initial audio track. A failed probe is
// not kept, so the next load of the same URL tries again; only the HTTP status of a refused
// request is (failureOf, F6.3), so the Player's error layer can say "expired" without asking again.

const { probe: probeHeader, createFetchReadRange, ProbeError } = require('../header-probe');
const { getFinalUrls } = require('../final-url');

const MAX_ENTRIES = 16;

// The header probe has no cancellation (and Chromium 53 no AbortController): once `isCancelled()`
// is true, the reads not yet made are refused, so the request in flight (one block, 256 KB) is the
// last one.
const probeCancellable = (url, isCancelled, createReadRange) => {
    const readRange = (createReadRange || createFetchReadRange)(url);
    return probeHeader((offset, length) => (isCancelled() ?
        Promise.reject(new ProbeError('NETWORK', 'cancelled')) :
        readRange(offset, length)));
};

// The Player's probe reads the final URL (F8.1): the resolver request is the same one the load waits
// for (webos/lib/final-url keeps one request per link in flight), so the debrid resolver is asked
// once per stream, and the probe's reads skip the redirect. finalUrls: injectable for the tests.
const probeFinalUrl = (url, isCancelled, finalUrls) => (finalUrls || getFinalUrls()).resolve(url)
    .then((resolved) => probeCancellable(resolved.url, isCancelled));

// probe(url, isCancelled) -> Promise<probe result>; injectable for the tests.
const createProbeCache = (options) => {
    const opts = options || {};
    const probe = opts.probe || probeCancellable;
    const maxEntries = opts.maxEntries || MAX_ENTRIES;
    const entries = new Map();
    const failures = new Map();

    const get = (url) => {
        const entry = entries.get(url);
        if (entry) {
            // Most recently used last: the first key is the one to drop.
            entries.delete(url);
            entries.set(url, entry);
            return entry.promise;
        }
        const created = { result: null, promise: null, cancelled: false };
        created.promise = Promise.resolve().then(() => probe(url, () => created.cancelled)).then((result) => {
            created.result = result;
            failures.delete(url);
            return result;
        }, (error) => {
            if (entries.get(url) === created) entries.delete(url);
            if (error && typeof error.httpStatus === 'number' && !created.cancelled) {
                failures.delete(url);
                failures.set(url, { httpStatus: error.httpStatus, at: Date.now() });
                while (failures.size > maxEntries) failures.delete(failures.keys().next().value);
            }
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

    // Stops a probe still running (the Player left the stream); it rejects and is not kept.
    const cancel = (url) => {
        const entry = entries.get(url);
        if (entry && entry.result === null) {
            entry.cancelled = true;
            entries.delete(url);
        }
    };

    // { httpStatus, at } of the last HTTP failure (403, 404…) of the URL's probe, or null.
    const failureOf = (url) => failures.get(url) || null;

    return { get, peek, failureOf, cancel, clear: () => { entries.clear(); failures.clear(); } };
};

module.exports = {
    MAX_ENTRIES,
    createProbeCache,
    probeCancellable,
    probeFinalUrl,
    // The one the app uses (the video decorator writes it, the useAudio hook reads it).
    probeCache: createProbeCache({ probe: probeFinalUrl }),
};
