// webOS TV 4.x build only (used by StreamsList.webos.js, F6.2): orders and labels the streams list
// by what the LG C8 plays. The C8 rules read the stream names at once (the list opens in the same
// render); the header probe runs later, on demand: for the first items, after the list shows up,
// and for the item the user stops on. The order follows the probe results until the user starts
// moving in the list; from then on it stays put and only the labels change.
// Logic and settings: webos/lib/stream-ranking (README.md there).

const React = require('react');
const { useProfile } = require('stremio/common');
const ranking = require('../../../../webos/lib/stream-ranking');

const { LIST_SETTINGS } = ranking;

const EMPTY_DISPLAY = { tier: 'ok', score: 0, source: 'none', labels: [], warnings: [] };

// deepLinks -> stream. StreamsList spreads each stream into its item, so the `deepLinks` prop of a
// rendered item is the very object of its stream (the item has no url or behaviorHints).
const indexStreams = (streams) => {
    const byDeepLinks = new Map();
    streams.forEach((entry) => {
        if (entry.content.type === 'Ready' && Array.isArray(entry.content.content)) {
            entry.content.content.forEach((stream) => {
                if (stream && stream.deepLinks) {
                    byDeepLinks.set(stream.deepLinks, stream);
                }
            });
        }
    });
    return byDeepLinks;
};

const useC8Ranking = (streams, video, isItem) => {
    const profile = useProfile();
    const queue = ranking.getProbeQueue();
    const [, setVersion] = React.useState(0);
    const state = React.useRef({
        videoId: undefined,
        frozen: null,
        order: null,
        urls: new Set(),
        targets: [],
        scheduledKey: '',
        autoProbes: 0,
        requested: new Set(),
        initialTimer: null,
        focusTimer: null,
        enabled: ranking.probesEnabled(),
    }).current;
    const streamsByDeepLinks = React.useMemo(() => indexStreams(streams), [streams]);
    const preferences = React.useMemo(() => ranking.preferencesOf(profile.settings), [profile.settings]);

    // Another video (episode) on the same list: a new ranking, free to follow the probes again.
    const videoId = video && typeof video.id === 'string' ? video.id : null;
    if (state.videoId !== videoId) {
        state.videoId = videoId;
        state.frozen = null;
        state.autoProbes = 0;
    }

    const request = React.useCallback((stream, first) => {
        const url = ranking.probeUrlOf(stream);
        state.requested.add(url);
        queue.request(url, stream, first);
    }, [queue, state]);

    const onItemFocus = React.useCallback((stream) => {
        clearTimeout(state.focusTimer);
        state.focusTimer = setTimeout(() => request(stream, true), LIST_SETTINGS.focusDelay);
    }, [request, state]);

    // The user moved in the list (remote keys, pointer, wheel): keep the order on screen.
    const freeze = React.useCallback(() => {
        if (state.frozen === null && state.order !== null) {
            state.frozen = ranking.orderOf(state.order);
        }
    }, [state]);

    React.useEffect(() => {
        return queue.subscribe((url) => {
            if (state.urls.has(url)) {
                setVersion((version) => version + 1);
            }
        });
    }, [queue, state]);

    // Probes for the top of the list, once it has been stable for a moment.
    React.useEffect(() => {
        const key = state.targets.map(ranking.probeUrlOf).join('\n');
        if (key === state.scheduledKey) {
            return;
        }
        state.scheduledKey = key;
        clearTimeout(state.initialTimer);
        if (key.length > 0) {
            const targets = state.targets;
            state.initialTimer = setTimeout(() => {
                targets.forEach((stream) => {
                    if (state.autoProbes < LIST_SETTINGS.maxAutoProbes) {
                        state.autoProbes += 1;
                        request(stream, false);
                    }
                });
            }, LIST_SETTINGS.initialDelay);
        }
    });

    // Leaving the list drops its probes that have not started.
    React.useEffect(() => {
        return () => {
            clearTimeout(state.initialTimer);
            clearTimeout(state.focusTimer);
            queue.cancel(Array.from(state.requested));
        };
    }, [queue, state]);

    // Reorders the items of the upstream render and gives each one its labels.
    const apply = (element) => ranking.replaceItems(React, element, isItem, (items) => {
        let ranked = ranking.getRanker().rank(items, {
            streamOf: (item) => streamsByDeepLinks.get(item.props.deepLinks) || null,
            probeOf: (stream) => {
                const url = ranking.probeUrlOf(stream);
                return url !== null ? queue.resultOf(url) : null;
            },
            preferences,
        });
        if (state.frozen !== null) {
            if (ranked.some((entry) => entry.key !== null && state.frozen.has(entry.key))) {
                ranked = ranking.applyFrozenOrder(ranked, state.frozen);
            } else {
                state.frozen = null;
            }
        }
        state.order = ranked;
        state.urls = new Set(ranked.map((entry) => (entry.stream !== null ? ranking.probeUrlOf(entry.stream) : null)).filter(Boolean));
        state.targets = state.enabled && state.autoProbes < LIST_SETTINGS.maxAutoProbes ?
            ranking.pickProbeTargets(ranked, LIST_SETTINGS.initialProbes, queue.has)
            :
            [];
        return ranked.map((entry, index) => {
            const probeable = state.enabled && entry.stream !== null && ranking.canProbe(entry.stream);
            const c8 = Object.assign({}, EMPTY_DISPLAY, ranking.describe(entry), {
                onFocus: probeable ? () => onItemFocus(entry.stream) : null,
            });
            return React.cloneElement(entry.item, { key: index, c8 });
        });
    }, (container) => ({
        onKeyDown: ranking.chain(container.props.onKeyDown, freeze),
        onMouseDown: ranking.chain(container.props.onMouseDown, freeze),
        onWheel: ranking.chain(container.props.onWheel, freeze),
    }));

    return apply;
};

module.exports = useC8Ranking;
