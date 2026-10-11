// Scrolling lists of a screen (see ../README.md; Library, Calendar, Addons and Settings in
// ../screens.js): the arrows inside a vertical list whose items go past its visible part.
//
// - UP/DOWN: the next item is searched among all the items of the list, not only the visible ones,
//   and the list scrolls just enough to show it with a margin (./scroll.js, revealInList). The
//   polyfill only sees visible items (the row above a scrolled grid is hidden, so it scrolled 40 px
//   per press) and scrolls every focused item to the top of the list. With no item in that
//   direction the list scrolls by most of its height, which also reaches content without controls
//   (Settings' shortcuts and info) and the end of the Library grid, where the next page loads. At
//   the end DOWN stays and UP leaves the list through the spatial navigation (filters, bars).
// - LEFT/RIGHT: the visible items of the same row; with none, the closest visible element outside
//   the list in that direction (the screen's `leftExit` first: Settings' selected menu entry), never
//   the bar at the top. RIGHT at the end of a row stays; LEFT is the spatial navigation's (the side
//   bar).
// - An open dropdown (role="listbox", the language list of Settings) is a list of its own, for UP
//   and DOWN; its LEFT/RIGHT stay with the spatial navigation (webos/lib/navigation/modals.js).
// - RIGHT from a menu next to a list (`rightReturn`, Settings): back to the row the user left.
//
// The candidates are given to the polyfill's own search (spatialNavigationSearch with `candidates`
// and `container`), so the choice inside the list is the polyfill's geometry.

const { closestLocal, firstFocusable, inViewport, isFocusable, isTextField, queryLocal, queryLocalAll } = require('./dom');
const { TOP_BAR, inNavBars, inRouteModal } = require('./routes');
const { revealInList } = require('./scroll');

// Part of the list height scrolled when there is no item in that direction.
const PAGE_SCROLL = 0.6;

const search = (active, dir, container, candidates) => (
    candidates.length > 0 && typeof active.spatialNavigationSearch === 'function' ?
        active.spatialNavigationSearch(dir, { container, candidates }) :
        null
);

const listCandidates = (list, active) => Array.prototype.filter.call(list.querySelectorAll('*'), (element) => (
    element !== active && isFocusable(element) && !element.contains(active)
));

const overlaps = (rect, box) => rect.bottom > box.top && rect.top < box.bottom && rect.right > box.left && rect.left < box.right;

const canScroll = (list, dir) => {
    if (dir === 'up') return list.scrollTop > 0;
    return list.scrollTop + list.clientHeight < list.scrollHeight - 1;
};

// UP/DOWN inside `list`: an element (already scrolled into the list), `true` (the list scrolled, or
// the end of it: DOWN stays) or null (UP at the top: the spatial navigation). `outer` is the list of
// the screen around it (an open dropdown inside Settings), kept showing the element too.
const moveInList = (list, active, dir, outer = null) => {
    const best = search(active, dir, list, listCandidates(list, active));
    if (best) {
        revealInList(list, best);
        if (outer !== null) revealInList(outer, best);
        return best;
    }
    if (canScroll(list, dir)) {
        list.scrollTop += (dir === 'up' ? -1 : 1) * list.clientHeight * PAGE_SCROLL;
        return true;
    }
    return dir === 'down' ? true : null;
};

// LEFT/RIGHT inside `list`: an element, `true` (RIGHT at the end of a row stays) or null (LEFT out of
// the list: the spatial navigation).
const moveAcross = (spec, container, list, active, dir) => {
    const from = active.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    const row = listCandidates(list, active).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < from.bottom && rect.bottom > from.top && overlaps(rect, box) && inViewport(element);
    });
    const inRow = search(active, dir, list, row);
    if (inRow) return inRow;
    const preferred = dir === 'left' && spec.leftExit ? spec.leftExit(container) : null;
    if (preferred && isFocusable(preferred) && inViewport(preferred)) return preferred;
    const outside = search(active, dir, container, Array.prototype.filter.call(container.querySelectorAll('*'), (element) => (
        !list.contains(element) && isFocusable(element) && inViewport(element) &&
        !closestLocal(element, [TOP_BAR], container) && !inRouteModal(element)
    )));
    if (outside) return outside;
    return dir === 'right' ? true : null;
};

// The arrows of a screen with scrolling lists (`spec.lists`, local class names), for the screen
// description of ./screenFocus.js: an element, `true` or null.
const navigateLists = (spec, active, dir, container, memory) => {
    if (isTextField(active)) return null;
    if (dir === 'right' && spec.rightReturn && closestLocal(active, [spec.rightReturn.from], container)) {
        const list = queryLocal(container, spec.rightReturn.to);
        const row = memory.content;
        if (list && isFocusable(row) && list.contains(row) && inViewport(row)) return row;
    }
    const listbox = active.closest('[role="listbox"]');
    const screenList = closestLocal(active, spec.lists, container);
    const vertical = dir === 'up' || dir === 'down';
    if (listbox && container.contains(listbox)) return vertical ? moveInList(listbox, active, dir, screenList) : null;
    if (screenList === null) return null;
    return vertical ? moveInList(screenList, active, dir) : moveAcross(spec, container, screenList, active, dir);
};

// The first focusable element for the entries of a screen's initial focus, tried in order: a list
// of local class names (nested: the first focusable inside the last one wins) or a function of the
// container that returns the element to look in.
const findEntry = (entries, container) => {
    for (const entry of entries) {
        let target = null;
        if (typeof entry === 'function') {
            const found = entry(container);
            target = found ? firstFocusable(found) : null;
        } else {
            let scopes = [container];
            entry.forEach((local) => {
                scopes = scopes.reduce((found, scope) => found.concat(queryLocalAll(scope, local)), []);
            });
            for (const scope of scopes) {
                target = inNavBars(scope, container) ? null : firstFocusable(scope);
                if (target) break;
            }
        }
        if (target) return target;
    }
    return null;
};

module.exports = {
    PAGE_SCROLL,
    findEntry,
    moveAcross,
    moveInList,
    navigateLists,
};
