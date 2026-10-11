// Catalog rows of the Board and of Search: a screen of ./core/screenFocus.js.
//
// The list is a vertical scroller of rows (src/components/MetaRow); in the webOS build every row
// shows its 10 items in a horizontal strip that scrolls (src/routes/Board/styles.webos.less,
// src/routes/Search/styles.webos.less) instead of hiding the ones past the screen width.
// - LEFT/RIGHT move along the row; LEFT on the first item is left to the spatial navigation (the
//   vertical nav bar), RIGHT on the last one stays.
// - UP/DOWN go to the nearest row with items, to the item in the same column on screen. Message
//   rows (an addon error) are skipped. A row still loading (a placeholder) is brought into view,
//   which makes useVisibleCatalogs load it, and the focus waits where it is. With the TV zoom a
//   focused row can be taller than the list: showing the loading row then takes the focused row's
//   title out of sight, so once the loading row is done (items or an error) the focused row is
//   aligned again. UP from the first row goes to the top bar (search, profile), by the spatial
//   navigation's search among its buttons only: the side bar, focusable since F4.1b, is closer to the
//   first poster than the search button and took that UP.
// - The focused row is scrolled to the top of the list, title included, and the strip just enough
//   to show the focused item. The polyfill's scrollIntoView() put the poster itself at the top, with
//   the row title out of sight.
// - DOWN from the top bar (search, profile) goes back to the content: the item the focus came from,
//   or the first item of the first row on screen.

const { firstFocusable, focusablesIn, hasLocalName, isAttached, isFocusable, isRendered, queryLocal } = require('./core/dom');
const { TOP_BAR } = require('./core/routes');
const { scrollTopTo } = require('./core/scroll');
const { getInputHub } = require('./core/input');

// Local class name (CSS modules) of the strip of MetaRow and of its placeholder.
const STRIP = 'meta-items-container';

// The row of the list holding the element (a direct child of the list), or null.
const rowOf = (element, list) => {
    for (let node = element; node && node !== list; node = node.parentElement) {
        if (node.parentElement === list) return node;
    }
    return null;
};

const stripOf = (row) => queryLocal(row, STRIP);

// The focusable element of each item of the strip that is shown (filler cells are empty).
const itemsOf = (row) => {
    const strip = stripOf(row);
    if (!strip) return [];
    return Array.from(strip.children).map(firstFocusable).filter(Boolean);
};

const isPlaceholderRow = (row) => hasLocalName(row, 'meta-row-placeholder-container') && isRendered(row);

const left = (element) => element.getBoundingClientRect().left;

// The item of the row closest to the screen column of `from`.
const sameColumn = (items, from) => {
    const x = left(from);
    return items.reduce((best, item) => (
        best === null || Math.abs(left(item) - x) < Math.abs(left(best) - x) ? item : best
    ), null);
};

const rows = (list) => Array.prototype.slice.call(list.children);

// Scroll positions are in the list's CSS pixels: offsetTop/offsetLeft against the list and the
// strip, both positioned in the webOS styles (getBoundingClientRect() is in screen pixels, F2.6).
const scrollListTo = (list, row) => {
    const first = rows(list).find((child) => isRendered(child));
    scrollTopTo(list, row.offsetTop - (first ? first.offsetTop : 0));
};

const scrollStripTo = (strip, item) => {
    let cell = item;
    while (cell.parentElement && cell.parentElement !== strip) cell = cell.parentElement;
    const start = cell.offsetLeft;
    const end = start + cell.offsetWidth;
    if (start < strip.scrollLeft) {
        strip.scrollLeft = start;
    } else if (end > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = end - strip.clientWidth;
    }
};

// A row still loading only has to show for useVisibleCatalogs to load it (a part of it is enough):
// the list scrolls by the least for its near edge to come in by PEEK pixels. Scrolling it to the top
// took the focused row's title out of sight, and the loading row often turns into an addon error.
const PEEK = 8;

// The loading row each list peeked at, with the item that had the focus then: { row, element }.
const peeks = new WeakMap();

const peekRow = (list, row) => {
    const below = row.offsetTop - list.clientHeight + PEEK;
    const above = row.offsetTop + row.offsetHeight - PEEK;
    if (below > list.scrollTop) {
        list.scrollTop = Math.min(below, list.scrollHeight - list.clientHeight);
    } else if (above < list.scrollTop) {
        list.scrollTop = Math.max(0, above);
    }
};

const align = (element, list) => {
    const row = rowOf(element, list);
    if (!row) return;
    const strip = stripOf(row);
    if (!strip || !strip.contains(element)) return;
    scrollListTo(list, row);
    scrollStripTo(strip, element);
};

// Going up or down from `row`: the next row with items in that direction (an element to focus), a
// loading row (brought into view, `true`), or null at the end of the list.
const verticalTarget = (list, row, dir, from) => {
    const all = rows(list);
    const step = dir === 'down' ? 1 : -1;
    for (let index = all.indexOf(row) + step; index >= 0 && index < all.length; index += step) {
        const items = itemsOf(all[index]);
        if (items.length > 0) return sameColumn(items, from);
        if (isPlaceholderRow(all[index])) {
            peekRow(list, all[index]);
            peeks.set(list, { row: all[index], element: from });
            return true;
        }
    }
    return null;
};

// The row peeked at is done loading (its placeholder replaced by the row, or by an addon error): the
// item that still has the focus gets its row aligned again, title included.
const realignAfterPeek = (list) => {
    const peek = peeks.get(list);
    if (!peek || (isAttached(peek.row) && hasLocalName(peek.row, 'meta-row-placeholder-container'))) return;
    peeks.delete(list);
    const doc = list.ownerDocument;
    if (doc.activeElement === peek.element && list.contains(peek.element) && !getInputHub(doc.defaultView).pointerInUse()) {
        align(peek.element, list);
    }
};

// The first item of the first row on screen (the list scrolled down keeps its position).
const firstVisibleItem = (list) => {
    const top = list.scrollTop;
    for (const row of rows(list)) {
        if (row.offsetTop + row.offsetHeight <= top) continue;
        const items = itemsOf(row);
        if (items.length > 0) return items[0];
    }
    return null;
};

// The first item of the first row; null while that row is still loading (rows load out of order:
// the focus must not land on a row further down that happened to come first). Rows of an addon
// error are passed over.
const firstItem = (list) => {
    for (const row of rows(list)) {
        if (isPlaceholderRow(row)) return null;
        const items = itemsOf(row);
        if (items.length > 0) return items[0];
    }
    return null;
};

const isRowItem = (target, list) => {
    const row = rowOf(target, list);
    const strip = row && stripOf(row);
    return Boolean(strip) && itemsOf(row).some((item) => item === target || item.contains(target));
};

// The keys of the rows list: an element, `true` (swallowed) or null (spatial navigation).
const navigateRows = (target, dir, list) => {
    const row = rowOf(target, list);
    const strip = row && stripOf(row);
    if (!strip || !strip.contains(target)) return null;
    const items = itemsOf(row);
    const index = items.findIndex((item) => item === target || item.contains(target));
    if (index === -1) return null;
    switch (dir) {
        case 'left':
            return index > 0 ? items[index - 1] : null;
        case 'right':
            return index < items.length - 1 ? items[index + 1] : true;
        case 'down':
            return verticalTarget(list, row, dir, items[index]) || true;
        case 'up':
            return verticalTarget(list, row, dir, items[index]);
        default:
            return null;
    }
};

// UP from the first row: the closest button of the top bar, or null (the spatial navigation).
const toTopBar = (target, container) => {
    const bar = queryLocal(container, TOP_BAR);
    const candidates = bar ? focusablesIn(bar) : [];
    if (candidates.length === 0 || typeof target.spatialNavigationSearch !== 'function') return null;
    return target.spatialNavigationSearch('up', { candidates, container: bar }) || null;
};

// DOWN from the top bar: back to the content.
const fromTopBar = (target, dir, container, list, memory) => {
    if (dir !== 'down' || !list) return null;
    const bar = queryLocal(container, TOP_BAR);
    if (!bar || !bar.contains(target)) return null;
    if (isFocusable(memory.content) && list.contains(memory.content)) return memory.content;
    return firstVisibleItem(list) || null;
};

// The screen description for ./core/screenFocus.js, for the list with that local class name.
const rowsScreen = (listName) => {
    const listOf = (container) => queryLocal(container, listName);
    return {
        listOf,
        initial: (container) => {
            const list = listOf(container);
            return list ? firstItem(list) : null;
        },
        isContent: (element, container) => {
            const list = listOf(container);
            return Boolean(list) && list.contains(element);
        },
        navigate: (target, dir, container, memory) => {
            const list = listOf(container);
            if (!list) return null;
            if (list.contains(target)) {
                const result = navigateRows(target, dir, list);
                return result === null && dir === 'up' && isRowItem(target, list) ? toTopBar(target, container) : result;
            }
            return fromTopBar(target, dir, container, list, memory);
        },
        align: (element, container) => {
            const list = listOf(container);
            if (list && list.contains(element)) align(element, list);
        },
        onMutation: (container) => {
            const list = listOf(container);
            if (list) realignAfterPeek(list);
        },
    };
};

// The Board: the rows of src/routes/Board/Board.js.
const boardScreen = rowsScreen('board-content');

module.exports = {
    STRIP,
    TOP_BAR,
    align,
    boardScreen,
    firstItem,
    firstVisibleItem,
    fromTopBar,
    isRowItem,
    realignAfterPeek,
    itemsOf,
    navigateRows,
    rowOf,
    rowsScreen,
    sameColumn,
    toTopBar,
};
