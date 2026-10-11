// DOM helpers of the remote navigation (webOS build only; see ../README.md). Plain functions, ES2015
// for Chromium 53: it has no Node#isConnected.

const ARROWS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
const ENTER = 13;

const FOCUSABLE = '[tabindex], a[href], button, input, select, textarea';

const isElement = (node) => Boolean(node) && node.nodeType === 1;

const isAttached = (element) => isElement(element) && element.ownerDocument.documentElement.contains(element);

// display: none on the element or an ancestor (the routes under the top one, the items a row hides)
// leaves no box.
const isRendered = (element) => isAttached(element) && element.getClientRects().length > 0;

// Rendered with an area: what a user can see (and the spatial navigation can reach).
const isShown = (element) => {
    if (!isRendered(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
};

const isFocusable = (element) => (
    isElement(element) && element.tabIndex >= 0 && !element.disabled && !element.hasAttribute('disabled') && isShown(element)
);

// The focusable elements inside `root`, in DOM order.
const focusablesIn = (root) => (root ? Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), isFocusable) : []);

// The first focusable element at or inside `root` (itself included), in DOM order.
const firstFocusable = (root) => {
    if (!isElement(root)) return null;
    if (isFocusable(root)) return root;
    return Array.prototype.find.call(root.querySelectorAll(FOCUSABLE), isFocusable) || null;
};

// A field the system keyboard opens on (not a checkbox, a range or a button).
const isTextField = (element) => isElement(element) && (element.tagName === 'TEXTAREA' ||
    (element.tagName === 'INPUT' && ['range', 'checkbox', 'radio', 'button', 'submit'].indexOf(element.type) === -1));

const inViewport = (element) => {
    const win = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth;
};

// CSS modules name classes `[local]-[hash:base64:5]` (webpack.config.js): `local` must be the whole
// local part of a class (board-content does not match board-content-container-AbCdE).
const patterns = new Map();
const localPattern = (local) => {
    let pattern = patterns.get(local);
    if (!pattern) {
        pattern = new RegExp(`^${local}-[A-Za-z0-9_-]{5}$`);
        patterns.set(local, pattern);
    }
    return pattern;
};

const classNameOf = (element) => {
    const name = element.className;
    // SVG elements: an SVGAnimatedString.
    return typeof name === 'string' ? name : (name && name.baseVal) || '';
};

const hasLocalName = (element, local) => {
    if (!isElement(element)) return false;
    const name = classNameOf(element);
    if (name.indexOf(`${local}-`) === -1) return false;
    const pattern = localPattern(local);
    return name.split(/\s+/).some((token) => pattern.test(token));
};

const queryLocalAll = (root, local) => Array.prototype.filter.call(
    root.querySelectorAll(`[class*="${local}-"]`),
    (element) => hasLocalName(element, local)
);

const queryLocal = (root, local) => (
    Array.prototype.find.call(root.querySelectorAll(`[class*="${local}-"]`), (element) => hasLocalName(element, local)) || null
);

// The closest element (itself included) with one of the local names, below `stop`.
const closestLocal = (element, locals, stop) => {
    for (let node = element; isElement(node) && node !== stop; node = node.parentNode) {
        if (locals.some((local) => hasLocalName(node, local))) return node;
    }
    return null;
};

module.exports = {
    ARROWS,
    ENTER,
    FOCUSABLE,
    closestLocal,
    firstFocusable,
    focusablesIn,
    hasLocalName,
    inViewport,
    isAttached,
    isElement,
    isFocusable,
    isRendered,
    isShown,
    isTextField,
    queryLocal,
    queryLocalAll,
};
