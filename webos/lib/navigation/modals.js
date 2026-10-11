// Focus of modals, popups and menus with the remote (F4.3).
//
// The upstream overlays do not agree on where the focus goes: ModalDialog and Popup sit on
// react-focus-lock but only take the focus when an `autoFocus` asks for it, the ContextMenu, the
// Player menus and the side drawer do not manage it at all. With arrows only (spatial navigation
// starts from document.activeElement), that leaves the focus on the page *behind* the overlay: OK
// then activates something nobody sees. This module closes that gap for every overlay of
// webos/back/overlays.js (one catalogue for Back and for the focus), without editing the components:
//   - when an overlay opens and the last input was a key, the focus enters it (first focusable
//     that is not a text field, so the system keyboard does not pop up);
//   - while it is open, the focus cannot leave it: arrows move among the focusables of the overlay
//     only (the polyfill search, restricted to them; focusing something behind it would also
//     scroll the page there), a focus that lands outside anyway goes back to the last element
//     inside, and an arrow or OK pressed with the focus outside enters the overlay instead of
//     acting on the page;
//   - when it closes, the focus returns to the element that opened it (ModalDialog and the Player
//     menus drop it on `body`).
// The pointer is left alone: after a trusted mouse event nothing moves the focus, and a click
// outside keeps closing popups the upstream way. The first arrow key after that enters the overlay.
//
// Cost: one MutationObserver on the body (child list only, no attributes). It looks at the nodes of
// each mutation with one selector (OVERLAY_HINT, scoped to the node) and only a hit schedules the
// check, which is the expensive part: findTopOverlay scans the document several times (30 ms on the
// c8 profile, measured: running it after every burst of the Board load added 1.2 s to the boot).
// The key handlers use the overlay found by the last check, they never search.

const { findTopOverlay, isOverlayOpen, OVERLAY_HINT } = require('../../back/overlays');

const DIRECTIONS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
const ARROW_KEYS = Object.keys(DIRECTIONS).map(Number);
const ENTER_KEY = 13;
const CHECK_DELAY_MS = 16;
const TRACE_LENGTH = 30;
const RECENT_FOCUS = 6;
const ENTER_RETRY_DELAY_MS = 100;
const ENTER_RETRIES = 20;
// A focus change this close to a trusted mouse press is the click's, not the spatial navigation's.
const POINTER_FOCUS_WINDOW_MS = 150;

const CANDIDATES = 'a[href], button, input, select, textarea, [tabindex]';
const TEXT_FIELDS = /^(INPUT|TEXTAREA)$/;
// ActionMenu moves the focus among its items on its own (and wraps around).
const OWN_ARROWS = ['action-menu'];
// The search history dropdown shows under the field that keeps the focus while typing.
const PASSIVE_ROOT = '[class^="search-bar-container-"], [class*=" search-bar-container-"]';

const isFocusable = (element) => (
    element.tabIndex >= 0 &&
    !element.disabled &&
    !element.hasAttribute('disabled') &&
    (element.offsetWidth > 0 || element.offsetHeight > 0) &&
    element.ownerDocument.defaultView.getComputedStyle(element).visibility === 'visible'
);

// Where the focus starts in an overlay: what asks for it, then what is selected, then the first.
const findInitialTarget = (root) => {
    const focusables = Array.from(root.querySelectorAll(CANDIDATES)).filter(isFocusable);
    const buttons = focusables.filter((element) => !TEXT_FIELDS.test(element.nodeName));
    const pool = buttons.length > 0 ? buttons : focusables;
    return pool.find((element) => element.hasAttribute('autofocus')) ||
        pool.find((element) => element.getAttribute('aria-selected') === 'true' || /(^|\s)selected(\s|$)/.test(String(element.className))) ||
        pool[0] ||
        null;
};

// `isTrusted` is a parameter for the tests: jsdom cannot make a trusted event.
const createModalFocus = (win, {
    isTrusted = (event) => event.isTrusted,
    setTimeout: timeout = win.setTimeout.bind(win),
    clearTimeout: clear = win.clearTimeout.bind(win),
} = {}) => {
    const doc = win.document;
    // Per overlay root: the element that had the focus when it opened and the last one inside.
    const records = new Map();
    let current = null;
    let currentOverlay = null;
    // An overlay that owns the remote is up (the QR dialog of F3.4): nothing here acts meanwhile.
    let ownerOpen = false;
    let lastInput = 'key';
    let lastPointerTime = -Infinity;
    let checkTimer = null;
    let retryTimer = null;
    let observer = null;
    let started = false;
    // The last elements that had the focus: an overlay may place the focus inside itself (autofocus)
    // before it is noticed, and then the element that opened it is the one before.
    const recentFocus = [];
    // The last decisions, for the tests on the emulator and the diagnostics.
    const history = [];
    const stats = { checks: 0, ms: 0, hits: [] };
    const trace = (what, detail) => {
        history.push({ time: Date.now(), what, detail: detail || null });
        if (history.length > TRACE_LENGTH) history.shift();
    };

    const isInside = (root, element) => !!element && root.contains(element);
    const isLost = (element) => !element || element === doc.body || element === doc.documentElement || !doc.body.contains(element);

    // The overlay to hold the focus: null when there is none, or the topmost one does not want it
    // (corner popup, search history). An owner is returned as it is, for the caller to step aside.
    const searchTopOverlay = () => {
        const overlay = findTopOverlay(doc);
        if (overlay !== null && overlay.owner) {
            return overlay;
        }
        return overlay === null || !overlay.trapsFocus || overlay.root.closest(PASSIVE_ROOT) ? null : overlay;
    };

    // The arrow among the focusables of the overlay only. Returns false when the polyfill (or the
    // component) should handle the key: text fields keep the caret keys, ActionMenu has its own.
    const moveInside = (overlay, event) => {
        const active = doc.activeElement;
        if (OWN_ARROWS.indexOf(overlay.name) !== -1 || TEXT_FIELDS.test(active.nodeName) || typeof active.spatialNavigationSearch !== 'function') {
            return false;
        }
        const candidates = Array.from(overlay.root.querySelectorAll(CANDIDATES)).filter((element) => element !== active && isFocusable(element));
        const target = candidates.length > 0 ?
            active.spatialNavigationSearch(DIRECTIONS[event.keyCode], { candidates, container: overlay.root }) :
            null;
        event.preventDefault();
        if (target) {
            target.focus();
        }
        return true;
    };

    const focusElement = (element) => {
        element.focus({ preventScroll: true });
        return doc.activeElement === element;
    };

    const enter = (root, attempt = 0) => {
        clear(retryTimer);
        retryTimer = null;
        const record = records.get(root);
        const remembered = record && record.lastInside && root.contains(record.lastInside) && isFocusable(record.lastInside) ? record.lastInside : null;
        const target = remembered || findInitialTarget(root);
        trace('enter', `attempt ${attempt}: ${target ? `${target.nodeName.toLowerCase()} ${String(target.className).slice(0, 30)}` : 'no target'}; input ${lastInput}`);
        // The overlay may still be rendering or positioning itself (no focusable yet, or visibility
        // hidden): try again shortly.
        if ((target === null || !focusElement(target)) && attempt < ENTER_RETRIES) {
            retryTimer = timeout(() => {
                if (current === root && !ownerOpen && !isInside(root, doc.activeElement)) enter(root, attempt + 1);
            }, ENTER_RETRY_DELAY_MS);
        }
    };

    const restore = (element) => {
        if (isLost(element) || !isFocusable(element) || !isLost(doc.activeElement)) {
            return false;
        }
        return focusElement(element);
    };

    const check = () => {
        const started = win.performance ? win.performance.now() : 0;
        checkTimer = null;
        runCheck();
        stats.checks += 1;
        stats.ms += win.performance ? win.performance.now() - started : 0;
    };

    const runCheck = () => {
        const overlay = searchTopOverlay();
        ownerOpen = overlay !== null && overlay.owner;
        if (ownerOpen) {
            // Whatever is under it keeps its state: when it closes, the check finds it again.
            trace('owner', overlay.name);
            return;
        }
        const top = overlay === null ? null : overlay.root;
        const previous = current;
        currentOverlay = overlay;
        if (top === previous) {
            if (top !== null && lastInput === 'key' && !isInside(top, doc.activeElement)) {
                enter(top);
            }
            return;
        }
        current = top;
        trace('overlay', top ? `${top.nodeName} ${String(top.className).slice(0, 40)}` : 'closed');
        records.forEach((record, root) => {
            // Closed: out of the DOM, or still there but no longer open (the dropdown of a
            // MultiselectMenu without portal only drops its menu).
            if (root !== top && (!doc.body.contains(root) || !isOverlayOpen(doc, record.overlay))) {
                records.delete(root);
                // The overlay that closed gives the focus back to what opened it, unless the page
                // already moved it somewhere else.
                if (root === previous && lastInput === 'key') {
                    const origin = record.origin;
                    if (top === null || isInside(top, origin)) {
                        restore(origin);
                    }
                }
            }
        });
        if (top === null) {
            return;
        }
        if (!records.has(top)) {
            const active = doc.activeElement;
            const candidates = [active].concat(recentFocus.slice().reverse());
            // The opener of a MultiselectMenu dropdown sits inside the root (label and menu share a container):
            // with nothing outside to go back to, the element that had the focus is the one.
            const origin = candidates.find((element) => !isLost(element) && !isInside(top, element)) || (isLost(active) ? null : active);
            records.set(top, { origin, lastInside: isInside(top, active) ? active : null, overlay: { name: overlay.name, element: overlay.element } });
        }
        if (lastInput === 'key' && !isInside(top, doc.activeElement)) {
            enter(top);
        }
    };

    const mayBeOverlay = (node) => {
        if (node.nodeType !== 1) {
            return false;
        }
        const hit = node.matches(OVERLAY_HINT) ? node : node.querySelector(OVERLAY_HINT);
        if (hit && stats.hits.length < TRACE_LENGTH) {
            stats.hits.push(`${hit.nodeName} ${String(hit.className).slice(0, 50)}`);
        }
        return hit !== null;
    };

    // Decides from the mutated nodes alone whether anything is worth a check.
    const onMutations = (mutations) => {
        const rootGone = current !== null && !doc.body.contains(current);
        let overlayChanged = rootGone;
        let contentChanged = false;
        for (let i = 0; i < mutations.length && !overlayChanged; i++) {
            const { addedNodes, removedNodes, target } = mutations[i];
            for (let j = 0; j < addedNodes.length && !overlayChanged; j++) overlayChanged = mayBeOverlay(addedNodes[j]);
            for (let j = 0; j < removedNodes.length && !overlayChanged; j++) overlayChanged = mayBeOverlay(removedNodes[j]);
            contentChanged = contentChanged || (current !== null && current.contains(target));
        }
        if (overlayChanged) {
            schedule();
        } else if (contentChanged && lastInput === 'key' && !isInside(current, doc.activeElement)) {
            // Content that arrived late inside the open overlay: the focus may be able to enter now.
            enter(current);
        }
    };

    const schedule = () => {
        if (checkTimer === null) {
            checkTimer = timeout(check, CHECK_DELAY_MS);
        }
    };

    const onFocusIn = (event) => {
        if (ownerOpen) {
            return;
        }
        if (recentFocus[recentFocus.length - 1] !== event.target) {
            recentFocus.push(event.target);
            if (recentFocus.length > RECENT_FOCUS) recentFocus.shift();
        }
        if (current === null) {
            return;
        }
        if (isInside(current, event.target)) {
            const record = records.get(current);
            if (record) record.lastInside = event.target;
            return;
        }
        const fromPointer = Date.now() - lastPointerTime < POINTER_FOCUS_WINDOW_MS;
        if (lastInput === 'key' && !fromPointer && !isLost(event.target)) {
            // The spatial navigation reached something behind the overlay.
            trace('focus-outside', `${event.target.nodeName} ${String(event.target.className).slice(0, 30)}`);
            enter(current);
        }
    };

    const onKeyDown = (event) => {
        lastInput = 'key';
        if (ownerOpen) {
            return;
        }
        const overlay = currentOverlay;
        const top = current;
        if (top !== null && isInside(top, doc.activeElement) && ARROW_KEYS.indexOf(event.keyCode) !== -1) {
            moveInside(overlay, event);
            return;
        }
        if (top !== null && !isInside(top, doc.activeElement) && (ARROW_KEYS.indexOf(event.keyCode) !== -1 || event.keyCode === ENTER_KEY)) {
            // Focus outside of the open overlay (it opened by pointer, or the page took the focus):
            // this key only brings the focus in, it never acts on the page behind.
            trace('key-outside', `keyCode ${event.keyCode}; active ${doc.activeElement && doc.activeElement.nodeName}`);
            event.preventDefault();
            event.stopImmediatePropagation();
            enter(top);
        }
    };

    const onPointer = (event) => {
        if (!isTrusted(event)) {
            return;
        }
        lastInput = 'pointer';
        if (event.type === 'mousedown') {
            lastPointerTime = Date.now();
        }
    };

    const start = () => {
        if (started) {
            return;
        }
        started = true;
        doc.addEventListener('focusin', onFocusIn, true);
        win.addEventListener('keydown', onKeyDown, true);
        win.addEventListener('mousedown', onPointer, true);
        win.addEventListener('mousemove', onPointer, true);
        if (typeof win.MutationObserver === 'function') {
            observer = new win.MutationObserver(onMutations);
            observer.observe(doc.body, { childList: true, subtree: true });
        }
        // An overlay already in the page (not at the app boot, but the tests start late): one cheap
        // scan decides whether the full search is worth it.
        if (doc.body.querySelector(OVERLAY_HINT) !== null) {
            schedule();
        }
    };

    const stop = () => {
        if (!started) {
            return;
        }
        started = false;
        doc.removeEventListener('focusin', onFocusIn, true);
        win.removeEventListener('keydown', onKeyDown, true);
        win.removeEventListener('mousedown', onPointer, true);
        win.removeEventListener('mousemove', onPointer, true);
        if (observer) observer.disconnect();
        observer = null;
        clear(checkTimer);
        clear(retryTimer);
        checkTimer = null;
        retryTimer = null;
        records.clear();
        recentFocus.length = 0;
        current = null;
        currentOverlay = null;
    };

    return {
        start,
        stop,
        check,
        get current() {
            return current;
        },
        get lastInput() {
            return lastInput;
        },
        history,
        stats,
    };
};

module.exports = { createModalFocus, findInitialTarget, isFocusable };
