// webOS TV 4.x build only (used by StreamsList.webos.js, F8.6): how many streams of the list are
// rendered. A Torrentio answer has 224 streams, and rendering them all (the upstream items with the
// C8 labels) took ~4.5 s on the TV, for a list the remote walks one item at a time from the top.
// The list starts with the first FIRST items (in the C8 order) and grows by STEP whenever the focus
// gets within AHEAD items of the end, or the scroll (the Magic Remote's wheel) within SCROLL_AHEAD
// pixels of the bottom. The count reached is remembered per page path, so coming back to the page
// (Back from the Player) renders as many and the focus of F4.1c finds the stream played.

const React = require('react');
const { replaceItems, chain } = require('../../../../webos/lib/stream-ranking');

const SHOWN = { first: 24, step: 24, ahead: 8, scrollAhead: 600 };

// Count reached per page path, the last MEMORY_SIZE paths.
const MEMORY_SIZE = 32;
const memory = new Map();
const remember = (key, count) => {
    memory.delete(key);
    memory.set(key, count);
    if (memory.size > MEMORY_SIZE) memory.delete(memory.keys().next().value);
};

// The child of the container that holds the element (the item), and its index.
const itemIndexOf = (container, element) => {
    let node = element;
    while (node && node.parentNode !== container) node = node.parentNode;
    return node ? Array.prototype.indexOf.call(container.children, node) : -1;
};

const useShownStreams = (video, isItem) => {
    // The page path (the app routes by the hash) and the episode.
    const pathname = typeof window !== 'undefined' ? window.location.hash.split('?')[0] : '';
    const key = `${pathname}|${video && typeof video.id === 'string' ? video.id : ''}`;
    const [state, setState] = React.useState(() => ({ key, count: memory.get(key) || SHOWN.first }));
    // Another list in the same component (another episode): its own count.
    const count = state.key === key ? state.count : memory.get(key) || SHOWN.first;
    const current = React.useRef({ key, count, total: 0 });
    current.current.key = key;
    current.current.count = count;

    const grow = React.useCallback((wanted) => {
        const { key, count, total } = current.current;
        const next = Math.min(Math.max(count, wanted), Math.max(total, SHOWN.first));
        if (next <= count) return;
        remember(key, next);
        setState({ key, count: next });
    }, []);

    const onFocus = React.useCallback((event) => {
        const index = itemIndexOf(event.currentTarget, event.target);
        if (index >= 0 && index >= current.current.count - SHOWN.ahead) {
            grow(index + SHOWN.ahead + SHOWN.step);
        }
    }, [grow]);

    const onScroll = React.useCallback((event) => {
        const list = event.currentTarget;
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - SHOWN.scrollAhead) {
            grow(current.current.count + SHOWN.step);
        }
    }, [grow]);

    return (element) => replaceItems(React, element, isItem, (items) => {
        current.current.total = items.length;
        return items.length > count ? items.slice(0, count) : items;
    }, (container) => ({
        onFocus: chain(container.props.onFocus, onFocus),
        onScroll: chain(container.props.onScroll, onScroll),
    }));
};

useShownStreams.SHOWN = SHOWN;

module.exports = useShownStreams;
