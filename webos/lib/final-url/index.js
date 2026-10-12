// The final URL of a stream link (F8.1): the address a debrid resolver redirects to. On the C8 the
// media pipeline takes minutes to start (or never starts) on a link that answers 302 (Torrentio's
// /resolve/… → the Real-Debrid file host), and about 6 s on the final link, so the Player hands the
// final one to WebOsVideo (webos/lib/player/withFinalUrl.js). API and measurements: README.md.
// The final link carries a token and the resolver link the debrid key: neither is ever logged.

const { hostOf } = require('../debrid-link');

const HTTP_URL = /^https?:\/\//i;
const ORIGIN = /^(https?:\/\/[^/?#]+)/i;
// How long the Player waits for the resolver before it gives the original link to the pipeline.
const RESOLVE_TIMEOUT_MS = 5000;
// How long a final URL is reused (debrid file links last hours; the resolver gives the same one).
const REUSE_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 32;
// localStorage key (read once, when the app starts): "off" loads the resolver's link and probes it,
// as before F8.1.
const FINAL_URL_KEY = 'webos.player.finalUrl';

const originOf = (url) => {
    const match = ORIGIN.exec(url);
    return match ? match[1].toLowerCase() : null;
};

// Whether a final URL can be kept for the next loads: a link without a redirect, or a redirect to
// another origin (the debrid file host). A redirect that stays on the resolver's origin is the
// resolver's own notice video (Torrentio's /videos/downloading_v2.mp4 while the debrid service
// caches the torrent, failed_access_v3.mp4, limits_exceeded…): it plays for this load only, so that
// opening the stream again asks the resolver again and gets the file once it is ready.
const isKeepable = (url, finalUrl) => finalUrl === url || originOf(finalUrl) !== originOf(url);

// One Range request for the first byte, following the redirects like the <video> would. The body is
// dropped as soon as the headers are in. Resolves { status, url } (url: where the request ended).
const requestFirstByte = (fetchImpl, url) => {
    let request;
    try {
        request = fetchImpl(url, { headers: { Range: 'bytes=0-0' }, credentials: 'omit' });
    } catch (error) {
        return Promise.reject(error);
    }
    return request.then((response) => {
        if (response.body && typeof response.body.cancel === 'function') {
            Promise.resolve(response.body.cancel()).catch(() => null);
        }
        return { status: response.status, url: typeof response.url === 'string' && response.url !== '' ? response.url : url };
    });
};

// options: fetch, now, setTimeout, clearTimeout, timeout, reuseMs, maxEntries (all optional).
const createFinalUrls = (options) => {
    const opts = options || {};
    const now = opts.now || Date.now;
    const schedule = opts.setTimeout || setTimeout;
    const cancel = opts.clearTimeout || clearTimeout;
    const timeout = typeof opts.timeout === 'number' ? opts.timeout : RESOLVE_TIMEOUT_MS;
    const reuseMs = typeof opts.reuseMs === 'number' ? opts.reuseMs : REUSE_MS;
    const maxEntries = opts.maxEntries || MAX_ENTRIES;
    const getFetch = () => opts.fetch || (typeof fetch === 'function' ? (input, init) => fetch(input, init) : null);
    // url -> { url: final URL, at }
    const entries = new Map();
    // url -> Promise of the request in flight ({ status, url } or null when it failed)
    const inFlight = new Map();

    // A final URL learned elsewhere (a header probe followed the same redirect). The same URL means a
    // link without a redirect: kept too, so its next load does not wait for a request. A redirect on
    // the resolver's own origin is not kept (isKeepable).
    const note = (url, finalUrl) => {
        if (typeof url !== 'string' || typeof finalUrl !== 'string' || !HTTP_URL.test(finalUrl) || !isKeepable(url, finalUrl)) return;
        entries.delete(url);
        entries.set(url, { url: finalUrl, at: now() });
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    };

    const peek = (url) => {
        const entry = entries.get(url);
        if (!entry) return null;
        if (now() - entry.at > reuseMs) {
            entries.delete(url);
            return null;
        }
        return entry.url;
    };

    // The link failed in the Player: the next load asks the resolver again.
    const forget = (url) => entries.delete(url);

    const request = (url, fetchImpl) => {
        let pending = inFlight.get(url);
        if (!pending) {
            pending = requestFirstByte(fetchImpl, url).then((answer) => {
                // An error status (an expired link, a refused key) is not a link to play: the
                // pipeline gets the original one and the Player's error layer explains it (F6.3).
                if (answer.status < 400) note(url, answer.url);
                return answer;
            }, () => null).then((answer) => {
                inFlight.delete(url);
                return answer;
            });
            inFlight.set(url, pending);
        }
        return pending;
    };

    // Resolves { url, source, ms, host } and never rejects: url is the final URL, or the original one
    // when there is no redirect or the resolver failed or took longer than the timeout. source:
    // 'known' (resolved before, or by a probe), 'redirect', 'direct' (no redirect), 'failed' (HTTP
    // error status or network), 'timeout' (the request goes on and its answer is kept), 'skipped'
    // (not an HTTP link, or no fetch). host: the final URL's host, for the log.
    const resolve = (url) => {
        const startedAt = now();
        const result = (finalUrl, source) => ({ url: finalUrl, source, ms: now() - startedAt, host: hostOf(finalUrl) });
        const fetchImpl = getFetch();
        if (typeof url !== 'string' || !HTTP_URL.test(url) || fetchImpl === null) return Promise.resolve(result(url, 'skipped'));
        const known = peek(url);
        if (known !== null) return Promise.resolve(result(known, 'known'));
        return new Promise((done) => {
            const timer = schedule(() => done(result(url, 'timeout')), timeout);
            request(url, fetchImpl).then((answer) => {
                cancel(timer);
                if (answer === null || answer.status >= 400) done(result(url, 'failed'));
                else if (answer.url !== url) done(result(answer.url, 'redirect'));
                else done(result(url, 'direct'));
            });
        });
    };

    return { resolve, note, peek, forget, clear: () => entries.clear() };
};

// Whether the localStorage key leaves the feature on. storage: localStorage-like, or null.
const readFinalUrlSetting = (storage) => {
    try {
        return !storage || storage.getItem(FINAL_URL_KEY) !== 'off';
    } catch (_error) {
        return true;
    }
};

// The one the app uses: the Player's load (withFinalUrl) and its probe (probe-cache) resolve through
// it, and the stream list's probes note what they followed.
let shared = null;
const getFinalUrls = () => {
    if (shared === null) shared = createFinalUrls();
    return shared;
};

module.exports = {
    RESOLVE_TIMEOUT_MS,
    REUSE_MS,
    MAX_ENTRIES,
    FINAL_URL_KEY,
    isKeepable,
    readFinalUrlSetting,
    createFinalUrls,
    getFinalUrls,
};
