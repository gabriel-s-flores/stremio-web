/**
 * @jest-environment jsdom
 */
// Remote navigation of the Board, Discover and Search (first written as F4.1a): the screen focus of
// webos/lib/navigation/core/screenFocus.js and the screens. jsdom has no layout, so the geometry comes
// from data attributes (see `layout` below); the real thing runs in the emulator
// (webos/tests/navigation/emulator/f4.1a.mjs).

const { createScreenFocus } = require('../../lib/navigation/core/screenFocus');
const { pathOf, resolvePath } = require('../../lib/navigation/core/memory');
const { queryLocal, hasLocalName } = require('../../lib/navigation/core/dom');
const { boardScreen, fromTopBar, navigateRows } = require('../../lib/navigation/board');
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

const searchMenu = '<div class="menu-container-OOOOO"><div class="items-PPPPP"><div class="title-QQQQQ"><div>History</div><button class="search-history-clear">Clear history</button></div>' +
    '<div class="item-RRRRR" tabindex="0">superman</div></div><div class="items-PPPPP"><div class="item-RRRRR" tabindex="0">supergirl</div></div></div>';

const topBar = (menu = '') => `<nav class="horizontal-nav-bar-container-IIIII"><div class="search-bar-container-JJJJJ"><input tabindex="-1"><div class="submit-button-container-KKKKK" tabindex="0"></div>${menu}</div></nav>`;

const mount = (html) => {
    document.body.innerHTML = `<div class="routes-container"><div class="route-container"><div class="route-content">${html}</div></div></div>`;
    const container = document.querySelector('.route-content');
    container.querySelectorAll('[class*="board-content-"], [class*="search-content-"], [class*="meta-items-container-"]').forEach((element) => {
        element.scrollTop = 0;
        element.scrollLeft = 0;
    });
    return container;
};

const board = (rows) => mount(`<div class="board-container-LLLLL">${topBar()}<div class="board-content-container-MMMMM"><div class="board-content-NNNNN" data-height="200" data-scroll-height="1000">${rows.join('')}</div></div></div>`);

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

    test('a row still loading below comes into view by the least, and the focus waits', () => {
        board([row('a', 2, 0), placeholderRow(300)]);
        const links = document.querySelectorAll('a');
        expect(navigateRows(links[0], 'down', list())).toBe(true);
        // Its top 8px into the 200px list: the focused row keeps its place (and its title).
        expect(list().scrollTop).toBe(108);
        // Already showing: no scroll.
        expect(navigateRows(links[0], 'down', list())).toBe(true);
        expect(list().scrollTop).toBe(108);
    });

    test('a row still loading above comes into view by its bottom edge', () => {
        board([placeholderRow(0), row('a', 2, 300)]);
        list().scrollTop = 300;
        expect(navigateRows(document.querySelectorAll('a')[0], 'up', list())).toBe(true);
        expect(list().scrollTop).toBe(92);
    });

    test('the rows are aligned against the first one, wherever the list starts it', () => {
        const container = board([row('a', 3, 20), row('b', 3, 120), row('c', 3, 220)]);
        boardScreen.align(container.querySelectorAll('a')[3], container);
        expect(list().scrollTop).toBe(100);
    });

    test('down from the top bar with nothing left: the first item of the first row on screen', () => {
        const container = board([row('a', 3, 0), row('b', 3, 100), row('c', 3, 200)]);
        list().scrollTop = 150;
        const button = container.querySelector('[class*="submit-button-container"]');
        expect(text(fromTopBar(button, 'down', container, list(), {}))).toBe('b0');
        list().scrollTop = 0;
        expect(text(fromTopBar(button, 'down', container, list(), {}))).toBe('a0');
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

    test('the initial focus does not steal the focus from outside the screen either (a dialog of the app)', async () => {
        const container = board([placeholderRow(0)]);
        focus = createScreenFocus(container, boardScreen);
        focus.ensureFocus();
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();
        queryLocal(container, 'board-content').innerHTML = row('a', 3, 0);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.activeElement).toBe(outside);
        outside.remove();
    });

    test('the wait for the initial focus ends as soon as the user moves, and its timer with it', () => {
        jest.useFakeTimers();
        try {
            const container = board([placeholderRow(0)]);
            focus = createScreenFocus(container, boardScreen);
            focus.ensureFocus();
            expect(focus.waiting).toBe(true);
            expect(jest.getTimerCount()).toBe(1);
            container.querySelector('[class*="submit-button-container"]').focus();
            expect(focus.waiting).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
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

    test('an arrow another handler already took (the quit dialog, the nav bar of F4.1b) is left alone', () => {
        const container = board([row('a', 3, 0)]);
        focus = createScreenFocus(container, boardScreen);
        const links = container.querySelectorAll('a');
        links[0].focus();
        links[0].addEventListener('keydown', (event) => event.preventDefault(), { once: true });
        press(RIGHT);
        expect(document.activeElement.textContent).toBe('a0');
    });

    test('restore scrolls the lists back to the element', () => {
        const container = board([row('a', 6, 0), row('b', 6, 100), row('c', 6, 200)]);
        focus = createScreenFocus(container, boardScreen);
        container.querySelectorAll('a')[9].focus();
        focus.leave();
        const content = queryLocal(container, 'board-content');
        // Still focused (no focusin to align it): restore itself scrolls.
        content.scrollTop = 0;
        expect(focus.restore()).toBe(true);
        expect(document.activeElement.textContent).toBe('b3');
        expect(content.scrollTop).toBe(100);
    });

    test('restore does nothing while the route is hidden or a dialog is open', () => {
        const container = board([row('a', 3, 0)]);
        focus = createScreenFocus(container, boardScreen);
        container.querySelectorAll('a')[2].focus();
        focus.leave();
        const button = container.querySelector('[class*="submit-button-container"]');
        button.focus();
        container.parentElement.setAttribute('data-hidden', '');
        expect(focus.restore()).toBe(false);
        container.parentElement.removeAttribute('data-hidden');
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        document.body.appendChild(dialog);
        expect(focus.restore()).toBe(false);
        expect(document.activeElement).toBe(button);
        dialog.remove();
    });

    test('the initial focus stops waiting after its timeout', () => {
        jest.useFakeTimers();
        try {
            const container = board([placeholderRow(0)]);
            focus = createScreenFocus(container, boardScreen, { timeout: 1000 });
            focus.ensureFocus();
            jest.advanceTimersByTime(1001);
            queryLocal(container, 'board-content').innerHTML = row('a', 3, 0);
            return Promise.resolve().then(() => {
                expect(document.activeElement).toBe(document.body);
            });
        } finally {
            jest.useRealTimers();
        }
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
    const discover = (cells) => mount(`<div class="discover-container-UUUUU">${topBar()}<div class="catalog-container-VVVVV">${filters}<div class="meta-items-container-WWWWW" data-height="150" data-scroll-height="400">${cells.join('')}</div></div></div>`);
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

    test('initial focus: the first filter until the catalog shows, then its first item', async () => {
        const container = mount(`<div class="discover-container-UUUUU"><div class="catalog-container-VVVVV">${filters}</div></div>`);
        const focus = createScreenFocus(container, discoverScreen);
        expect(focus.ensureFocus()).toBe(true);
        expect(document.activeElement.textContent).toBe('Type');
        const grid = document.createElement('div');
        grid.className = 'meta-items-container-WWWWW';
        grid.innerHTML = cell('0', 0, 0) + cell('1', 0, 200);
        container.querySelector('[class*="catalog-container"]').appendChild(grid);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.activeElement.textContent).toBe('0');
        focus.destroy();
    });

    test('initial focus: a filter the user moved to stays', async () => {
        const container = mount(`<div class="discover-container-UUUUU"><div class="catalog-container-VVVVV">${filters}</div></div>`);
        const focus = createScreenFocus(container, discoverScreen);
        focus.ensureFocus();
        container.querySelectorAll('[aria-haspopup]')[1].focus();
        const grid = document.createElement('div');
        grid.className = 'meta-items-container-WWWWW';
        grid.innerHTML = cell('0', 0, 0);
        container.querySelector('[class*="catalog-container"]').appendChild(grid);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.activeElement.textContent).toBe('Catalog');
        focus.destroy();
    });

    test('down from a filter with nothing left: the first item on screen of the scrolled grid', () => {
        const container = grid3x2();
        grid().scrollTop = 110;
        const type = container.querySelector('[aria-haspopup]');
        expect(text(discoverScreen.navigate(type, 'down', container, {}))).toBe('3');
    });

    test('the focused line goes to the top of the grid', () => {
        const container = grid3x2();
        discoverScreen.align(link('4'), container);
        expect(grid().scrollTop).toBe(120);
    });
});

describe('Search', () => {
    const search = (rows) => mount(`<div class="search-container-YYYYY">${topBar()}<div class="search-content-ZZZZZ" data-height="200" data-scroll-height="1000">${rows.join('')}</div></div>`);

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

    test('with the history menu open, down goes into it; down on its last entry goes to the results and closes it', () => {
        const container = mount(`<div class="search-container-YYYYY">${topBar(searchMenu)}<div class="search-content-ZZZZZ" data-height="200" data-scroll-height="1000">${row('a', 3, 0)}</div></div>`);
        const field = container.querySelector('input');
        const entries = container.querySelectorAll('[class*="menu-container"] [tabindex], [class*="menu-container"] button');
        const pressed = [];
        document.addEventListener('mousedown', (event) => pressed.push(event.target), { once: true });
        expect(searchScreen.navigate(field, 'down', container, {})).toBe(null);
        expect(searchScreen.navigate(entries[0], 'down', container, {})).toBe(null);
        expect(pressed).toEqual([]);
        const last = Array.prototype.find.call(entries, (element) => element.textContent === 'supergirl');
        const links = container.querySelectorAll('a');
        expect(text(searchScreen.navigate(last, 'down', container, { content: links[2] }))).toBe('a2');
        // A press outside the search bar: the SearchBar closes its menu.
        expect(pressed).toEqual([document.body]);
    });

    test('recovering the focus: the search button, not the field (it opens the system keyboard)', () => {
        const container = search([]);
        expect(searchScreen.initial(container, { recovering: true })).toBe(container.querySelector('[class*="submit-button-container"]'));
        const focus = createScreenFocus(container, searchScreen);
        press(DOWN, document.body);
        expect(document.activeElement.className).toMatch(/submit-button-container/);
        focus.destroy();
    });

    test('initial focus: the first result, else the search field', () => {
        expect(text(searchScreen.initial(search([row('a', 2, 0)])))).toBe('a0');
        expect(searchScreen.initial(search([]))).toBe(document.querySelector('input'));
    });
});

// F4.4: the consolidation's fixes and the cases the reviews found without a test.
describe('F4.4', () => {
    let focus;
    afterEach(() => {
        if (focus) focus.destroy();
        focus = null;
        document.documentElement.removeAttribute('data-webos-pointer');
    });

    const list = () => queryLocal(document, 'board-content');
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const sideBar = '<nav class="vertical-nav-bar-container-XXXXX"><a class="nav-tab-button-YYYYY" href="#/discover" tabindex="0">Discover</a></nav>';
    const search = (rows, menu = '') => mount(`<div class="search-container-YYYYY">${topBar(menu)}<div class="search-content-ZZZZZ" data-height="200" data-scroll-height="1000">${rows.join('')}</div></div>`);
    const posters = (container) => container.querySelectorAll('a.meta-item-link-BBBBB');

    test('Board: left through the side bar, back to the content (the bar is not remembered)', () => {
        const container = board([row('a', 3, 0)]);
        container.insertAdjacentHTML('afterbegin', sideBar);
        focus = createScreenFocus(container, boardScreen);
        posters(container)[1].focus();
        container.querySelector('[class*="nav-tab-button"]').focus();
        expect(text(focus.memory.last)).toBe('a1');
        // Discover opened from the bar, then the Board again.
        focus.leave();
        const route = container.parentElement;
        route.setAttribute('data-hidden', '');
        document.activeElement.blur();
        route.removeAttribute('data-hidden');
        focus.restore();
        expect(text(document.activeElement)).toBe('a1');
    });

    test('Board: up from the first row goes to the top bar, never to the side bar', () => {
        const container = board([row('a', 2, 0)]);
        container.insertAdjacentHTML('afterbegin', sideBar);
        const first = posters(container)[0];
        let searched = null;
        first.spatialNavigationSearch = (dir, options) => {
            searched = { dir, ...options };
            return options.candidates[0];
        };
        focus = createScreenFocus(container, boardScreen);
        first.focus();
        expect(press(UP).defaultPrevented).toBe(true);
        expect(document.activeElement.className).toMatch(/submit-button-container/);
        const bar = queryLocal(container, 'horizontal-nav-bar-container');
        expect(searched.dir).toBe('up');
        expect(searched.container).toBe(bar);
        expect(searched.candidates.length).toBeGreaterThan(0);
        expect(searched.candidates.every((candidate) => bar.contains(candidate))).toBe(true);
        // From a row below: the row above, not the bar.
        expect(navigateRows(first, 'down', list())).toBe(true);
    });

    test('Board: up from something of the list that is not a row item (a header link) is the spatial navigation\'s', () => {
        const container = board([row('a', 2, 0).replace('<div>a</div>', '<a class="see-all-ZZZZZ" href="#/all" tabindex="0">a</a>')]);
        const header = container.querySelector('a.see-all-ZZZZZ');
        header.spatialNavigationSearch = () => container.querySelector('[class*="submit-button-container"]');
        focus = createScreenFocus(container, boardScreen);
        header.focus();
        expect(press(UP).defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(header);
    });

    test('the realign after a peek happens once: the list scrolled later is left alone', async () => {
        const container = board([row('a', 2, 0).replace('data-height="100"', 'data-height="220"'), placeholderRow(230), placeholderRow(460)]);
        focus = createScreenFocus(container, boardScreen);
        posters(container)[0].focus();
        press(DOWN);
        list().children[1].outerHTML = messageRow(230);
        await flush();
        expect(list().scrollTop).toBe(0);
        list().scrollTop = 50;
        list().children[2].appendChild(document.createElement('div'));
        await flush();
        expect(list().scrollTop).toBe(50);
    });

    test('a list that left the page forgets its peek: put back, its row loading later does not realign it (F7.3)', async () => {
        const container = board([row('a', 2, 0).replace('data-height="100"', 'data-height="220"'), placeholderRow(230)]);
        focus = createScreenFocus(container, boardScreen);
        const links = posters(container);
        links[0].focus();
        expect(press(DOWN).defaultPrevented).toBe(true);
        expect(list().scrollTop).toBe(38);
        // The list goes away with the peek pending, and comes back (its mutation is seen in between).
        const gone = list();
        gone.remove();
        await flush();
        container.appendChild(gone);
        await flush();
        links[0].focus();
        gone.scrollTop = 50;
        // The row it had peeked at loads: no peek is left to realign (the old one is not this list's now).
        gone.children[1].outerHTML = messageRow(230);
        await flush();
        expect(list().scrollTop).toBe(50);
    });

    test('Search: a one letter query is a query (its button is the clear one)', () => {
        const container = search([placeholderRow(0)]);
        container.querySelector('input').value = 'b';
        expect(searchScreen.initial(container, { recovering: true })).toBe(null);
    });

    test('Board: nothing above the first row and no top bar: the spatial navigation', () => {
        const container = mount(`<div class="board-container-LLLLL"><div class="board-content-NNNNN" data-height="200">${row('a', 2, 0)}</div></div>`);
        focus = createScreenFocus(container, boardScreen);
        posters(container)[0].focus();
        expect(press(UP).defaultPrevented).toBe(false);
    });

    test('a focused row taller than the list: once the row it peeked at is loaded, its title comes back', async () => {
        const container = board([row('a', 2, 0).replace('data-height="100"', 'data-height="220"'), placeholderRow(230)]);
        focus = createScreenFocus(container, boardScreen);
        const links = posters(container);
        links[0].focus();
        expect(list().scrollTop).toBe(0);
        // The row below loads only once it shows: 8px of it, at the cost of the focused row's title.
        expect(press(DOWN).defaultPrevented).toBe(true);
        expect(list().scrollTop).toBe(38);
        expect(document.activeElement).toBe(links[0]);
        // Still loading (the placeholder re-renders): nothing moves.
        list().children[1].appendChild(document.createElement('div'));
        await flush();
        expect(list().scrollTop).toBe(38);
        // It loaded (an addon error here): the focused row back at the top, title included.
        list().children[1].outerHTML = messageRow(230);
        await flush();
        expect(list().scrollTop).toBe(0);
    });

    test('Search: the same realign after a peek (the review case: zoom 1.75, the rows below turning into addon errors)', async () => {
        const container = search([row('a', 2, 0).replace('data-height="100"', 'data-height="220"'), placeholderRow(230)]);
        focus = createScreenFocus(container, searchScreen);
        const results = () => queryLocal(container, 'search-content');
        posters(container)[0].focus();
        press(DOWN);
        expect(results().scrollTop).toBe(38);
        results().children[1].outerHTML = messageRow(230);
        await flush();
        expect(results().scrollTop).toBe(0);
    });

    test('memory of the top bar: Board, Discover and Search remember it (Back from Search lands on its button), the lists screens do not', () => {
        expect([boardScreen.rememberTopBar, searchScreen.rememberTopBar, discoverScreen.rememberTopBar]).toEqual([true, true, true]);
        const container = board([row('a', 3, 0)]);
        container.insertAdjacentHTML('afterbegin', sideBar);
        focus = createScreenFocus(container, boardScreen);
        posters(container)[1].focus();
        const button = container.querySelector('[class*="submit-button-container"]');
        button.focus();
        expect(focus.memory.last).toBe(button);
        container.querySelector('[class*="nav-tab-button"]').focus();
        expect(focus.memory.last).toBe(button);
        // DOWN from the top bar still goes back to the content.
        expect(text(focus.memory.content)).toBe('a1');
    });

    test('the realign after a peek: not when the focus moved away, nor under the Magic Remote pointer', async () => {
        const tall = row('a', 2, 0).replace('data-height="100"', 'data-height="220"');
        let container = board([tall, placeholderRow(230)]);
        focus = createScreenFocus(container, boardScreen);
        posters(container)[0].focus();
        press(DOWN);
        document.documentElement.setAttribute('data-webos-pointer', 'visible');
        list().children[1].outerHTML = messageRow(230);
        await flush();
        expect(list().scrollTop).toBe(38);
        focus.destroy();
        document.documentElement.removeAttribute('data-webos-pointer');
        container = board([tall, placeholderRow(230)]);
        focus = createScreenFocus(container, boardScreen);
        posters(container)[0].focus();
        press(DOWN);
        document.activeElement.blur();
        list().children[1].outerHTML = messageRow(230);
        await flush();
        expect(list().scrollTop).toBe(38);
    });

    test('a row peeked at near the end or the start of the list: the scroll stays in range', () => {
        // Near the end: 350 - 200 + 8 would pass the 100px the list can scroll.
        board([row('a', 2, 0), placeholderRow(350)].map((html, index) => (index === 0 ? html : html)));
        list().setAttribute('data-scroll-height', '300');
        expect(navigateRows(document.querySelectorAll('a')[0], 'down', list())).toBe(true);
        expect(list().scrollTop).toBe(100);
        // Near the start: a short row above, its bottom 8px would be above the top of the list.
        board([placeholderRow(0).replace('data-height="100"', 'data-height="5"'), row('a', 2, 300)]);
        list().scrollTop = 300;
        expect(navigateRows(document.querySelectorAll('a')[0], 'up', list())).toBe(true);
        expect(list().scrollTop).toBe(0);
    });

    test('Discover: filters that render after the screen mounted still take the focus until the catalog shows', async () => {
        const container = mount('<div class="discover-container-UUUUU"><div class="catalog-container-VVVVV"></div></div>');
        focus = createScreenFocus(container, discoverScreen);
        expect(focus.ensureFocus()).toBe(false);
        container.querySelector('[class*="catalog-container"]').insertAdjacentHTML('beforeend',
            '<div class="selectable-inputs-container-PPPPP"><div class="multiselect-menu-RRRRR" data-left="0"><div tabindex="0" aria-haspopup="listbox" aria-expanded="false">Type</div></div></div>');
        await flush();
        expect(document.activeElement.textContent).toBe('Type');
        container.querySelector('[class*="catalog-container"]').insertAdjacentHTML('beforeend',
            '<div class="meta-items-container-WWWWW"><div class="meta-item-container-AAAAA" data-top="0" data-left="0" data-height="100"><a class="meta-item-link-BBBBB" href="#/x" tabindex="0">0</a></div></div>');
        await flush();
        expect(document.activeElement.textContent).toBe('0');
    });

    test('Search: with a query in the field the recovery waits for its first result (the button next to the field clears it)', async () => {
        const container = search([placeholderRow(0)]);
        container.querySelector('input').value = 'batman';
        expect(searchScreen.initial(container, { recovering: true })).toBe(null);
        focus = createScreenFocus(container, searchScreen);
        expect(press(DOWN, document.body).defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(document.body);
        queryLocal(container, 'search-content').innerHTML = row('r', 2, 0);
        await flush();
        expect(text(document.activeElement)).toBe('r0');
    });

    test('Search: a focused result hidden under the focus gives it to the search button, not to the field', async () => {
        const container = search([row('a', 2, 0)]);
        focus = createScreenFocus(container, searchScreen);
        const result = posters(container)[0];
        result.focus();
        queryLocal(container, 'search-content').setAttribute('data-hidden', '');
        result.blur();
        await flush();
        expect(document.activeElement.className).toMatch(/submit-button-container/);
    });

    test('Search: back on the route with nothing left to restore, the search button and not the field', () => {
        const container = search([]);
        focus = createScreenFocus(container, searchScreen);
        focus.leave();
        // The SearchBar focuses its field whenever the route comes back.
        container.querySelector('input').focus();
        expect(focus.restore()).toBe(true);
        expect(document.activeElement.className).toMatch(/submit-button-container/);
    });

    test('Search: a history menu that is not shown is not entered; leaving the menu sends a whole press', () => {
        const hidden = searchMenu.replace('class="menu-container-OOOOO"', 'class="menu-container-OOOOO" data-hidden');
        let container = search([row('a', 2, 0)], hidden);
        const field = container.querySelector('input');
        expect(text(searchScreen.navigate(field, 'down', container, {}))).toBe('a0');
        container = search([row('a', 2, 0)], searchMenu);
        const events = [];
        ['mousedown', 'mouseup'].forEach((type) => document.body.addEventListener(type, (event) => events.push(`${event.type} ${event.button}`), { once: true }));
        const last = Array.prototype.find.call(container.querySelectorAll('[tabindex]'), (element) => element.textContent === 'supergirl');
        expect(text(searchScreen.navigate(last, 'down', container, {}))).toBe('a0');
        expect(events).toEqual(['mousedown 0', 'mouseup 0']);
    });
});
