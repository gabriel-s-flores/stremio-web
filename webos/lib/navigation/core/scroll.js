// Scrolling a list to the focused element (see ../README.md).
//
// The upstream spatial-navigation-polyfill calls scrollIntoView() (top aligned) on every element it
// focuses: the item above is always out of view, and the polyfill only moves to visible elements.
// The screens scroll their lists themselves instead, keeping a margin around the focused element.
//
// Pixels: getBoundingClientRect() is in screen pixels, scaled by the TV zoom of F2.6
// (src/common/interfaceScale.webos.ts), while scrollTop/scrollLeft and the offsets are in the
// node's CSS pixels. The ratio of a node's rect to its offset size converts one into the other.

// Share of the list kept visible past the focused element (revealInList).
const REVEAL_MARGIN = 0.15;

const ratioOf = (node, axis) => {
    const box = node.getBoundingClientRect();
    const size = axis === 'y' ? node.offsetHeight : node.offsetWidth;
    return size > 0 ? (axis === 'y' ? box.height : box.width) / size : 1;
};

// The scroll offset that keeps [start, end] inside [min, max] with the margin, or 0. An element
// bigger than the room goes to the start.
const offsetInto = (start, end, min, max, margin) => {
    if (end - start > max - min - 2 * margin) {
        return start - (min + margin);
    }
    if (start < min + margin) return start - (min + margin);
    if (end > max - margin) return end - (max - margin);
    return 0;
};

// Scrolls `node` along one axis ('x' or 'y') so that `element` is inside it with `margin` screen
// pixels, or the margin `margin(box, rect)` returns.
const revealAlong = (node, element, axis, margin) => {
    const box = node.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const value = typeof margin === 'function' ? margin(box, rect) : margin;
    const ratio = ratioOf(node, axis);
    const delta = axis === 'y' ?
        offsetInto(rect.top, rect.bottom, box.top, box.bottom, value) :
        offsetInto(rect.left, rect.right, box.left, box.right, value);
    if (delta === 0 || !(ratio > 0)) return;
    if (axis === 'y') node.scrollTop += delta / ratio;
    else node.scrollLeft += delta / ratio;
};

// A vertical list: the element with REVEAL_MARGIN of the list's height around it, less when the
// element is too tall for that (Library, Calendar, Addons, Settings).
const revealInList = (list, element) => revealAlong(list, element, 'y', (box, rect) => (
    Math.min(box.height * REVEAL_MARGIN, Math.max(0, (box.height - rect.height) / 2))
));

// The scrollable ancestors of an element, up to (not including) `stop`.
const scrollParents = (element, stop) => {
    const win = element.ownerDocument.defaultView;
    const parents = [];
    for (let node = element.parentElement; node && node !== stop; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        const y = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1;
        const x = (style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1;
        if (x || y) parents.push({ node, x, y });
    }
    return parents;
};

// Keeps the element in view in each scrollable ancestor up to `stop` (inner first), with a margin of
// half the element, up to a quarter of the container, so the next item in each direction stays
// partly visible (Details).
const keepInView = (element, stop) => {
    const margin = (box, rect, axis) => (axis === 'y' ?
        Math.min(rect.height / 2, box.height / 4) :
        Math.min(rect.width / 2, box.width / 4));
    scrollParents(element, stop).forEach(({ node, x, y }) => {
        if (y) revealAlong(node, element, 'y', (box, rect) => margin(box, rect, 'y'));
        if (x) revealAlong(node, element, 'x', (box, rect) => margin(box, rect, 'x'));
    });
};

// scrollTop set within the scrollable range (CSS pixels).
const scrollTopTo = (node, top) => {
    node.scrollTop = Math.max(0, Math.min(top, node.scrollHeight - node.clientHeight));
};

module.exports = {
    REVEAL_MARGIN,
    keepInView,
    offsetInto,
    revealAlong,
    revealInList,
    scrollTopTo,
};
