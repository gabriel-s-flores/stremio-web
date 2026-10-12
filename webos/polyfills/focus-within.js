// :focus-within for webOS TV 4.x (Chromium 53), as the [focus-within] attribute that
// webos/webpack/postcss.js writes in place of the pseudo-class (F8.2).
//
// postcss-focus-within/browser does the same, but on every focus and every blur it removes the
// attribute from the whole chain of the old element (up to <html>) and sets it again on the whole
// chain of the new one. Each change on an ancestor invalidates the style of every element under it
// that a [focus-within] rule can reach (all the posters of the page: `.meta-item-container[focus-within]
// .poster-container`), so one arrow on the Board cost a full style recalc, forced inside focus() and in
// the first layout read after it: ~120 ms of focus() and ~110 ms of getClientRects per key in the CPU
// profile of the TV (F8 notes, Diagnosis 2), 0.5 s in the C8 profile of the emulator.
//
// Here only the elements that enter or leave the chain change: moving between two posters of a strip
// touches the two items, not the strip, the list, the route or <html>. A blur defers its update to a
// task: when the focus moves to another element, the focus event that follows the blur makes the one
// update; when it goes nowhere (to the body), the deferred update clears the chain.
// Like the original: no attribute while the focus is on the document, <html> or <body>.

const ATTRIBUTE = 'focus-within';

// `force`: install even where :focus-within is native (the tests, on jsdom).
export const install = (global, { force = false } = {}) => {
    const doc = global.document;
    if (!doc || doc.documentElement.hasAttribute('data-focus-within-polyfill')) return null;
    try {
        doc.querySelector(':focus-within');
        // Native support: nothing to do.
        if (!force) return null;
    } catch (error) {
        // Chromium 53: the selector is invalid.
    }
    doc.documentElement.setAttribute('data-focus-within-polyfill', '');

    // The elements that have the attribute now, from the focused element up to <html>.
    let chain = [];

    const chainOf = (element) => {
        const next = [];
        if (!element || /^(#document|HTML|BODY)$/.test(element.nodeName)) return next;
        for (let node = element; node && node.nodeType === 1; node = node.parentNode) next.push(node);
        return next;
    };

    const update = () => {
        const next = chainOf(doc.activeElement);
        const kept = new Set(next);
        chain.forEach((element) => {
            if (!kept.has(element)) element.removeAttribute(ATTRIBUTE);
        });
        next.forEach((element) => {
            if (!element.hasAttribute(ATTRIBUTE)) element.setAttribute(ATTRIBUTE, '');
        });
        chain = next;
    };

    let pending = null;
    const onFocus = () => {
        if (pending !== null) {
            global.clearTimeout(pending);
            pending = null;
        }
        update();
    };
    const onBlur = () => {
        if (pending === null) {
            pending = global.setTimeout(() => {
                pending = null;
                update();
            }, 0);
        }
    };

    doc.addEventListener('focus', onFocus, true);
    doc.addEventListener('blur', onBlur, true);
    update();
    return {
        update,
        uninstall: () => {
            global.clearTimeout(pending);
            doc.removeEventListener('focus', onFocus, true);
            doc.removeEventListener('blur', onBlur, true);
            chain.forEach((element) => element.removeAttribute(ATTRIBUTE));
            chain = [];
            doc.documentElement.removeAttribute('data-focus-within-polyfill');
        },
    };
};
