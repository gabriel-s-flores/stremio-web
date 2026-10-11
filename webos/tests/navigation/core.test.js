/**
 * @jest-environment jsdom
 */
// The navigation core (webos/lib/navigation/core): DOM helpers, routes, scrolling, memory and the
// input hub. jsdom has no layout: rects come from data-rect ("left,top,width,height"), and an element
// under [data-hidden] has no box.

const dom = require('../../lib/navigation/core/dom');
const routes = require('../../lib/navigation/core/routes');
const scroll = require('../../lib/navigation/core/scroll');
const memory = require('../../lib/navigation/core/memory');
const { PRIORITY, createInputHub } = require('../../lib/navigation/core/input');

const rectOf = (element) => {
    const value = element.getAttribute('data-rect');
    if (!value) return { left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 };
    const [left, top, width, height] = value.split(',').map(Number);
    let offset = 0;
    for (let node = element.parentElement; node; node = node.parentElement) offset += node.scrollTop || 0;
    return { left, top: top - offset, width, height, right: left + width, bottom: top - offset + height };
};

beforeAll(() => {
    Element.prototype.getBoundingClientRect = function () {
        return rectOf(this);
    };
    Element.prototype.getClientRects = function () {
        return this.closest('[data-hidden]') ? [] : [rectOf(this)];
    };
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('dom', () => {
    test('focusable: a tab index, enabled, rendered with an area', () => {
        document.body.innerHTML = `
            <div tabindex="0" id="ok"></div>
            <div id="none"></div>
            <div tabindex="-1" id="minus"></div>
            <button disabled id="disabled"></button>
            <div tabindex="0" disabled id="disabled-attribute"></div>
            <div data-hidden><a href="#" id="hidden"></a></div>
            <div tabindex="0" data-rect="0,0,10,0" id="flat"></div>
            <div tabindex="0" data-rect="0,0,0,10" id="thin"></div>`;
        const focusable = (id) => dom.isFocusable(document.getElementById(id));
        expect(['ok', 'none', 'minus', 'disabled', 'disabled-attribute', 'hidden', 'flat', 'thin'].map(focusable))
            .toEqual([true, false, false, false, false, false, false, false]);
        expect(dom.isFocusable(null)).toBe(false);
        expect(dom.isFocusable(document.createTextNode('x'))).toBe(false);
        const detached = document.createElement('button');
        expect(dom.isFocusable(detached)).toBe(false);
    });

    test('the first focusable at or inside an element, in DOM order', () => {
        document.body.innerHTML = '<div id="root" tabindex="-1"><div data-hidden><a href="#" id="a"></a></div><span><button id="b"></button></span><input id="c"></div>';
        expect(dom.firstFocusable(document.getElementById('root')).id).toBe('b');
        expect(dom.firstFocusable(document.getElementById('b')).id).toBe('b');
        expect(dom.focusablesIn(document.getElementById('root')).map((element) => element.id)).toEqual(['b', 'c']);
        expect(dom.focusablesIn(null)).toEqual([]);
        expect(dom.firstFocusable(null)).toBe(null);
    });

    test('text fields: the ones the system keyboard opens on', () => {
        document.body.innerHTML = '<input id="text"><input type="search" id="search"><textarea id="area"></textarea><input type="checkbox" id="box"><input type="range" id="range"><button id="button"></button>';
        expect(['text', 'search', 'area', 'box', 'range', 'button'].map((id) => dom.isTextField(document.getElementById(id))))
            .toEqual([true, true, true, false, false, false]);
    });

    test('CSS module names: the whole local part, SVG elements included', () => {
        document.body.innerHTML = '<div id="outer" class="board-content-container-Ab1c2"><div id="inner" class="board-content-Xy_9z other"></div></div><svg id="svg" class="icon-Ab1c2"></svg>';
        expect(dom.hasLocalName(document.getElementById('inner'), 'board-content')).toBe(true);
        expect(dom.hasLocalName(document.getElementById('outer'), 'board-content')).toBe(false);
        expect(dom.hasLocalName(document.getElementById('svg'), 'icon')).toBe(true);
        expect(dom.hasLocalName(null, 'icon')).toBe(false);
        expect(dom.queryLocal(document.body, 'board-content').id).toBe('inner');
        expect(dom.queryLocal(document.body, 'missing')).toBe(null);
        expect(dom.queryLocalAll(document.body, 'board-content-container').map((element) => element.id)).toEqual(['outer']);
        expect(dom.closestLocal(document.getElementById('inner'), ['board-content-container'], document.body).id).toBe('outer');
        expect(dom.closestLocal(document.getElementById('inner'), ['board-content-container'], document.getElementById('outer'))).toBe(null);
    });

    test('in the viewport: any part of the element on screen', () => {
        Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
        document.body.innerHTML = '<div id="in" data-rect="1900,1070,40,40"></div><div id="below" data-rect="0,1080,10,10"></div><div id="left" data-rect="-10,0,10,10"></div>';
        expect(['in', 'below', 'left'].map((id) => dom.inViewport(document.getElementById(id)))).toEqual([true, false, false]);
    });
});

describe('routes', () => {
    const page = (second = '') => {
        document.body.innerHTML = `<div class="routes-container">
            <div class="route-container" id="board"><div class="route-content">
                <nav class="vertical-nav-bar-container-Ab1c2"><a href="#/" id="tab">Board</a></nav>
                <nav class="horizontal-nav-bar-container-Ab1c2"><div tabindex="0" id="search"></div></nav>
                <a href="#/detail/x" id="poster">poster</a>
            </div><div class="modals-container"></div></div>
            ${second}
        </div>`;
    };

    test('the visible route is the last one shown', () => {
        page('<div class="route-container" id="details"><div class="route-content"></div></div>');
        expect(routes.visibleRoute(document).id).toBe('details');
        document.getElementById('details').setAttribute('data-hidden', '');
        expect(routes.visibleRoute(document).id).toBe('board');
        document.getElementById('board').setAttribute('data-hidden', '');
        expect(routes.visibleRoute(document)).toBe(null);
        expect(routes.routeOf(document.getElementById('poster')).id).toBe('board');
        expect(routes.routeOf(null)).toBe(null);
    });

    test('the focus is lost on the body, on a hidden element or a removed one', () => {
        page();
        expect(routes.isFocusLost(document)).toBe(true);
        const poster = document.getElementById('poster');
        poster.focus();
        expect(routes.isFocusLost(document)).toBe(false);
        document.getElementById('board').setAttribute('data-hidden', '');
        expect(routes.isFocusLost(document)).toBe(true);
    });

    test('the navigation bars', () => {
        page();
        const route = document.getElementById('board');
        expect(routes.inSideBar(document.getElementById('tab'), route)).toBe(true);
        expect(routes.inSideBar(document.getElementById('search'), route)).toBe(false);
        expect(routes.inNavBars(document.getElementById('search'), route)).toBe(true);
        expect(routes.inNavBars(document.getElementById('poster'), route)).toBe(false);
    });

    test('a modal over the screen: shown in the route, or anything with the class or role of one', () => {
        page();
        const route = document.getElementById('board');
        expect(routes.modalOpen(document, route)).toBe(false);
        route.querySelector('.modals-container').innerHTML = '<div class="addon-details" data-hidden></div>';
        expect(routes.modalOpen(document, route)).toBe(false);
        route.querySelector('.modals-container').innerHTML = '<div class="addon-details"><button id="close"></button></div>';
        expect(routes.modalOpen(document, route)).toBe(true);
        expect(routes.inRouteModal(document.getElementById('close'))).toBe(true);
        route.querySelector('.modals-container').innerHTML = '';
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog"></div>');
        expect(routes.modalOpen(document)).toBe(true);
    });
});

describe('scroll', () => {
    test('the offset that keeps a range inside the box with a margin', () => {
        expect(scroll.offsetInto(50, 60, 0, 100, 10)).toBe(0);
        expect(scroll.offsetInto(5, 15, 0, 100, 10)).toBe(-5);
        expect(scroll.offsetInto(95, 105, 0, 100, 10)).toBe(15);
        // Bigger than the room: to the start.
        expect(scroll.offsetInto(20, 120, 0, 100, 10)).toBe(10);
        expect(scroll.offsetInto(-30, 90, 0, 100, 0)).toBe(-30);
    });

    test('the rects in screen pixels (the TV zoom) become CSS pixels of the scroll', () => {
        document.body.innerHTML = '<div id="list" data-rect="0,100,300,350"><div id="item" data-rect="0,500,300,70"></div></div>';
        const list = document.getElementById('list');
        // Zoom 1.75: 200 CSS pixels shown as 350.
        Object.defineProperty(list, 'offsetHeight', { value: 200 });
        scroll.revealAlong(list, document.getElementById('item'), 'y', 0);
        // 500 + 70 - 450 = 120 screen pixels = 120 / 1.75 CSS pixels.
        expect(list.scrollTop).toBeCloseTo(120 / 1.75, 5);
    });

    test('the horizontal axis converts with the width (a strip under the TV zoom)', () => {
        document.body.innerHTML = '<div id="strip" data-rect="100,0,700,300"><div id="cell" data-rect="900,0,140,300"></div></div>';
        const strip = document.getElementById('strip');
        // 400 CSS pixels wide shown as 700 (zoom 1.75); the height says nothing about the width.
        Object.defineProperty(strip, 'offsetWidth', { value: 400 });
        Object.defineProperty(strip, 'offsetHeight', { value: 300 });
        scroll.revealAlong(strip, document.getElementById('cell'), 'x', 0);
        // 900 + 140 - 800 = 240 screen pixels = 240 / 1.75 CSS pixels.
        expect(strip.scrollLeft).toBeCloseTo(240 / 1.75, 5);
    });

    test('a list keeps 15% of its height past the focused item, less for a tall item', () => {
        document.body.innerHTML = '<div id="list" data-rect="0,0,300,1000"><div id="item" data-rect="0,950,300,100"></div><div id="tall" data-rect="0,1200,300,900"></div></div>';
        const list = document.getElementById('list');
        Object.defineProperty(list, 'offsetHeight', { value: 1000 });
        scroll.revealInList(list, document.getElementById('item'));
        expect(list.scrollTop).toBe(1050 - 1000 + 150);
        list.scrollTop = 0;
        scroll.revealInList(list, document.getElementById('tall'));
        // (1000 - 900) / 2 = 50 pixels of margin.
        expect(list.scrollTop).toBe(2100 - 1000 + 50);
    });

    test('scroll offsets stay in the scrollable range', () => {
        const node = document.createElement('div');
        Object.defineProperty(node, 'scrollHeight', { value: 1000 });
        Object.defineProperty(node, 'clientHeight', { value: 400 });
        let top = 0;
        Object.defineProperty(node, 'scrollTop', { get: () => top, set: (value) => { top = value; } });
        scroll.scrollTopTo(node, 900);
        expect(top).toBe(600);
        scroll.scrollTopTo(node, -50);
        expect(top).toBe(0);
        scroll.scrollTopTo(node, 300);
        expect(top).toBe(300);
    });

    test('keepInView scrolls each scrollable ancestor, inner first, up to the stop', () => {
        document.body.innerHTML = '<div id="stop"><div id="outer" data-rect="0,0,500,400"><div id="inner" data-rect="0,0,500,200"><div id="item" data-rect="0,300,100,50"></div></div></div></div>';
        const set = (id) => {
            const node = document.getElementById(id);
            node.style.overflowY = 'auto';
            Object.defineProperty(node, 'scrollHeight', { value: 2000 });
            Object.defineProperty(node, 'clientHeight', { value: id === 'inner' ? 200 : 400 });
            Object.defineProperty(node, 'offsetHeight', { value: id === 'inner' ? 200 : 400 });
            return node;
        };
        const inner = set('inner');
        const outer = set('outer');
        scroll.keepInView(document.getElementById('item'), document.getElementById('stop'));
        // Margin: half the item (25) up to a quarter of the box (50): 350 + 25 - 200.
        expect(inner.scrollTop).toBe(175);
        // The item is at 300 - 175 - 0 = 125 in the outer box (400 high): already inside.
        expect(outer.scrollTop).toBe(0);
        inner.scrollTop = 0;
        scroll.keepInView(document.getElementById('item'), inner);
        expect(inner.scrollTop).toBe(0);
    });
});

describe('memory', () => {
    test('the bars and the modals are not remembered', () => {
        document.body.innerHTML = `<div class="route-container" id="route"><div class="route-content" id="content">
            <nav class="vertical-nav-bar-container-Ab1c2"><a href="#/" id="tab"></a></nav>
            <nav class="horizontal-nav-bar-container-Ab1c2"><div tabindex="0" id="search"></div></nav>
            <a href="#/x" id="poster"></a></div><div class="modals-container"><button id="close"></button></div></div>`;
        const content = document.getElementById('content');
        expect(['tab', 'search', 'poster', 'close'].map((id) => memory.isMemorable(document.getElementById(id), content)))
            .toEqual([false, false, true, false]);
    });

    test('a place in the tree, and what is there after a re-render', () => {
        document.body.innerHTML = '<div id="root"><div><span></span><a href="#/a" id="a"></a></div><div><button id="b"></button></div></div>';
        const root = document.getElementById('root');
        expect(memory.pathOf(document.getElementById('b'), root)).toEqual([1, 0]);
        expect(memory.pathOf(document.getElementById('b'), document.createElement('div'))).toBe(null);
        expect(memory.resolvePath([1, 0], root).id).toBe('b');
        // The node at that index is gone: inside the deepest one that is still there.
        root.children[1].innerHTML = '<span><a href="#/c" id="c"></a></span>';
        expect(memory.resolvePath([1, 3], root).id).toBe('c');
        expect(memory.resolvePath([5], root)).toBe(null);
        expect(memory.resolvePath(null, root)).toBe(null);
    });

    test('an element found again after a remount: by its link, its label, its position', () => {
        document.body.innerHTML = '<div id="section"><a href="#/one" title="One">One</a><a href="#/two" title="Two">Two</a><div tabindex="0" title="Three">Three</div></div>';
        const section = document.getElementById('section');
        const located = memory.locate(section.children[2], section);
        expect(located).toEqual({ href: null, title: 'Three', text: 'Three', index: 2 });
        section.innerHTML = '<div tabindex="0" title="Three">Three</div><a href="#/two" title="2">2</a>';
        expect(memory.resolve(located, section).textContent).toBe('Three');
        expect(memory.resolve({ href: '#/two', title: null, text: '', index: 9 }, section).textContent).toBe('2');
        expect(memory.resolve({ href: null, title: 'x', text: 'x', index: 1 }, section).textContent).toBe('2');
        expect(memory.resolve({ href: null, title: 'x', text: 'x', index: 7 }, section)).toBe(null);
    });

    test('a keyed memory keeps the last keys', () => {
        const keyed = memory.createKeyedMemory(2);
        keyed.set('a', 1);
        keyed.set('b', 2);
        keyed.set('a', 3);
        keyed.set('c', 4);
        expect([keyed.get('a'), keyed.get('b'), keyed.get('c'), keyed.size]).toEqual([3, undefined, 4, 2]);
        keyed.clear();
        expect(keyed.size).toBe(0);
    });
});

describe('input hub', () => {
    const spyListeners = () => {
        const added = [];
        const removed = [];
        const wrap = (target) => {
            const add = target.addEventListener.bind(target);
            const remove = target.removeEventListener.bind(target);
            jest.spyOn(target, 'addEventListener').mockImplementation((type, ...rest) => {
                added.push(type);
                add(type, ...rest);
            });
            jest.spyOn(target, 'removeEventListener').mockImplementation((type, ...rest) => {
                removed.push(type);
                remove(type, ...rest);
            });
        };
        wrap(window);
        wrap(document);
        return { added, removed };
    };

    afterEach(() => jest.restoreAllMocks());

    const press = (keyCode = 40) => {
        const event = new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true });
        (document.activeElement || document.body).dispatchEvent(event);
        return event;
    };

    test('one keydown and one focusin listener for every handler, removed with the last one', () => {
        const { added, removed } = spyListeners();
        const hub = createInputHub(window);
        const removers = [hub.onKey(() => {}), hub.onKey(() => {}), hub.onFocus(() => {}), hub.onFocus(() => {})];
        expect(added.filter((type) => type === 'keydown')).toHaveLength(1);
        expect(added.filter((type) => type === 'focusin')).toHaveLength(1);
        expect(hub.listeners).toEqual({ keys: 2, focus: 2, installed: true });
        removers.slice(0, 3).forEach((remove) => remove());
        expect(removed).toHaveLength(0);
        removers[3]();
        expect(removed.filter((type) => type === 'keydown')).toHaveLength(1);
        expect(removed.filter((type) => type === 'focusin')).toHaveLength(1);
        expect(hub.listeners.installed).toBe(false);
        // Removing twice does nothing.
        removers[3]();
        expect(removed.filter((type) => type === 'keydown')).toHaveLength(1);
    });

    test('key handlers run by priority, then in order; true stops the ones after', () => {
        const hub = createInputHub(window);
        const calls = [];
        const removers = [
            hub.onKey(() => calls.push('screen'), PRIORITY.screen),
            hub.onKey(() => calls.push('overlay'), PRIORITY.overlay),
            hub.onKey(() => calls.push('screen 2'), PRIORITY.screen),
            hub.onKey(() => calls.push('global'), PRIORITY.global),
            hub.onKey(() => calls.push('colors')),
        ];
        press();
        expect(calls).toEqual(['overlay', 'global', 'screen', 'screen 2', 'colors']);
        removers.forEach((remove) => remove());
        calls.length = 0;
        const stop = [hub.onKey(() => calls.push('first') && true, PRIORITY.overlay), hub.onKey(() => calls.push('second'))];
        press();
        expect(calls).toEqual(['first']);
        stop.forEach((remove) => remove());
    });

    test('a handler removed while the key runs does not break the others', () => {
        const hub = createInputHub(window);
        const calls = [];
        let removeSecond = null;
        const removeFirst = hub.onKey(() => {
            calls.push('first');
            removeSecond();
        });
        removeSecond = hub.onKey(() => calls.push('second'));
        press();
        expect(calls).toEqual(['first', 'second']);
        removeFirst();
    });

    test('focus handlers get every focusin', () => {
        const hub = createInputHub(window);
        const seen = [];
        const remove = hub.onFocus((event) => seen.push(event.target.id));
        document.body.innerHTML = '<button id="a"></button><button id="b"></button>';
        document.getElementById('a').focus();
        document.getElementById('b').focus();
        expect(seen).toEqual(['a', 'b']);
        remove();
    });

    test('the input mode: keys, a trusted pointer, the Magic Remote cursor', () => {
        const hub = createInputHub(window, { isTrusted: (event) => event.clientX !== 99 });
        const remove = hub.onKey(() => {});
        expect(hub.lastInput).toBe(null);
        expect(hub.isKeyInput()).toBe(true);
        window.dispatchEvent(new MouseEvent('mousedown', { clientX: 99 }));
        expect(hub.lastInput).toBe(null);
        const before = Date.now();
        window.dispatchEvent(new MouseEvent('mousedown', { clientX: 1 }));
        expect(hub.lastInput).toBe('pointer');
        expect(hub.lastPointerDown).toBeGreaterThanOrEqual(before);
        expect(hub.isKeyInput()).toBe(false);
        press();
        expect(hub.lastInput).toBe('key');
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1 }));
        expect(hub.lastInput).toBe('pointer');
        document.dispatchEvent(new CustomEvent('cursorStateChange', { detail: { visibility: false } }));
        expect(hub.lastInput).toBe('key');
        document.dispatchEvent(new CustomEvent('cursorStateChange', { detail: { visibility: true } }));
        expect(hub.lastInput).toBe('pointer');
        document.dispatchEvent(new CustomEvent('cursorStateChange', { detail: {} }));
        expect(hub.lastInput).toBe('pointer');
        remove();
    });

    test('a pointer move alone (Chromium sends trusted ones when the layout moves under a still cursor) is no pointer use; the overlays still count it', () => {
        const hub = createInputHub(window, { isTrusted: () => true });
        const remove = hub.onKey(() => {});
        press();
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1 }));
        expect(hub.pointerInUse()).toBe(false);
        expect(hub.isKeyInput()).toBe(false);
        window.dispatchEvent(new MouseEvent('mousedown', { clientX: 1 }));
        expect(hub.pointerInUse()).toBe(true);
        press();
        expect(hub.pointerInUse()).toBe(false);
        document.dispatchEvent(new CustomEvent('cursorStateChange', { detail: { visibility: true } }));
        expect(hub.pointerInUse()).toBe(true);
        remove();
    });

    test('the pointer is in use: shown, or the last input before webos/magic-remote tells', () => {
        const hub = createInputHub(window);
        const root = document.documentElement;
        expect(hub.pointerInUse()).toBe(false);
        hub.setLastInput('pointer');
        expect(hub.pointerInUse()).toBe(true);
        root.setAttribute('data-webos-pointer', 'hidden');
        expect(hub.pointerInUse()).toBe(false);
        root.setAttribute('data-webos-pointer', 'visible');
        hub.setLastInput('key');
        expect(hub.pointerInUse()).toBe(true);
        root.removeAttribute('data-webos-pointer');
    });
});
