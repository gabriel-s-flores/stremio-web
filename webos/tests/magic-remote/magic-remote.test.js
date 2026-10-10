const { install, closestFocusable, MODE_ATTRIBUTE } = require('../../magic-remote');
const { createHoverRules, disabledSelector } = require('../../magic-remote/hoverRules');
const { install: installPointerEvents } = require('../../polyfills/pointer-events');

// Minimal DOM: what the module touches. Real behaviour is checked in the emulator by the F4.2 probe.
class FakeMouseEvent extends Event {
    constructor(type, init = {}) {
        super(type, init);
        ['clientX', 'clientY', 'button', 'buttons', 'relatedTarget'].forEach((key) => {
            Object.defineProperty(this, key, { value: init[key] === undefined ? null : init[key], enumerable: true });
        });
    }
}

class FakeElement extends EventTarget {
    constructor(name, { tabIndex = -1, parent = null, disabled = false } = {}) {
        super();
        this.name = name;
        this.tabIndex = tabIndex;
        this.disabled = disabled;
        this.parentNode = parent;
        this.nodeType = 1;
        this.attributes = {};
        this.dispatched = [];
    }
    hasAttribute(name) {
        return name in this.attributes;
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }
    getAttribute(name) {
        return this.attributes[name];
    }
    contains(node) {
        for (let current = node; current; current = current.parentNode) {
            if (current === this) return true;
        }
        return false;
    }
    dispatchEvent(event) {
        this.dispatched.push(event);
        return super.dispatchEvent(event);
    }
    focus() {
        this.ownerDocument.activeElement = this;
    }
}

const createPage = () => {
    const html = new FakeElement('html');
    const body = new FakeElement('body', { parent: html });
    const row = new FakeElement('row', { parent: body });
    const poster = new FakeElement('poster', { tabIndex: 0, parent: row });
    const image = new FakeElement('image', { parent: poster });
    const other = new FakeElement('other', { tabIndex: 0, parent: row });
    const documentListeners = {};
    const windowListeners = {};
    const document = {
        documentElement: html,
        body,
        activeElement: body,
        under: image,
        elementFromPoint() {
            return this.under;
        },
        addEventListener(type, listener) {
            documentListeners[type] = listener;
        },
    };
    [html, body, row, poster, image, other].forEach((element) => {
        element.ownerDocument = document;
    });
    const window = {
        document,
        MouseEvent: FakeMouseEvent,
        addEventListener(type, listener) {
            (windowListeners[type] = windowListeners[type] || []).push(listener);
        },
    };
    installPointerEvents(window);
    const hoverRules = { enabled: true, setEnabled: jest.fn((value) => { hoverRules.enabled = value; }) };
    const state = install(window, document, hoverRules);
    const cursor = (visibility) => documentListeners.cursorStateChange({ type: 'cursorStateChange', detail: { visibility } });
    const mouse = (type, target, x = 100, y = 200) => (windowListeners[type] || []).forEach((listener) => {
        listener({ type, target, isTrusted: true, clientX: x, clientY: y, button: 0, buttons: 0, relatedTarget: null });
    });
    return { window, document, html, body, row, poster, image, other, hoverRules, state, cursor, mouse };
};

const types = (element) => element.dispatched.map((event) => event.type);

describe('Magic Remote: cursorStateChange', () => {
    test('hiding the pointer switches the hover off and focuses the item under it', () => {
        const page = createPage();
        page.mouse('mousemove', page.image);
        page.image.dispatched.length = 0;
        page.cursor(false);
        expect(page.state.visible).toBe(false);
        expect(page.html.getAttribute(MODE_ATTRIBUTE)).toBe('hidden');
        expect(page.hoverRules.setEnabled).toHaveBeenLastCalledWith(false);
        // pointerout leaving the page: React fires onPointerLeave up to the root, react-aria ends the hover.
        expect(types(page.image)).toEqual(['pointerout']);
        expect(page.image.dispatched[0]).toMatchObject({ relatedTarget: null, bubbles: true, pointerType: 'mouse', clientX: 100, clientY: 200 });
        expect(page.document.activeElement).toBe(page.poster);
    });

    test('the focus is not moved when it is already inside the item, or nothing focusable is under the pointer', () => {
        const page = createPage();
        page.mouse('mousemove', page.image);
        page.document.activeElement = page.image;
        page.cursor(false);
        expect(page.document.activeElement).toBe(page.image);

        const empty = createPage();
        empty.mouse('mousemove', empty.row);
        empty.document.under = empty.row;
        empty.document.activeElement = empty.other;
        empty.cursor(false);
        expect(empty.document.activeElement).toBe(empty.other);
    });

    test('uses the element under the last position, which may have changed since the mouse event', () => {
        const page = createPage();
        page.mouse('mousemove', page.row);
        page.document.under = page.other;
        page.cursor(false);
        expect(page.document.activeElement).toBe(page.other);
    });

    test('hiding before any mouse event only switches the hover rules off', () => {
        const page = createPage();
        page.cursor(false);
        expect(page.hoverRules.setEnabled).toHaveBeenCalledWith(false);
        expect(page.document.activeElement).toBe(page.body);
    });

    test('repeated states are ignored', () => {
        const page = createPage();
        page.cursor(true);
        expect(page.hoverRules.setEnabled).not.toHaveBeenCalled();
        page.mouse('mousemove', page.image);
        page.cursor(false);
        page.document.activeElement = page.other;
        page.cursor(false);
        expect(page.hoverRules.setEnabled).toHaveBeenCalledTimes(1);
        expect(page.document.activeElement).toBe(page.other);
    });

    test('showing the pointer switches the hover back on and re-enters the element on the first move', () => {
        const page = createPage();
        page.mouse('mousemove', page.image);
        page.cursor(false);
        page.cursor(true);
        expect(page.state.visible).toBe(true);
        expect(page.html.getAttribute(MODE_ATTRIBUTE)).toBe('visible');
        expect(page.hoverRules.setEnabled).toHaveBeenLastCalledWith(true);
        page.image.dispatched.length = 0;
        page.mouse('mousemove', page.image);
        // pointermove from the polyfill, then the re-entering pointerover; only once.
        expect(types(page.image)).toEqual(['pointermove', 'pointerover']);
        expect(page.image.dispatched[1]).toMatchObject({ relatedTarget: null, pointerType: 'mouse' });
        page.mouse('mousemove', page.image);
        expect(types(page.image)).toEqual(['pointermove', 'pointerover', 'pointermove']);
    });

    test('a mouseover after showing already entered the element: no extra pointerover', () => {
        const page = createPage();
        page.mouse('mousemove', page.image);
        page.cursor(false);
        page.cursor(true);
        page.other.dispatched.length = 0;
        page.mouse('mouseover', page.other);
        page.mouse('mousemove', page.other);
        expect(types(page.other)).toEqual(['pointerover', 'pointermove']);
    });

    test('ignores events without a boolean visibility', () => {
        const page = createPage();
        page.mouse('mousemove', page.image);
        page.cursor(undefined);
        expect(page.state.visible).toBe(true);
        expect(page.hoverRules.setEnabled).not.toHaveBeenCalled();
    });

    test('closestFocusable skips disabled elements and stops at the root', () => {
        const { body, row, poster, image } = createPage();
        expect(closestFocusable(image, body)).toBe(poster);
        poster.disabled = true;
        expect(closestFocusable(image, body)).toBe(null);
        poster.disabled = false;
        poster.setAttribute('disabled', '');
        expect(closestFocusable(image, body)).toBe(null);
        expect(closestFocusable(row, body)).toBe(null);
    });
});

describe('Magic Remote: CSS :hover rules', () => {
    const styleRule = (selectorText) => ({ type: 1, selectorText });
    const createDocument = () => {
        const button = styleRule('.button:hover');
        const list = styleRule('.item:hover .label, .item.active .label');
        const pseudo = styleRule('.link:hover::after');
        const plain = styleRule('.button.disabled');
        const nested = styleRule('.poster:hover');
        const media = { type: 4, cssRules: [nested] };
        const crossOrigin = {};
        Object.defineProperty(crossOrigin, 'cssRules', {
            get() {
                throw new Error('SecurityError');
            },
        });
        const document = { styleSheets: [{ cssRules: [button, list, plain, media, pseudo] }, crossOrigin] };
        return { document, button, list, pseudo, plain, nested };
    };

    test('disabledSelector makes only the :hover branches unmatchable', () => {
        expect(disabledSelector('.a:hover')).toBe('.a:hover:not(*)');
        expect(disabledSelector('.a:hover .b, .a.active .b')).toBe('.a:hover:not(*) .b, .a.active .b');
        expect(disabledSelector('.a:hover::before')).toBe('.a:hover:not(*)::before');
        expect(disabledSelector('.a:hover .b:hover')).toBe('.a:hover:not(*) .b:hover:not(*)');
    });

    test('switches every :hover rule off and back, also inside @media, and skips other rules', () => {
        const { document, button, list, pseudo, plain, nested } = createDocument();
        const rules = createHoverRules(document);
        rules.setEnabled(false);
        expect(rules.count).toBe(4);
        expect(button.selectorText).toBe('.button:hover:not(*)');
        expect(list.selectorText).toBe('.item:hover:not(*) .label, .item.active .label');
        expect(pseudo.selectorText).toBe('.link:hover:not(*)::after');
        expect(nested.selectorText).toBe('.poster:hover:not(*)');
        expect(plain.selectorText).toBe('.button.disabled');
        rules.setEnabled(true);
        expect([button, list, pseudo, nested, plain].map((rule) => rule.selectorText))
            .toEqual(['.button:hover', '.item:hover .label, .item.active .label', '.link:hover::after', '.poster:hover', '.button.disabled']);
    });

    test('does nothing when the state does not change, and collects lazily', () => {
        const { document, button } = createDocument();
        const rules = createHoverRules(document);
        expect(rules.count).toBe(0);
        rules.setEnabled(true);
        expect(rules.count).toBe(0);
        rules.setEnabled(false);
        rules.setEnabled(false);
        expect(button.selectorText).toBe('.button:hover:not(*)');
    });

    test('a stylesheet added while the rules are off keeps the original selectors', () => {
        const { document, button } = createDocument();
        const rules = createHoverRules(document);
        rules.setEnabled(false);
        const late = styleRule('.late:hover');
        document.styleSheets = [...document.styleSheets, { cssRules: [late] }];
        rules.setEnabled(true);
        expect(button.selectorText).toBe('.button:hover');
        expect(late.selectorText).toBe('.late:hover');
        rules.setEnabled(false);
        expect(late.selectorText).toBe('.late:hover:not(*)');
        document.styleSheets = [document.styleSheets[0], { cssRules: [late] }];
        rules.setEnabled(true);
        expect(late.selectorText).toBe('.late:hover');
        expect(button.selectorText).toBe('.button:hover');
    });
});
