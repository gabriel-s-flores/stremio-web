// Streams list ordered and labelled by what the LG C8 plays (F6.2, plan Phase 6 item 2): the C8
// rules (F5.3) on the stream name at once, refined by the header probe (F5.2) on demand. API and
// behaviour: see README.md in this folder.

const rank = require('./rank');
const queue = require('./queue');
const display = require('./display');
const elements = require('./elements');

// How the list asks for probes (see README.md, "Probe sob demanda").
const LIST_SETTINGS = {
    // Probes started for the top of the list (the items visible when it opens)…
    initialProbes: 4,
    // …and at most this many automatic probes per list (each result can reorder the top).
    maxAutoProbes: 8,
    // Wait after the list shows up before the first probes, so they never delay it.
    initialDelay: 1000,
    // Focus dwell before probing the focused item (scrolling through the list probes nothing).
    focusDelay: 600,
};

// localStorage['webos.streamProbe'] = 'off' turns the probes off in the list (names only).
const PROBE_SWITCH_KEY = 'webos.streamProbe';

const probesEnabled = () => {
    try {
        return typeof localStorage === 'undefined' || localStorage.getItem(PROBE_SWITCH_KEY) !== 'off';
    } catch (_error) {
        return true;
    }
};

// The rules and the probe are required on first use, not when the bundle starts (no extra work
// at boot: the list is the first thing that needs them).
let rules = null;
let ranker = null;
let probeQueue = null;

const getRules = () => {
    if (rules === null) rules = require('../c8-rules');
    return rules;
};

const getRanker = () => {
    if (ranker === null) ranker = rank.createRanker({ rules: getRules() });
    return ranker;
};

// fetch() for the probe whose transfers can be stopped (Chromium 53 has no AbortController): the
// body readers the header probe takes are tracked, and cancel() cancels them, so the connection
// closes and the probe fails at once instead of finishing its 256 KB reads.
const createCancellableFetch = (fetchImpl) => {
    const readers = [];
    let cancelled = false;
    const cancelledError = () => new Error('probe cancelled');

    const wrapBody = (body) => ({
        getReader: () => {
            const reader = body.getReader();
            readers.push(reader);
            return {
                // A read pending when cancel() runs ends with the error, not with a short body.
                read: () => (cancelled ? Promise.reject(cancelledError()) : reader.read().then((step) => {
                    if (cancelled) throw cancelledError();
                    return step;
                })),
                cancel: (reason) => reader.cancel(reason),
            };
        },
    });

    const cancellableFetch = (url, init) => {
        if (cancelled) return Promise.reject(cancelledError());
        return fetchImpl(url, init).then((response) => {
            const hasReader = response.body && typeof response.body.getReader === 'function';
            if (cancelled) {
                if (hasReader) response.body.cancel().catch(() => null);
                throw cancelledError();
            }
            if (!hasReader) return response;
            return {
                status: response.status,
                url: response.url,
                redirected: response.redirected,
                headers: response.headers,
                body: wrapBody(response.body),
                arrayBuffer: () => response.arrayBuffer(),
            };
        });
    };

    const cancel = () => {
        cancelled = true;
        readers.splice(0).forEach((reader) => {
            Promise.resolve().then(() => reader.cancel()).catch(() => null);
        });
    };

    return { fetch: cancellableFetch, cancel };
};

// The probe of one stream for the list: LIST_PROBE_OPTIONS, the addon's request headers, and a
// promise with cancel() (the queue calls it when the list goes away). The final URL it reaches (the
// debrid redirect it followed) is kept for the Player's load (F8.1). finalUrls: injectable for the tests.
const probeStream = (url, stream, fetchImpl, finalUrls) => {
    const headerProbe = require('../header-probe');
    const transfer = createCancellableFetch(fetchImpl || ((input, init) => fetch(input, init)));
    const headers = rank.probeHeadersOf(stream);
    const urls = finalUrls || require('../final-url').getFinalUrls();
    const onFinalUrl = (finalUrl) => urls.note(url, finalUrl);
    const options = Object.assign({}, queue.LIST_PROBE_OPTIONS, headers !== null ? { headers } : {}, { fetch: transfer.fetch, onFinalUrl });
    const promise = headerProbe.probe(headerProbe.createFetchReadRange(url, options), options);
    promise.cancel = transfer.cancel;
    return promise;
};

// One queue (and cache) for the whole app: reopening a list reuses the probes already made.
const getProbeQueue = () => {
    if (probeQueue === null) probeQueue = queue.createProbeQueue({ probe: (url, stream) => probeStream(url, stream), concurrency: 2, maxEntries: 64 });
    return probeQueue;
};

// The codecs the stream name cites, with their status in the profile (for the warning texts).
const nameAudioCodecs = (stream) => {
    const c8 = getRules();
    const audio = c8.DEFAULT_PROFILE.audio.codecs;
    return c8.parseStreamName(stream).audioCodecs.map((codec) => ({ codec, status: audio[codec] ? audio[codec].status : 'unknown' }));
};

// The item display (labels, warnings, tier) of a ranked entry, or null.
const describe = (entry) => {
    if (!entry || !entry.result) return null;
    const result = entry.result;
    const needsNameCodecs = !result.sources.probe && result.warnings.some((warning) => /^AUDIO_/.test(warning.code));
    return display.toDisplay(result, needsNameCodecs ? nameAudioCodecs(entry.stream) : []);
};

// Audio languages of the profile, in order, for the rules (initial track and its score).
const preferencesOf = (settings) => {
    const languages = [];
    if (settings) {
        [settings.audioLanguage, settings.secondaryAudioLanguage].forEach((language) => {
            if (typeof language === 'string' && language.length > 0 && languages.indexOf(language) === -1) languages.push(language);
        });
    }
    return { audioLanguages: languages };
};

module.exports = {
    LIST_SETTINGS,
    PROBE_SWITCH_KEY,
    probesEnabled,
    getRules,
    getRanker,
    getProbeQueue,
    probeStream,
    createCancellableFetch,
    describe,
    preferencesOf,
    probeUrlOf: rank.probeUrlOf,
    canProbe: rank.canProbe,
    isUncached: rank.isUncached,
    streamKey: rank.streamKey,
    createRanker: rank.createRanker,
    applyFrozenOrder: rank.applyFrozenOrder,
    orderOf: rank.orderOf,
    pickProbeTargets: rank.pickProbeTargets,
    createProbeQueue: queue.createProbeQueue,
    LIST_PROBE_OPTIONS: queue.LIST_PROBE_OPTIONS,
    toDisplay: display.toDisplay,
    replaceItems: elements.replaceItems,
    insertAfter: elements.insertAfter,
    chain: elements.chain,
};
