// Ranking of the streams list by what the C8 plays (F6.2, plan Phase 6 item 2): the C8 rules
// (../c8-rules, F5.3) read the stream name at once and the header probe (F5.2) when it arrives.
// Pure and synchronous; the probe requests live in ./queue.js.

const HTTP_URL = /^https?:\/\//i;
// Debrid addons mark the files that are not in the debrid cache yet: Torrentio "[RD download]",
// Comet "[RD⬇️]", MediaFusion/AIOStreams "⏳". Opening such a link makes the addon add the torrent
// to the user's debrid account, so these streams are never probed (only played on purpose).
const UNCACHED = /\bdownload\b|⬇|⏳|\buncached\b/i;
const SEPARATOR = '\u0001';

const filenameOf = (stream) => {
    const hints = stream.behaviorHints;
    return hints && typeof hints.filename === 'string' ? hints.filename : '';
};

const textOf = (stream) => [stream.name, stream.title, stream.description, filenameOf(stream)]
    .map((part) => (typeof part === 'string' ? part : ''))
    .join(SEPARATOR);

// The URL the probe reads: direct HTTP(S) streams only (debrid links). YouTube, external links and
// what F6.1 already hides (torrents) have none.
const probeUrlOf = (stream) => (stream !== null && typeof stream === 'object' && typeof stream.url === 'string' && HTTP_URL.test(stream.url) ? stream.url : null);

// Request headers the addon asks for (behaviorHints.proxyHeaders.request), also sent by the probe.
const probeHeadersOf = (stream) => {
    const hints = stream && stream.behaviorHints;
    const headers = hints && hints.proxyHeaders && hints.proxyHeaders.request;
    return headers !== null && typeof headers === 'object' ? headers : null;
};

const isUncached = (stream) => UNCACHED.test(textOf(stream));

const canProbe = (stream) => probeUrlOf(stream) !== null && !isUncached(stream);

// Identity of a stream in the caches: the source plus the text the rules read (two addons can
// point at the same file with different names).
const streamKey = (stream) => {
    if (stream === null || typeof stream !== 'object') return '';
    const source = [stream.url, stream.externalUrl, stream.ytId, stream.infoHash]
        .filter((value) => typeof value === 'string')[0] || '';
    return source + SEPARATOR + textOf(stream);
};

// Stable sort with an explicit tie-break on the original position (Array#sort is not stable on
// Chromium 53 above 10 items).
const stableSort = (items, compare) => items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || (a.index - b.index))
    .map((entry) => entry.item);

// Evaluates streams with the C8 rules and keeps the results: the same stream (key), probe output
// and preferences are evaluated once. `rules` is ../c8-rules (injected: the tests and the app
// share the module, and the app loads it on first use).
const createRanker = (options) => {
    const settings = options || {};
    const rules = settings.rules;
    const profile = settings.profile || rules.DEFAULT_PROFILE;
    const maxEntries = settings.maxEntries || 500;
    const cache = new Map();

    const evaluate = (stream, probe, preferences, preferencesKey) => {
        const key = streamKey(stream);
        const cached = cache.get(key);
        if (cached !== undefined && cached.probe === probe && cached.preferencesKey === preferencesKey) {
            return cached.result;
        }
        const result = rules.evaluate({ probe, stream, preferences, profile });
        cache.delete(key);
        cache.set(key, { probe, preferencesKey, result });
        if (cache.size > maxEntries) {
            cache.delete(cache.keys().next().value);
        }
        return result;
    };

    // items: anything; streamOf(item) -> addon stream or null; probeOf(stream) -> probe output or
    // null. Returns [{ item, stream, key, result }] from the best to the worst, ties in the given
    // order (rules.sortStreams). Items without a stream keep a neutral result (tier ok, score 0).
    const rank = (items, rankOptions) => {
        const config = rankOptions || {};
        const streamOf = config.streamOf || ((item) => item);
        const probeOf = config.probeOf || (() => null);
        const preferences = config.preferences || {};
        const preferencesKey = JSON.stringify(preferences);
        const entries = items.map((item) => {
            const stream = streamOf(item);
            if (stream === null || typeof stream !== 'object') {
                return { item, stream: null, key: null, result: null };
            }
            const probe = probeOf(stream) || null;
            return { item, stream, key: streamKey(stream), result: evaluate(stream, probe, preferences, preferencesKey) };
        });
        return rules.sortStreams(entries, (entry) => entry.result || NEUTRAL);
    };

    return { rank, evaluate: (stream, probe, preferences) => evaluate(stream, probe || null, preferences || {}, JSON.stringify(preferences || {})) };
};

const NEUTRAL = { tier: 'ok', score: 0 };

// Keeps the order the user is looking at: entries whose key is in `frozen` (key -> position) stay
// in that order; the others (an addon that answered later) follow, in ranked order.
const applyFrozenOrder = (ranked, frozen) => {
    if (!frozen || frozen.size === 0) return ranked;
    const positionOf = (entry) => (entry.key !== null && frozen.has(entry.key) ? frozen.get(entry.key) : Infinity);
    return stableSort(ranked, (a, b) => {
        const pa = positionOf(a);
        const pb = positionOf(b);
        return pa === pb ? 0 : (pa < pb ? -1 : 1);
    });
};

const orderOf = (ranked) => {
    const order = new Map();
    ranked.forEach((entry, index) => {
        if (entry.key !== null && !order.has(entry.key)) order.set(entry.key, index);
    });
    return order;
};

// The streams to probe among the first `count` probeable ones of the list (the ones visible when
// it opens): those whose URL `isKnown` does not have yet (probed, failed or queued). A stream
// further down only gets its turn when a result pushes one of these out of the top.
const pickProbeTargets = (ranked, count, isKnown) => {
    const targets = [];
    const seen = {};
    let visible = 0;
    for (let index = 0; index < ranked.length && visible < count; index += 1) {
        const stream = ranked[index].stream;
        const url = stream !== null && canProbe(stream) ? probeUrlOf(stream) : null;
        if (url !== null && !seen[url]) {
            seen[url] = true;
            visible += 1;
            if (!(isKnown && isKnown(url))) targets.push(stream);
        }
    }
    return targets;
};

module.exports = {
    probeUrlOf,
    probeHeadersOf,
    isUncached,
    canProbe,
    streamKey,
    stableSort,
    createRanker,
    applyFrozenOrder,
    orderOf,
    pickProbeTargets,
};
