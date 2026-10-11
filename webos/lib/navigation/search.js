// Search, a screen of ./core/screenFocus.js: the result rows are the catalog rows of the Board
// (./board.js), plus the way to and from the search field.
// - UP from the first row goes to the search field. Its tabIndex is -1 upstream, so the spatial
//   navigation went to the clear button next to it instead, which erases the search on OK.
// - DOWN from the field (the system keyboard closed: while it is up, the keys go to the keyboard)
//   goes to the results: the item the focus came from, or the first one. With the history and
//   suggestions menu of the SearchBar open under the field, DOWN goes into the menu instead (the
//   spatial navigation, as upstream), and DOWN on its last entry goes on to the results, closing
//   the menu, which would stay open over the first row.
// - Opening the system keyboard from the field and typing is F3.4's.
// - Focus recovery (the results gone from under the focus, Back to the search without a query) does
//   not pick the field: focusing it opens the system keyboard. With a query, the button next to the
//   field is the clear button (an OK there erases the search): the focus waits for the first result
//   of the query. With the field empty, the button is the search button: that one.
// The upstream SearchBar focuses the field whenever the route comes back; the restore of
// ./core/screenFocus.js runs after it and puts the focus back on the result left by Back.

const { isFocusable, isRendered, queryLocal } = require('./core/dom');
const { firstItem, firstVisibleItem, isRowItem, navigateRows, rowsScreen } = require('./board');

const rows = rowsScreen('search-content');

const searchBarOf = (container) => queryLocal(container, 'search-bar-container');

const searchFieldOf = (container) => {
    const bar = searchBarOf(container);
    return bar ? bar.querySelector('input') : null;
};

// The history and suggestions menu of the SearchBar, when it is open.
const searchMenuOf = (container) => {
    const bar = searchBarOf(container);
    const menu = bar ? queryLocal(bar, 'menu-container') : null;
    return menu && isRendered(menu) ? menu : null;
};

const menuEntries = (menu) => Array.from(menu.querySelectorAll('[tabindex], button, a[href]')).filter(isFocusable);

// The SearchBar closes its menu on a mousedown outside it (searchHistoryOnClose); a whole press, as
// the Back layer does (webos/back/overlays.js), so nothing stays pressed.
const closeSearchMenu = (document) => {
    const init = { bubbles: true, cancelable: true, button: 0 };
    document.body.dispatchEvent(new MouseEvent('mousedown', init));
    document.body.dispatchEvent(new MouseEvent('mouseup', init));
};

const backToResults = (list, memory) => {
    if (isFocusable(memory.content) && list.contains(memory.content)) return memory.content;
    return firstVisibleItem(list);
};

const searchScreen = {
    // `recovering`: not the field (the system keyboard would open), the search button instead, and
    // with a query nothing until its first result (the button clears the query then).
    initial: (container, { recovering = false } = {}) => {
        const list = rows.listOf(container);
        const first = list ? firstItem(list) : null;
        if (first) return first;
        const field = searchFieldOf(container);
        if (!recovering) return field && isRendered(field) ? field : null;
        if (field && field.value.length > 0) return null;
        const bar = searchBarOf(container);
        const button = bar ? queryLocal(bar, 'submit-button-container') : null;
        return isFocusable(button) ? button : null;
    },
    navigate: (target, dir, container, memory) => {
        const list = rows.listOf(container);
        const field = searchFieldOf(container);
        const menu = searchMenuOf(container);
        if (field && target === field) {
            if (dir !== 'down' || !list || menu) return null;
            return backToResults(list, memory);
        }
        if (menu && menu.contains(target)) {
            const entries = menuEntries(menu);
            if (dir !== 'down' || !list || entries[entries.length - 1] !== target) return null;
            const result = backToResults(list, memory);
            if (result) closeSearchMenu(target.ownerDocument);
            return result;
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
    searchMenuOf,
    searchScreen,
};
