// Debrid links that do not play (F6.3): what is wrong with the link behind a Player error, in words
// the user can act on. The <video> only says "not supported" or "network" (the C8's element hides the
// HTTP status), so after a critical Player error the stream URL is checked once: from what the
// stream list's probe (F6.2) already learned when it can, otherwise with one 1-byte Range request
// that follows the debrid redirect (302) like the <video> does. API and behaviour: README.md.
// The URL carries the user's debrid key (Torrentio puts it in the path): it is never logged or
// stored in a result, only its host.
// Torrentio does not fail with an HTTP error when the debrid service refuses or is not ready: its
// resolver redirects to a notice video of its own (/videos/failed_access_v3.mp4…), a valid MP4 that
// answers 206. Those are recognised by the URL (F8.4) and get the message the video would show.

const HTTP_URL = /^https?:\/\//i;
// Error code of stremio-video (src/error.js) for "the TV could not decode this": the bytes arrived,
// so it is not a link problem. (The emulator reports a dead network as 83 "not supported", not as
// the 81 "network" of the HTML spec, so the codes cannot tell the two apart.)
const MEDIA_ERR_DECODE = 82;

// How long the answer of an earlier check or list probe still explains a Player error.
const REUSE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_ENTRIES = 16;
// A host the app itself talks to and whose certificate the Chromium 53 accepts (not Let's Encrypt):
// when it answers, the TV has internet, so a link host that does not is the problem, not the network.
const CONTROL_URL = 'https://v3-cinemeta.strem.io/manifest.json';

// kind -> the message (i18n key, English text: the translations package has no key for these) and
// the next step. `{{status}}` is the HTTP status.
const PROBLEMS = {
    expired: {
        key: 'WEBOS_LINK_EXPIRED',
        message: 'This link has expired or was refused (HTTP {{status}}).',
        hintKey: 'WEBOS_LINK_EXPIRED_HINT',
        hint: 'Go back and open the stream list again for a new link, or pick another stream.',
    },
    unauthorized: {
        key: 'WEBOS_LINK_UNAUTHORIZED',
        message: 'The debrid service did not accept the access key of this link (HTTP {{status}}).',
        hintKey: 'WEBOS_LINK_UNAUTHORIZED_HINT',
        hint: 'Check the key in the configuration of the addon, or pick another stream.',
    },
    'not-found': {
        key: 'WEBOS_LINK_NOT_FOUND',
        message: 'The file is no longer available at this link (HTTP {{status}}).',
        hintKey: 'WEBOS_LINK_NOT_FOUND_HINT',
        hint: 'It may have been removed from the debrid service. Pick another stream.',
    },
    'rate-limited': {
        key: 'WEBOS_LINK_RATE_LIMITED',
        message: 'The debrid service is limiting requests right now (HTTP {{status}}).',
        hintKey: 'WEBOS_LINK_RATE_LIMITED_HINT',
        hint: 'Wait a moment, then go back and open the stream again.',
    },
    'server-error': {
        key: 'WEBOS_LINK_SERVER_ERROR',
        message: 'The server of this link is having problems (HTTP {{status}}).',
        hintKey: 'WEBOS_LINK_SERVER_ERROR_HINT',
        hint: 'Go back and open the stream again in a while, or pick another stream.',
    },
    refused: {
        key: 'WEBOS_LINK_REFUSED',
        message: 'The server of this link refused the request (HTTP {{status}}).',
        hintKey: 'WEBOS_LINK_REFUSED_HINT',
        hint: 'Pick another stream.',
    },
    network: {
        key: 'WEBOS_LINK_NETWORK',
        message: 'Could not reach the server of this link.',
        hintKey: 'WEBOS_LINK_NETWORK_HINT',
        hint: 'Check the internet connection of the TV, then go back and open the stream again.',
    },
    host: {
        key: 'WEBOS_LINK_HOST',
        message: 'The TV could not connect to the server of this link.',
        hintKey: 'WEBOS_LINK_HOST_HINT',
        hint: 'Its certificate may not be accepted by this TV, or the server is down. Pick another stream.',
    },
    timeout: {
        key: 'WEBOS_LINK_TIMEOUT',
        message: 'The server of this link took too long to answer.',
        hintKey: 'WEBOS_LINK_TIMEOUT_HINT',
        hint: 'Go back and open the stream again in a while, or pick another stream.',
    },
    // Torrentio notices (noticeOf): what its video says, and the next step.
    'notice-downloading': {
        key: 'WEBOS_LINK_NOTICE_DOWNLOADING',
        message: 'The debrid service is still downloading this file: it was not in its cache.',
        hintKey: 'WEBOS_LINK_NOTICE_DOWNLOADING_HINT',
        hint: 'Wait a few minutes and open the stream again, or pick a stream that is already cached.',
    },
    'notice-download-failed': {
        key: 'WEBOS_LINK_NOTICE_DOWNLOAD_FAILED',
        message: 'The debrid service could not download this file.',
        hintKey: 'WEBOS_LINK_NOTICE_DOWNLOAD_FAILED_HINT',
        hint: 'Pick another stream.',
    },
    'notice-access-denied': {
        key: 'WEBOS_LINK_NOTICE_ACCESS_DENIED',
        message: 'The debrid service denied access to the account set in the addon.',
        hintKey: 'WEBOS_LINK_NOTICE_ACCESS_DENIED_HINT',
        hint: 'Check the API key and the subscription of the debrid account, configure the addon again, and reopen the stream.',
    },
    'notice-access-blocked': {
        key: 'WEBOS_LINK_NOTICE_ACCESS_BLOCKED',
        message: 'The debrid service blocked the access of the addon to the account.',
        hintKey: 'WEBOS_LINK_NOTICE_ACCESS_BLOCKED_HINT',
        hint: 'Check the account on the site of the debrid service, then configure the addon again.',
    },
    'notice-archive': {
        key: 'WEBOS_LINK_NOTICE_ARCHIVE',
        message: 'On the debrid service this file is a compressed archive (RAR), which cannot be played.',
        hintKey: 'WEBOS_LINK_NOTICE_ARCHIVE_HINT',
        hint: 'Pick another stream.',
    },
    'notice-too-big': {
        key: 'WEBOS_LINK_NOTICE_TOO_BIG',
        message: 'This torrent is too big for the debrid service.',
        hintKey: 'WEBOS_LINK_NOTICE_TOO_BIG_HINT',
        hint: 'Pick another stream.',
    },
    'notice-opening-failed': {
        key: 'WEBOS_LINK_NOTICE_OPENING_FAILED',
        message: 'The debrid service could not open this torrent.',
        hintKey: 'WEBOS_LINK_NOTICE_OPENING_FAILED_HINT',
        hint: 'Pick another stream.',
    },
    'notice-removed': {
        key: 'WEBOS_LINK_NOTICE_REMOVED',
        message: 'The debrid service removed this file after a copyright claim.',
        hintKey: 'WEBOS_LINK_NOTICE_REMOVED_HINT',
        hint: 'Pick another stream.',
    },
    'notice-limits': {
        key: 'WEBOS_LINK_NOTICE_LIMITS',
        message: 'The debrid account reached one of its limits (active downloads or traffic).',
        hintKey: 'WEBOS_LINK_NOTICE_LIMITS_HINT',
        hint: 'Free some downloads on the site of the debrid service or wait a while, then open the stream again.',
    },
    'notice-unavailable': {
        key: 'WEBOS_LINK_NOTICE_UNAVAILABLE',
        message: 'The debrid service is unavailable right now.',
        hintKey: 'WEBOS_LINK_NOTICE_UNAVAILABLE_HINT',
        hint: 'Open the stream again in a while.',
    },
    'notice-addon-error': {
        key: 'WEBOS_LINK_NOTICE_ADDON_ERROR',
        message: 'The addon could not get this stream from the debrid service.',
        hintKey: 'WEBOS_LINK_NOTICE_ADDON_ERROR_HINT',
        hint: 'Open the stream again in a while, or pick another stream.',
    },
};

// Torrentio's notice videos (torrentio-scraper, addon/moch/static.js: `<name>_v<n>.mp4` under
// /videos/) -> kind. The version suffix changes over time, so only the name is matched.
const TORRENTIO_NOTICES = {
    downloading: 'notice-downloading',
    download_failed: 'notice-download-failed',
    failed_access: 'notice-access-denied',
    blocked_access: 'notice-access-blocked',
    failed_rar: 'notice-archive',
    failed_too_big: 'notice-too-big',
    failed_opening: 'notice-opening-failed',
    failed_infringement: 'notice-removed',
    limits_exceeded: 'notice-limits',
    failed_unavailable: 'notice-unavailable',
    failed_unexpected: 'notice-addon-error',
};
const NOTICE_PATH = /^https?:\/\/[^/?#]+(?:\/[^?#]*)?\/videos\/([a-z_]+?)_v\d+\.mp4(?:[?#]|$)/i;

// The kind of a Torrentio notice video URL, or null. An unknown `failed_*` notice (a newer one) is
// still a refusal of the addon, told as its unexpected error.
const noticeOf = (url) => {
    const match = typeof url === 'string' ? NOTICE_PATH.exec(url) : null;
    if (match === null) return null;
    const name = match[1].toLowerCase();
    if (TORRENTIO_NOTICES[name]) return TORRENTIO_NOTICES[name];
    return name.indexOf('failed_') === 0 ? 'notice-addon-error' : null;
};

// HTTP status of a failed answer -> kind. 403 and 410 are what an expired debrid link answers.
const kindOfStatus = (status) => {
    if (status === 403 || status === 410) return 'expired';
    if (status === 401) return 'unauthorized';
    if (status === 404) return 'not-found';
    if (status === 429) return 'rate-limited';
    if (status >= 500) return 'server-error';
    if (status >= 400) return 'refused';
    return null;
};

const hostOf = (url) => {
    const match = /^https?:\/\/([^/?#]+)/i.exec(url);
    return match ? match[1].replace(/^[^@]*@/, '') : null;
};

const urlOf = (stream) => (stream !== null && typeof stream === 'object' && typeof stream.url === 'string' && HTTP_URL.test(stream.url) ? stream.url : null);

const headersOf = (stream) => {
    const hints = stream && stream.behaviorHints;
    const headers = hints && hints.proxyHeaders && hints.proxyHeaders.request;
    return headers !== null && typeof headers === 'object' ? headers : {};
};

const interpolate = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_match, name) => (values[name] === undefined ? '' : String(values[name])));

// The i18n key, the interpolation values and the English default of the message and of the hint, or
// null when the link is fine / unknown (the Player keeps its own message).
const describe = (diagnosis) => {
    const problem = diagnosis ? PROBLEMS[diagnosis.kind] : null;
    if (!problem) return null;
    const values = { status: diagnosis.status };
    return {
        kind: diagnosis.kind,
        key: problem.key,
        values,
        message: interpolate(problem.message, values),
        hintKey: problem.hintKey,
        hint: problem.hint,
    };
};

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// One Range request for the first byte. It follows redirects (the debrid resolver answers 302 to the
// file host) and drops the body as soon as the headers are in, so a server that ignores Range does
// not send the whole video. Resolves { status, redirected, host, notice } or rejects with { kind }.
// `notice`: the final URL is a Torrentio notice video (noticeOf); the URL itself is not kept.
const requestFirstByte = (fetchImpl, url, headers, timeout) => new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
        settled = true;
        reject({ kind: 'timeout' });
    }, timeout);
    const done = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
    };
    let request;
    try {
        request = fetchImpl(url, { headers: Object.assign({}, headers, { Range: 'bytes=0-0' }), credentials: 'omit' });
    } catch (_error) {
        done(reject, { kind: 'network' });
        return;
    }
    request.then((response) => {
        if (response.body && typeof response.body.cancel === 'function') {
            Promise.resolve(response.body.cancel()).catch(() => null);
        }
        done(resolve, {
            status: response.status,
            redirected: response.redirected === true,
            host: hostOf(response.url || url),
            notice: noticeOf(response.url || url),
        });
    }, () => done(reject, { kind: 'network' }));
});

// Whether the host answers at all, when the Range request failed: fetch() rejects the same way for a
// dead network and for a host without CORS headers (the Range header needs a preflight). A HEAD in
// no-cors mode needs none and has no body to download: it resolves (an opaque response) as soon as the
// host answers, and rejects when it cannot be reached.
const isReachable = (fetchImpl, url, timeout) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    const done = (value) => {
        clearTimeout(timer);
        resolve(value);
    };
    try {
        fetchImpl(url, { method: 'HEAD', mode: 'no-cors', credentials: 'omit' }).then(() => done(true), () => done(false));
    } catch (_error) {
        done(false);
    }
});

// options.fetch, options.now, options.timeout, options.controlUrl; options.getQueue (the F6.2 list probe queue) and
// options.getFailure(url) (the Player's own probe, F5.4 probe-cache) are loaded on first use.
const createDiagnoser = (options) => {
    const opts = options || {};
    const now = opts.now || Date.now;
    const timeout = opts.timeout || REQUEST_TIMEOUT_MS;
    const getFetch = () => opts.fetch || (typeof fetch === 'function' ? (input, init) => fetch(input, init) : null);
    const getQueue = opts.getQueue || (() => require('../stream-ranking').getProbeQueue());
    const getFailure = opts.getFailure || ((url) => require('../tracks/probe-cache').probeCache.failureOf(url));
    const controlUrl = opts.controlUrl || CONTROL_URL;
    const results = new Map();

    const remember = (url, diagnosis) => {
        results.delete(url);
        results.set(url, diagnosis);
        while (results.size > MAX_ENTRIES) results.delete(results.keys().next().value);
        return diagnosis;
    };

    // A failed HTTP answer of an earlier probe of this link, still recent: the list's probe (F6.2
    // queue) or the Player's own (F5.4 probe cache, which has just failed on a dead link).
    const failedBefore = (url) => {
        const found = [];
        try {
            const entry = getQueue().get(url);
            if (entry !== null && entry.status === 'failed' && typeof entry.httpStatus === 'number') found.push({ status: entry.httpStatus, at: entry.finishedAt, source: 'list-probe' });
            const failure = getFailure(url);
            if (failure) found.push({ status: failure.httpStatus, at: failure.at, source: 'player-probe' });
        } catch (_error) {
            return null;
        }
        const recent = found.filter((failure) => now() - failure.at <= REUSE_MS && kindOfStatus(failure.status) !== null);
        recent.sort((a, b) => b.at - a.at);
        return recent.length === 0 ? null : recent[0];
    };

    const fromProbe = (url) => {
        const failure = failedBefore(url);
        return failure === null ? null : { kind: kindOfStatus(failure.status), status: failure.status, source: failure.source, redirected: null, host: hostOf(url), at: failure.at };
    };

    // stream: the one that failed. playerCode: the stremio-video error code, to tell a dead link
    // from a file the TV cannot decode. Resolves { kind, status, source, redirected, host } with
    // kind 'ok' (the link answers: the Player's own message stands), 'unknown' or a PROBLEMS key.
    const diagnose = (stream, playerCode) => {
        const url = urlOf(stream);
        if (url === null) return Promise.resolve({ kind: 'unknown', status: null, source: 'none', redirected: null, host: null });
        // The stream (or the link the Player loaded after resolving the redirect) is the notice itself.
        const notice = noticeOf(url);
        if (notice !== null) return Promise.resolve({ kind: notice, status: null, source: 'url', redirected: false, host: hostOf(url) });
        if (playerCode === MEDIA_ERR_DECODE) {
            // The TV got the bytes and failed to decode them: not a link problem, no request needed.
            return Promise.resolve({ kind: 'ok', status: null, source: 'player', redirected: null, host: hostOf(url) });
        }

        const probed = fromProbe(url);
        // Not kept in `results`: a later probe of the same URL can succeed (a 429 that passed).
        if (probed !== null) return Promise.resolve(probed);
        const known = results.get(url);
        if (known && now() - known.at <= REUSE_MS) return Promise.resolve(known);

        const fetchImpl = getFetch();
        if (fetchImpl === null) return Promise.resolve({ kind: 'unknown', status: null, source: 'none', redirected: null, host: hostOf(url) });
        return requestFirstByte(fetchImpl, url, headersOf(stream), timeout).then((answer) => {
            const kind = (answer.notice !== null && kindOfStatus(answer.status) === null ? answer.notice : null) || kindOfStatus(answer.status) || 'ok';
            return remember(url, { kind, status: answer.status, source: 'request', redirected: answer.redirected, host: answer.host, at: now() });
        }, (failure) => {
            const failed = (kind) => ({ kind, status: null, source: 'request', redirected: null, host: hostOf(url), at: now() });
            if (failure.kind === 'timeout' || isOffline()) return failed(failure.kind);
            // Reachable but unreadable (no CORS): the status stays unknown, the Player message stands.
            return isReachable(fetchImpl, url, timeout).then((reachable) => {
                if (reachable) return failed('unknown');
                // fetch() also rejects a certificate this Chromium refuses (Let's Encrypt) while the
                // <video> plays it: only a TV that reaches no host at all is "without internet".
                return isReachable(fetchImpl, controlUrl, timeout).then((online) => failed(online ? 'host' : 'network'));
            });
        });
    };

    return { diagnose, forget: (url) => results.delete(url), clear: () => results.clear() };
};

// The stream the Player loaded last: the error layer is rendered after the video unloaded, when the
// Player state no longer has the stream.
let lastStream = null;
let diagnoser = null;
const rememberStream = (stream) => {
    lastStream = stream !== undefined ? stream : null;
    // A new load of the link starts from what the link answers now, not from an earlier diagnosis.
    const url = urlOf(lastStream);
    if (diagnoser !== null && url !== null) diagnoser.forget(url);
};
const lastLoadedStream = () => lastStream;

const diagnose = (stream, playerCode) => {
    if (diagnoser === null) diagnoser = createDiagnoser();
    return diagnoser.diagnose(stream, playerCode);
};

module.exports = {
    PROBLEMS,
    REUSE_MS,
    CONTROL_URL,
    kindOfStatus,
    noticeOf,
    describe,
    hostOf,
    urlOf,
    createDiagnoser,
    diagnose,
    rememberStream,
    lastLoadedStream,
};
