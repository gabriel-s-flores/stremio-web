// The Discover grid (owner: F4.1a), on top of webos/lib/navigation/f4.1a.js.
//
// The catalog is a wrapping flex row in the webOS build (src/routes/Discover/styles.webos.less) in a
// vertical scroller, with the filters above it and the preview panel on its right.
// - LEFT/RIGHT move along a line of the grid; past its ends the spatial navigation takes over (the
//   vertical nav bar on the left, the preview panel on the right).
// - UP/DOWN go to the item of the next line closest to the same column. With the polyfill, the lines
//   below the visible part of the scroller were not candidates: each press scrolled 40px.
// - UP from the first line goes to the filter above the item (type, catalog, genre, all filters).
// - DOWN on the last line scrolls the grid to the end, where Discover loads the next page
//   (useOnScrollToBottom); the focus stays until the new items are there.
// - DOWN from the filters or the top bar goes back to the grid: the item the focus came from, or
//   the first item on screen. The polyfill went from the search field to the preview panel.
// - The focused line is scrolled to the top of the grid.
// Opening a filter (its dropdown) and moving in it is the menus' navigation (F4.3): the keys of an
// open dropdown are left alone.

const { firstFocusable, hasLocalName, isFocusable, queryLocal } = require('./f4.1a');
const { TOP_BAR, sameColumn } = require('./board');

const GRID = 'meta-items-container';
const FILTERS = 'selectable-inputs-container';

const gridOf = (container) => queryLocal(container, GRID);

// The grid cells with their focusable link (the loading placeholders have none).
const cellsOf = (grid) => Array.from(grid.children)
    .map((cell) => ({ cell, link: firstFocusable(cell) }))
    .filter(({ link }) => link !== null);

// A closed filter: a MultiselectMenu label or the "all filters" button.
const isFilterControl = (element, container) => {
    const filters = queryLocal(container, FILTERS);
    if (!filters || !filters.contains(element)) return false;
    if (element.getAttribute('aria-haspopup')) return element.getAttribute('aria-expanded') !== 'true';
    return hasLocalName(element, 'filter-button');
};

const filterControls = (container) => {
    const filters = queryLocal(container, FILTERS);
    if (!filters) return [];
    return Array.prototype.filter.call(filters.querySelectorAll('[tabindex]'), (element) => (
        isFocusable(element) && isFilterControl(element, container)
    ));
};

const scrollGridTo = (grid, top) => {
    grid.scrollTop = Math.max(0, Math.min(top, grid.scrollHeight - grid.clientHeight));
};

const align = (element, grid) => {
    const cells = cellsOf(grid);
    const current = cells.find(({ cell }) => cell.contains(element));
    if (!current || cells.length === 0) return;
    scrollGridTo(grid, current.cell.offsetTop - cells[0].cell.offsetTop);
};

const firstVisibleCell = (grid) => {
    const cells = cellsOf(grid);
    const visible = cells.find(({ cell }) => cell.offsetTop + cell.offsetHeight > grid.scrollTop);
    return visible ? visible.link : null;
};

const navigateGrid = (target, dir, grid, container) => {
    const cells = cellsOf(grid);
    const index = cells.findIndex(({ cell }) => cell.contains(target));
    if (index === -1) return null;
    const top = cells[index].cell.offsetTop;
    switch (dir) {
        case 'left':
            return index > 0 && cells[index - 1].cell.offsetTop === top ? cells[index - 1].link : null;
        case 'right':
            return index < cells.length - 1 && cells[index + 1].cell.offsetTop === top ? cells[index + 1].link : null;
        case 'up': {
            const above = cells.filter(({ cell }) => cell.offsetTop < top);
            if (above.length > 0) {
                const lineTop = above[above.length - 1].cell.offsetTop;
                return sameColumn(above.filter(({ cell }) => cell.offsetTop === lineTop).map(({ link }) => link), target);
            }
            const filter = sameColumn(filterControls(container), target);
            if (filter) scrollGridTo(grid, 0);
            return filter;
        }
        case 'down': {
            const below = cells.filter(({ cell }) => cell.offsetTop > top);
            if (below.length > 0) {
                const lineTop = below[0].cell.offsetTop;
                return sameColumn(below.filter(({ cell }) => cell.offsetTop === lineTop).map(({ link }) => link), target);
            }
            scrollGridTo(grid, grid.scrollHeight);
            return true;
        }
        default:
            return null;
    }
};

const discoverScreen = {
    initial: (container) => {
        const grid = gridOf(container);
        const first = grid ? firstVisibleCell(grid) : null;
        if (first) return first;
        // No catalog to show (the "no catalog selected" or the addon error message): the filters. Not
        // before: right after the route opens there is no catalog yet, nor any message.
        if (!queryLocal(container, 'message-container')) return null;
        const filters = filterControls(container);
        return filters.length > 0 ? filters[0] : null;
    },
    navigate: (target, dir, container, memory) => {
        const grid = gridOf(container);
        if (!grid) return null;
        if (grid.contains(target)) return navigateGrid(target, dir, grid, container);
        if (dir !== 'down') return null;
        const bar = queryLocal(container, TOP_BAR);
        if (!isFilterControl(target, container) && !(bar && bar.contains(target))) return null;
        if (isFocusable(memory.content) && grid.contains(memory.content)) return memory.content;
        return firstVisibleCell(grid);
    },
    isContent: (element, container) => {
        const grid = gridOf(container);
        return Boolean(grid) && grid.contains(element);
    },
    align: (element, container) => {
        const grid = gridOf(container);
        if (grid && grid.contains(element)) align(element, grid);
    },
};

module.exports = {
    cellsOf,
    discoverScreen,
    filterControls,
    isFilterControl,
    navigateGrid,
};
