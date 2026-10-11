// Finding a focused element again (see ../README.md): after a re-render (its place in the tree) or a
// remount (its link, its label, its position). And which focus is worth remembering at all.

const { firstFocusable, focusablesIn } = require('./dom');
const { inNavBars, inRouteModal } = require('./routes');

// What a screen remembers as "where the user was": not the navigation bars (the side bar is how the
// user left, coming back there means one more press to the content; the top bar holds the search
// field, which opens the system keyboard) and not a modal of the route (closing it gives the focus
// back to the item that opened it: webos/lib/navigation/modals.js).
const isMemorable = (element, stop) => !inNavBars(element, stop) && !inRouteModal(element);

// Child indexes from the container down to the element: where the element was, if it is re-rendered.
const pathOf = (element, container) => {
    const path = [];
    for (let node = element; node && node !== container; node = node.parentElement) {
        if (!node.parentElement) return null;
        path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
    }
    return path;
};

// The focusable element at that place now, or inside the deepest node of the path that still exists.
const resolvePath = (path, container) => {
    if (!Array.isArray(path)) return null;
    let node = container;
    for (const index of path) {
        const child = node.children[index];
        if (!child) break;
        node = child;
    }
    return node === container ? null : firstFocusable(node);
};

// Where an element is, to find it again after a remount: its link (streams), its title (episodes,
// buttons) and its position among the focusable elements of its section.
const locate = (element, section) => ({
    href: element.getAttribute('href'),
    title: element.getAttribute('title'),
    text: (element.textContent || '').trim().slice(0, 80),
    index: focusablesIn(section).indexOf(element),
});

const resolve = (locator, section) => {
    const candidates = focusablesIn(section);
    const byHref = locator.href ? candidates.filter((element) => element.getAttribute('href') === locator.href) : [];
    if (byHref.length > 0) return byHref[0];
    const byLabel = candidates.filter((element) => (
        element.getAttribute('title') === locator.title && (element.textContent || '').trim().slice(0, 80) === locator.text
    ));
    if (byLabel.length > 0) return byLabel[0];
    return locator.index >= 0 && locator.index < candidates.length ? candidates[locator.index] : null;
};

// A memory by key (a page path) that outlives the component, keeping the `size` last keys.
const createKeyedMemory = (size) => {
    const entries = new Map();
    return {
        get: (key) => entries.get(key),
        set: (key, value) => {
            entries.delete(key);
            entries.set(key, value);
            if (entries.size > size) entries.delete(entries.keys().next().value);
        },
        clear: () => entries.clear(),
        get size() {
            return entries.size;
        },
    };
};

module.exports = {
    createKeyedMemory,
    isMemorable,
    locate,
    pathOf,
    resolve,
    resolvePath,
};
