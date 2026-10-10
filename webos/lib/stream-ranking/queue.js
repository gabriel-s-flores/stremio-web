// On-demand header probes for the streams list (F6.2): a cache by URL and a concurrency limit, so
// opening the list never waits for the network and each file is read at most once per session.
// Entries: queued -> running -> done | failed. Failures are kept too (no retry on every focus).

// What one probe may spend in the list. The usual cost is 1 to 3 requests of 256 KB (see
// ../header-probe/README.md, "Custo típico"); past these limits the probe gives up with LIMIT.
const LIST_PROBE_OPTIONS = {
    maxBytes: 2 * 1024 * 1024,
    maxRequests: 8,
    timeout: 10000,
};

// options.probe(url, stream) -> Promise<probe output v1>; concurrency (2); maxEntries (64): finished
// entries beyond it are dropped, oldest first.
const createProbeQueue = (options) => {
    const settings = options || {};
    const run = settings.probe;
    const concurrency = settings.concurrency || 2;
    const maxEntries = settings.maxEntries || 64;
    const entries = new Map();
    const waiting = [];
    const listeners = [];
    let running = 0;

    const emit = (url) => {
        listeners.slice().forEach((listener) => listener(url));
    };

    const trim = () => {
        if (entries.size <= maxEntries) return;
        const finished = [];
        entries.forEach((entry, url) => {
            if (entry.status === 'done' || entry.status === 'failed') finished.push(url);
        });
        finished.slice(0, entries.size - maxEntries).forEach((url) => entries.delete(url));
    };

    const finish = (url, entry, status, value) => {
        running -= 1;
        entry.status = status;
        if (status === 'done') entry.result = value;
        else entry.error = value && value.code ? value.code : String(value && value.message || value);
        entry.finishedAt = Date.now();
        trim();
        emit(url);
        pump();
    };

    function pump() {
        while (running < concurrency && waiting.length > 0) {
            const url = waiting.shift();
            const entry = entries.get(url);
            if (entry === undefined || entry.status !== 'queued') continue;
            entry.status = 'running';
            entry.startedAt = Date.now();
            running += 1;
            let promise;
            try {
                promise = Promise.resolve(run(url, entry.stream));
            } catch (error) {
                promise = Promise.reject(error);
            }
            promise.then((result) => finish(url, entry, 'done', result), (error) => finish(url, entry, 'failed', error));
        }
    }

    // Asks for the probe of `stream` (its URL is the cache key). `first`: ahead of the queue (the
    // stream the user is on). Does nothing when the URL is already known.
    const request = (url, stream, first) => {
        const known = entries.get(url);
        if (known !== undefined) {
            if (first && known.status === 'queued') {
                const index = waiting.indexOf(url);
                if (index > 0) {
                    waiting.splice(index, 1);
                    waiting.unshift(url);
                }
            }
            return;
        }
        entries.set(url, { status: 'queued', stream, result: null, error: null, requestedAt: Date.now() });
        if (first) waiting.unshift(url);
        else waiting.push(url);
        pump();
    };

    // Drops the queued (not started) requests for `urls`; they can be asked for again later.
    const cancel = (urls) => {
        urls.forEach((url) => {
            const entry = entries.get(url);
            if (entry !== undefined && entry.status === 'queued') {
                entries.delete(url);
                const index = waiting.indexOf(url);
                if (index !== -1) waiting.splice(index, 1);
            }
        });
    };

    const get = (url) => entries.get(url) || null;

    const resultOf = (url) => {
        const entry = entries.get(url);
        return entry !== undefined && entry.status === 'done' ? entry.result : null;
    };

    const subscribe = (listener) => {
        listeners.push(listener);
        return () => {
            const index = listeners.indexOf(listener);
            if (index !== -1) listeners.splice(index, 1);
        };
    };

    const stats = () => {
        const counts = { queued: 0, running: 0, done: 0, failed: 0 };
        entries.forEach((entry) => {
            counts[entry.status] += 1;
        });
        return counts;
    };

    return { request, cancel, get, resultOf, subscribe, stats, has: (url) => entries.has(url) };
};

module.exports = { LIST_PROBE_OPTIONS, createProbeQueue };
