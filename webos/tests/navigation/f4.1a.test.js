/**
 * @jest-environment jsdom
 */
// Remote navigation of the Board, Discover and Search (F4.1a): webos/lib/navigation/f4.1a.js and the
// screens. jsdom has no layout, so the geometry comes from data attributes (see `layout` below); the
// real thing runs in the emulator (webos/tests/navigation/emulator/f4.1a.mjs).

const { createScreenFocus, pathOf, resolvePath, queryLocal, hasLocalName } = require('../../lib/navigation/f4.1a');
const { boardScreen, navigateRows } = require('../../lib/navigation/board');
const { discoverScreen } = require('../../lib/navigation/discover');
const { searchScreen } = require('../../lib/navigation/search');

// Layout stand-ins: data-hidden (display: none on it or an ancestor), data-top/data-left (offsets
// against the positioned list or strip, and the screen x), data-width/data-height.
const layout = () => {
    const number = (element, key) => Number(element.getAttribute(`data-${key}`) || 0);
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get() { return number(this, 'top'); } });
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get() { return number(this, 'left'); } });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return number(this, 'width'); } });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return number(this, 'height'); } });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return number(this, 'width'); } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return number(this, 'height'); } });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return number(this, 'scroll-height') || number(this, 'height'); } });
    Element.prototype.getClientRects = function () {
        return this.closest('[data-hidden]') ? [] : [{}];
    };
    Element.prototype.getBoundingClientRect = function () {
        // Screen x: the cell's offset minus its strip's scroll.
        const cell = this.closest('[data-left]');
        const strip = cell && cell.parentElement;
        const left = cell ? number(cell, 'left') - (strip ? strip.scrollLeft : 0) : 0;
        return { left, top: 0, width: 10, height: 10, right: left + 10, bottom: 10 };
    };
};

beforeAll(layout);

const item = (name, left) => `<div class="meta-item-container-AAAAA" data-left="${left}" data-width="100"><a class="meta-item-link-BBBBB" href="#/x" tabindex="0">${name}</a></div>`;

const strip = (prefix, count, extra = '') => `<div class="meta-items-container-CCCCC" data-width="300">${
    Array.from({ length: count }, (_, index) => item(`${prefix}${index}`, index * 100)).join('')
}${extra}</div>`;

const row = (prefix, count, top) => `<div class="board-row-DDDDD meta-row-container-EEEEE" data-top="${top}" data-height="100"><div class="header-container-FFFFF"><div>${prefix}</div></div>${strip(prefix, count)}</div>`;

const placeholderRow = (top) => `<div class="board-row-DDDDD meta-row-placeholder-container-GGGGG" data-top="${top}" data-height="100"><div class="meta-items-container-CCCCC"><div></div><div></div></div></div>`;

const messageRow = (top) => `<div class="board-row-DDDDD meta-row-container-EEEEE" data-top="${top}" data-height="40"><div class="message-container-HHHHH">Addon error</div></div>`;

const topBar = '<nav class="horizontal-nav-bar-container-IIIII"><div class="search-bar-container-JJJJJ"><input tabindex="-1"><div class="submit-button-container-KKKKK" tabindex="0"></div></div></nav>';

const mount = (html) => {
    document.body.innerHTML = `<div class="routes-container"><div class="route-container"><div class="route-content">${html}</div></div></div>`;
    const container = document.querySelector('.route-content');
    container.querySelectorAll('[class*="board-content-"], [class*="search-content-"], [class*="meta-items-container-"]').forEach((element) => {
        element.scrollTop = 0;
        element.scrollLeft = 0;
    });
    return container;
};

const board = (rows) => mount(`<div class="board-container-LLLLL">${topBar}<div class="board-content-container-MMMMM"><div class="board-content-NNNNN" data-height="200" data-scroll-height="1000">${rows.join('')}</div></div></div>`);

const text = (element) => (element && element !== true ? element.textContent : element);

const press = (keyCode, target = document.activeElement) => {
    const event = new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
};
const LEFT = 37;
const UP = 38;
const RIGHT = 39;
const DOWN = 40;

describe('CSS module names', () => {
    test('the exact local name, not one that only starts the same', () => {
        const container = board([row('a', 2, 0)]);
        expect(hasLocalName(container.querySelector('[class*="board-content-container"]'), 'board-content')).toBe(false);
        expect(queryLocal(container, 'board-content').className).toBe('board-content-NNNNN');
    });
});

describe('paths', () => {
    test('an element re-rendered at the same place is found again', () => {
        const container = board([row('a', 3, 0), row('b', 3, 100)]);
        const element = container.querySelectorAll('a')[4];
        const path = pathOf(element, container);
        board([row('a', 3, 0), row('c', 3, 100)]);
        const again = resolvePath(path, document.querySelector('.route-content'));
        expect(text(again)).toBe('c1');
    });

    test('a shorter tree gives the focusable inside the deepest node left', () => {
        const container = board([row('a', 3, 0), row('b', 3, 100)]);
        const path = pathOf(container.querySelectorAll('a')[5], container);
        const shorter = board([row('a', 3, 0), row('b', 1, 100)]);
        expect(text(resolvePath(path, shorter))).toBe('b0');
    });
});

describe('Board rows', () => {
    const list = () => queryLocal(document, 'board-content');

    test('left and right move along the row; left on the first item is left to the spatial navigation', () => {
        board([row('a', 4, 0)]);
        const links = document.querySelectorAll('a');
        expect(text(navigateRows(links[1], 'right', list()))).toBe('a2');
        expect(text(navigateRows(links[1], 'left', list()))).toBe('a0');
        expect(navigateRows(links[0], 'left', list())).toBe(null);
        expect(navigateRows(links[3], 'right', list())).toBe(true);
    });

    test('up and down go to the same screen column, skipping message rows', () => {
        board([row('a', 6, 0), messageRow(100), row('b', 6, 140)]);
        const strips = document.querySelectorAll('[class*="meta-items-container"]');
        strips[1].scrollLeft = 200;
        const links = document.querySelectorAll('a');
        // a4 sits at x 400; in row b, scrolled by 200, b6 does not exist and b4 is at 200, b5 at 300...
        expect(text(navigateRows(links[4], 'down', list()))).toBe('b5');
        expect(text(navigateRows(links[6], 'up', list()))).toBe('a0');
    });

    test('up from the first row is left to the spatial navigation, down from the last row stays', () => {
        board([row('a', 2, 0), row('b', 2, 100)]);
        const links = document.querySelectorAll('a');
        expect(navigateRows(links[0], 'up', list())).toBe(null);
        expect(navigateRows(links[2], 'down', list())).toBe(true);
    });

    test('a row still loading is scrolled into view and the focus waits', () => {
        board([row('a', 2, 0), placeholderRow(300)]);
        const links = document.querySelectorAll('a');
        expect(navigateRows(links[0], 'down', list())).toBe(true);
        expect(list().scrollTop).toBe(300);
    });

    test('the initial focus waits for the first row, even when a row below loaded first', () => {
        const container = board([placeholderRow(0), row('b', 2, 100)]);
        expect(boardScreen.initial(container)).toBe(null);
        const loaded = board([messageRow(0), row('a', 2, 40), row('b', 2, 140)]);
        expect(text(boardScreen.initial(loaded))).toBe('a0');
    });

    test('the focused row goes to the top of the list and the strip shows the item', () => {
        const container = board([row('a', 6, 0), row('b', 6, 100), row('c', 6, 200)]);
        const target = container.querySelectorAll('a')[10];
        boardScreen.align(target, container);
        expect(list().scrollTop).toBe(100);
        expect(document.querySelectorAll('[class*="meta-items-container"]')[1].scrollLeft).toBe(200);
        boardScreen.align(container.querySelectorAll('a')[6], container);
        expect(document.querySelectorAll('[class*="meta-items-container"]')[1].scrollLeft).toBe(0);
    });
});

describe('screen focus', () => {
    let focus;
    afterEach(() => {
        if (focus) focus.destroy();
        focus = null;
    });

    test('initial focus waits for the content, then takes it unless something else has the focus', async () => {
        const container = board([placeholderRow(0)]);
        focus = createScreenFocus(container, boardScreen);
        expect(focus.ensureFocus()).toBe(false);
        queryLocal(container, 'board-content').innerHTML = row('a', 3, 0);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.activeElement.textContent).toBe('a0');
    });

    test('the initial focus does not steal the focus from what the user reached first', async () => {
        const container = board([placeholderRow(0)]);
        focus = createScreenFocus(container, boardScreen);
        focus.ensureFocus();
        container.querySelector('[class*="submit-button-container"]').focus();
        queryLocal(container, 'board-content').innerHTML = row('a', 3, 0);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.activeElement.className).toMatch(/submit-button-container/);
    });

    test('arrows inside the rows are taken; the first item\'s left goes on to the spatial navigation', () => {
        const container = board([row('a', 3, 0), row('b', 3, 100)]);
        focus = createScreenFocus(container, boardScreen);
        container.querySelectorAll('a')[0].focus();
        expect(press(RIGHT).defaultPrevented).toBe(true);
        expect(document.activeElement.textContent).toBe('a1');
        expect(press(DOWN).defaultPrevented).toBe(true);
        expect(document.activeElement.textContent).toBe('b1');
        container.querySelectorAll('a')[3].focus();
        expect(press(LEFT).defaultPrevented).toBe(false);
    });

    test('down from the top bar goes back to the item the focus came from', () => {
        const container = board([row('a', 3, 0), row('b', 3, 100)]);
        focus = createScreenFocus(container, boardScreen);
        container.querySelectorAll('a')[4].focus();
        container.querySelector('[class*="submit-button-container"]').focus();
        press(DOWN);
        expect(document.activeElement.textContent).toBe('b1');
    });

    test('restore: the element left is focused again when the route comes back', () => {
        const container = board([row('a', 3, 0), row('b', 3, 100)]);
        focus = createScreenFocus(container, boardScreen);
        container.querySelectorAll('a')[4].focus();
        // Another route on top: this one is hidden, its element loses the focus.
        focus.leave();
        container.parentElement.setAttribute('data-hidden', '');
        document.activeElement.blur();
        // The screen focused something of its own when it came back (Search does).
        container.parentElement.removeAttribute('data-hidden');
        container.querySelector('[class*="submit-button-container"]').focus();
        expect(focus.restore()).toBe(true);
        expect(document.activeElement.textContent).toBe('b1');
    });

    test('nothing happens while the route is hidden or a dialog is open', () => {
        const container = board([row('a', 3, 0)]);
        focus = createScreenFocus(container, boardScreen);
        container.parentElement.setAttribute('data-hidden', '');
        expect(focus.ensureFocus()).toBe(false);
        container.parentElement.removeAttribute('data-hidden');
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        document.body.appendChild(dialog);
        expect(focus.ensureFocus()).toBe(false);
        dialog.remove();
        expect(focus.ensureFocus()).toBe(true);
    });

    test('a focused element that goes away: the next arrow resumes at the same place', () => {
        const container = board([row('a', 3, 0), row('b', 3, 100)]);
        focus = createScreenFocus(container, boardScreen);
        const target = container.querySelectorAll('a')[4];
        target.focus();
        // Removed with no focus event (Chromium); the arrow comes on the body.
        target.parentElement.remove();
        const event = press(DOWN, document.body);
        expect(event.defaultPrevented).toBe(true);
        // Same place in the tree: the item that took the removed one's slot.
        expect(document.activeElement.textContent).toBe('b2');
    });

    test('a focused element hidden with a blur gives the focus back to the screen', async () => {
        const container = board([row('a', 3, 0), row('b', 3, 100)]);
        focus = createScreenFocus(container, boardScreen);
        const target = container.querySelectorAll('a')[4];
        target.focus();
        target.parentElement.setAttribute('data-hidden', '');
        target.blur();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.activeElement.textContent).toBe('a0');
    });

    test('with the Magic Remote pointer showing, a focused item does not scroll the lists', () => {
        const container = board([row('a', 6, 0), row('b', 6, 100), row('c', 6, 200)]);
        focus = createScreenFocus(container, boardScreen);
        document.documentElement.setAttribute('data-webos-pointer', 'visible');
        container.querySelectorAll('a')[10].focus();
        expect(queryLocal(container, 'board-content').scrollTop).toBe(0);
        document.documentElement.setAttribute('data-webos-pointer', 'hidden');
        container.querySelectorAll('a')[11].focus();
        expect(queryLocal(container, 'board-content').scrollTop).toBe(100);
        document.documentElement.removeAttribute('data-webos-pointer');
    });

    test('a blur with the element still there (pointer click on the background) is left alone', async () => {
        const container = board([row('a', 3, 0)]);
        focus = createScreenFocus(container, boardScreen);
        const target = container.querySelectorAll('a')[1];
        target.focus();
        target.blur();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.activeElement).toBe(document.body);
    });

    test('an arrow with nothing focused resumes at the last element, before the spatial navigation', () => {
        const container = board([row('a', 3, 0)]);
        focus = createScreenFocus(container, boardScreen);
        container.querySelectorAll('a')[2].focus();
        document.activeElement.blur();
        const event = press(DOWN, document.body);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement.textContent).toBe('a2');
    });
});

describe('Discover grid', () => {
    const cell = (name, top, left) => `<div class="meta-item-container-AAAAA" data-top="${top}" data-left="${left}" data-height="100"><a class="meta-item-link-BBBBB" href="#/x" tabindex="0">${name}</a></div>`;
    const filters = '<div class="selectable-inputs-container-PPPPP"><div class="selectable-inputs-QQQQQ">' +
        '<div class="multiselect-menu-RRRRR" data-left="0"><div tabindex="0" aria-haspopup="listbox" aria-expanded="false">Type</div></div>' +
        '<div class="multiselect-menu-RRRRR" data-left="200"><div tabindex="0" aria-haspopup="listbox" aria-expanded="false">Catalog</div></div>' +
        '<div class="filter-container-SSSSS" data-left="400"><div class="filter-button-TTTTT" tabindex="0">All</div></div>' +
        '</div></div>';
    const discover = (cells) => mount(`<div class="discover-container-UUUUU">${topBar}<div class="catalog-container-VVVVV">${filters}<div class="meta-items-container-WWWWW" data-height="150" data-scroll-height="400">${cells.join('')}</div></div></div>`);
    const grid = () => queryLocal(document, 'meta-items-container');
    const grid3x2 = () => discover([cell('0', 0, 0), cell('1', 0, 200), cell('2', 0, 400), cell('3', 120, 0), cell('4', 120, 200)]);
    const link = (name) => Array.prototype.find.call(document.querySelectorAll('a'), (element) => element.textContent === name);
    const nav = (from, dir, memory = {}) => discoverScreen.navigate(link(from), dir, document.querySelector('.route-content'), memory);

    test('left and right stay on a line of the grid', () => {
        grid3x2();
        expect(text(nav('1', 'right'))).toBe('2');
        expect(nav('2', 'right')).toBe(null);
        expect(nav('3', 'left')).toBe(null);
        expect(text(nav('4', 'left'))).toBe('3');
    });

    test('up and down keep the column; the last line scrolls to the end to load the next page', () => {
        grid3x2();
        expect(text(nav('1', 'down'))).toBe('4');
        expect(text(nav('4', 'up'))).toBe('1');
        expect(text(nav('2', 'down'))).toBe('4');
        expect(nav('4', 'down')).toBe(true);
        expect(grid().scrollTop).toBe(250);
    });

    test('up from the first line goes to the filter above the item', () => {
        grid3x2();
        grid().scrollTop = 30;
        expect(text(nav('2', 'up'))).toBe('All');
        expect(grid().scrollTop).toBe(0);
    });

    test('down from a closed filter goes back to the grid; an open dropdown is left alone', () => {
        const container = grid3x2();
        const type = container.querySelector('[aria-haspopup]');
        expect(text(discoverScreen.navigate(type, 'down', container, { content: link('4') }))).toBe('4');
        expect(text(discoverScreen.navigate(type, 'down', container, {}))).toBe('0');
        type.setAttribute('aria-expanded', 'true');
        expect(discoverScreen.navigate(type, 'down', container, {})).toBe(null);
    });

    test('initial focus: the first item, nothing while the catalog loads', () => {
        const loading = discover(['<div class="meta-item-placeholder-XXXXX"></div>']);
        expect(discoverScreen.initial(loading)).toBe(null);
        expect(text(discoverScreen.initial(grid3x2()))).toBe('0');
    });

    test('initial focus: the filters only once Discover shows it has no catalog', () => {
        const opening = mount(`<div class="discover-container-UUUUU"><div class="catalog-container-VVVVV">${filters}</div></div>`);
        expect(discoverScreen.initial(opening)).toBe(null);
        const empty = mount(`<div class="discover-container-UUUUU"><div class="catalog-container-VVVVV">${filters}<div class="message-container-MMMMM">No catalog</div></div></div>`);
        expect(text(discoverScreen.initial(empty))).toBe('Type');
    });

    test('the focused line goes to the top of the grid', () => {
        const container = grid3x2();
        discoverScreen.align(link('4'), container);
        expect(grid().scrollTop).toBe(120);
    });
});

describe('Search', () => {
    const search = (rows) => mount(`<div class="search-container-YYYYY">${topBar}<div class="search-content-ZZZZZ" data-height="200" data-scroll-height="1000">${rows.join('')}</div></div>`);

    test('up from the first row goes to the search field, down from the field back to the results', () => {
        const container = search([row('a', 3, 0), row('b', 3, 100)]);
        const field = container.querySelector('input');
        const links = container.querySelectorAll('a');
        expect(searchScreen.navigate(links[1], 'up', container, {})).toBe(field);
        expect(text(searchScreen.navigate(links[4], 'up', container, {}))).toBe('a1');
        expect(text(searchScreen.navigate(field, 'down', container, {}))).toBe('a0');
        expect(text(searchScreen.navigate(field, 'down', container, { content: links[5] }))).toBe('b2');
        expect(searchScreen.navigate(field, 'up', container, {})).toBe(null);
    });

    test('initial focus: the first result, else the search field', () => {
        expect(text(searchScreen.initial(search([row('a', 2, 0)])))).toBe('a0');
        expect(searchScreen.initial(search([]))).toBe(document.querySelector('input'));
    });
});
