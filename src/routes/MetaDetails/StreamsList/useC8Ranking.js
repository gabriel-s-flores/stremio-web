// webOS TV 4.x build only (used by StreamsList.webos.js, F6.2): orders and labels the streams list
// by what the LG C8 plays. The C8 rules read the stream names at once (the list opens in the same
// render); the header probe runs later, on demand: for the first items, after the list shows up,
// and for the item the user stops on. The order follows the probe results only until the first
// interaction on the screen (a key, a click, the wheel or the pointer, anywhere) or until a list item
// has the focus; from then on it stays put and only the labels change: nothing moves under the
// focus. Leaving the list (unmount, or another route on top, e.g. the Player) stops its probes.
// Logic and settings: webos/lib/stream-ranking (README.md there).

const React = require('react');
const { useProfile } = require('stremio/common');
const { useRouteActive } = require('stremio/common/useRouteFocused');
const ranking = require('../../../../webos/lib/stream-ranking');

const { LIST_SETTINGS } = ranking;

const EMPTY_DISPLAY = { tier: 'ok', score: 0, source: 'none', labels: [], warnings: [] };

// User input anywhere on the screen. Not keyup: the OK that opened the details page ends there.
const INTERACTION_EVENTS = ['keydown', 'mousedown', 'mousemove', 'pointerdown', 'pointermove', 'wheel', 'touchstart'];

// The focused element is a C8 item of the list (Stream.webos.js marks them with data-c8-tier).
const listHasFocus = () => {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    return !!active && typeof active.hasAttribute === 'function' && active.hasAttribute('data-c8-tier');
};

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
    const routeActive = useRouteActive();
    const queue = ranking.getProbeQueue();
    const [, setVersion] = React.useState(0);
    const state = React.useRef({
        videoId: undefined,
        frozen: null,
        order: null,
        interacted: false,
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

    // Another video (episode) on the same list: a new ranking (frozen again at once if the user
    // already interacted).
    const videoId = video && typeof video.id === 'string' ? video.id : null;
    if (state.videoId !== videoId) {
        state.videoId = videoId;
        state.frozen = null;
        state.order = null;
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

    // The focus left the item before the pause: no probe.
    const onItemBlur = React.useCallback(() => {
        clearTimeout(state.focusTimer);
    }, [state]);

    // The user interacted (or the focus is in the list): keep the order on screen from now on.
    const freeze = React.useCallback(() => {
        state.interacted = true;
        if (state.frozen === null && state.order !== null) {
            state.frozen = ranking.orderOf(state.order);
        }
    }, [state]);

    React.useEffect(() => {
        INTERACTION_EVENTS.forEach((type) => window.addEventListener(type, freeze, true));
        return () => {
            INTERACTION_EVENTS.forEach((type) => window.removeEventListener(type, freeze, true));
        };
    }, [freeze]);

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

    // Leaving the list (unmount, or another route on top of this one, like the Player) drops its
    // queued probes and stops the running ones; the finished ones stay in the cache.
    const leave = React.useCallback(() => {
        clearTimeout(state.initialTimer);
        clearTimeout(state.focusTimer);
        state.scheduledKey = '';
        queue.cancel(Array.from(state.requested));
        state.requested.clear();
    }, [queue, state]);

    React.useEffect(() => {
        if (!routeActive) {
            leave();
        }
    }, [routeActive, leave]);

    React.useEffect(() => leave, [leave]);

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
        // A frozen order of another list (none of its streams here) does not apply.
        if (state.frozen !== null && !ranked.some((entry) => entry.key !== null && state.frozen.has(entry.key))) {
            state.frozen = null;
            state.order = null;
        }
        // Freeze the order on screen (or this first one) after an interaction or with an item focused.
        if (state.frozen === null && (state.interacted || listHasFocus())) {
            state.frozen = ranking.orderOf(state.order !== null ? state.order : ranked);
        }
        if (state.frozen !== null) {
            ranked = ranking.applyFrozenOrder(ranked, state.frozen);
        }
        state.order = ranked;
        state.urls = new Set(ranked.map((entry) => (entry.stream !== null ? ranking.probeUrlOf(entry.stream) : null)).filter(Boolean));
        state.targets = state.enabled && routeActive && state.autoProbes < LIST_SETTINGS.maxAutoProbes ?
            ranking.pickProbeTargets(ranked, LIST_SETTINGS.initialProbes, queue.has)
            :
            [];
        return ranked.map((entry, index) => {
            const probeable = state.enabled && entry.stream !== null && ranking.canProbe(entry.stream);
            const c8 = Object.assign({}, EMPTY_DISPLAY, ranking.describe(entry), {
                onFocus: probeable && routeActive ? () => onItemFocus(entry.stream) : null,
                onBlur: probeable ? onItemBlur : null,
            });
            return React.cloneElement(entry.item, { key: index, c8 });
        });
    }, (container) => ({
        // focusin: the focus entering the list from outside (the window listeners cover the input).
        onFocus: ranking.chain(container.props.onFocus, freeze),
    }));

    return apply;
};

module.exports = useC8Ranking;
