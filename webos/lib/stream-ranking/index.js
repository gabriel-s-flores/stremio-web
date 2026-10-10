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

const probeStream = (url, stream) => {
    const headers = rank.probeHeadersOf(stream);
    const options = Object.assign({}, queue.LIST_PROBE_OPTIONS, headers !== null ? { headers } : {});
    return require('../header-probe').probeUrl(url, options);
};

// One queue (and cache) for the whole app: reopening a list reuses the probes already made.
const getProbeQueue = () => {
    if (probeQueue === null) probeQueue = queue.createProbeQueue({ probe: probeStream, concurrency: 2, maxEntries: 64 });
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
