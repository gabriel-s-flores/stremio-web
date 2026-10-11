// Search (owner: F4.1a), on top of webos/lib/navigation/f4.1a.js: the result rows are the catalog
// rows of the Board (./board.js), plus the way to and from the search field.
// - UP from the first row goes to the search field. Its tabIndex is -1 upstream, so the spatial
//   navigation went to the clear button next to it instead, which erases the search on OK.
// - DOWN from the field (the system keyboard closed: while it is up, the keys go to the keyboard)
//   goes to the results: the item the focus came from, or the first one.
// - Opening the system keyboard from the field and typing is F3.4's.
// The upstream SearchBar focuses the field whenever the route comes back; the restore of
// webos/lib/navigation/f4.1a.js runs after it and puts the focus back on the result left by Back.

const { isFocusable, isRendered, queryLocal } = require('./f4.1a');
const { firstItem, firstVisibleItem, isRowItem, navigateRows, rowsScreen } = require('./board');

const rows = rowsScreen('search-content');

const searchFieldOf = (container) => {
    const bar = queryLocal(container, 'search-bar-container');
    return bar ? bar.querySelector('input') : null;
};

const searchScreen = {
    initial: (container) => {
        const list = rows.listOf(container);
        const first = list ? firstItem(list) : null;
        if (first) return first;
        const field = searchFieldOf(container);
        return field && isRendered(field) ? field : null;
    },
    navigate: (target, dir, container, memory) => {
        const list = rows.listOf(container);
        const field = searchFieldOf(container);
        if (field && target === field) {
            if (dir !== 'down' || !list) return null;
            if (isFocusable(memory.content) && list.contains(memory.content)) return memory.content;
            return firstVisibleItem(list);
        }
        // Nothing above the first row with items (rows still loading above would have answered).
        if (list && field && dir === 'up' && isRowItem(target, list)) {
            return navigateRows(target, dir, list) || field;
        }
        return rows.navigate(target, dir, container, memory);
    },
    isContent: rows.isContent,
    align: rows.align,
};

module.exports = {
    searchFieldOf,
    searchScreen,
};
