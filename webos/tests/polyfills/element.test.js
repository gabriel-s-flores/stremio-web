const { install } = require('../../polyfills/element');

// Minimal DOM: just what the polyfill touches. Real behaviour is checked in the emulator.
class FakeNode {
    constructor(ownerDocument) {
        this.ownerDocument = ownerDocument;
        this.childNodes = [];
    }
    get firstChild() {
        return this.childNodes[0] || null;
    }
    appendChild(node) {
        if (node instanceof FakeFragment) {
            this.childNodes.push(...node.childNodes.splice(0));
        } else {
            this.childNodes.push(node);
        }
        return node;
    }
    insertBefore(node, reference) {
        const added = node instanceof FakeFragment ? node.childNodes.splice(0) : [node];
        const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
        this.childNodes.splice(index, 0, ...added);
        return node;
    }
}
FakeNode.DOCUMENT_NODE = 9;

class FakeElement extends FakeNode {
    constructor(ownerDocument) {
        super(ownerDocument);
        this.nodeType = 1;
        this.scrollLeft = 0;
        this.scrollTop = 0;
    }
}
class FakeFragment extends FakeNode {}
class FakeText extends FakeNode {
    constructor(ownerDocument, text) {
        super(ownerDocument);
        this.nodeType = 3;
        this.text = text;
    }
}
class FakeDocument extends FakeNode {
    constructor() {
        super(null);
        this.nodeType = FakeNode.DOCUMENT_NODE;
    }
    createTextNode(text) {
        return new FakeText(this, text);
    }
    createDocumentFragment() {
        return new FakeFragment(this);
    }
}

const describeChildren = (parent) => parent.childNodes.map((node) => node instanceof FakeText ? node.text : node.name);

describe('Element polyfill', () => {
    let document;
    let element;

    beforeAll(() => {
        global.Node = FakeNode;
        const target = { Element: FakeElement, Document: FakeDocument, DocumentFragment: FakeFragment };
        install(target);
    });

    afterAll(() => {
        delete global.Node;
    });

    beforeEach(() => {
        document = new FakeDocument();
        element = new FakeElement(document);
    });

    const child = (name) => Object.assign(new FakeElement(document), { name });

    test('installs only what is missing and does not touch natives', () => {
        const native = () => {};
        class NativeElement extends FakeElement {}
        NativeElement.prototype.append = native;
        NativeElement.prototype.scrollTo = native;
        install({ Element: NativeElement });
        expect(NativeElement.prototype.append).toBe(native);
        expect(NativeElement.prototype.scrollTo).toBe(native);
        expect(typeof NativeElement.prototype.prepend).toBe('function');
        expect(typeof NativeElement.prototype.scrollBy).toBe('function');
        expect(typeof NativeElement.prototype.scroll).toBe('function');
    });

    test('works when interfaces are missing', () => {
        expect(() => install({})).not.toThrow();
    });

    describe('append and prepend', () => {
        test('append adds nodes and strings, in order, after the existing children', () => {
            element.appendChild(child('a'));
            element.append(child('b'), 'text', 7);
            expect(describeChildren(element)).toEqual(['a', 'b', 'text', '7']);
        });

        test('prepend adds nodes and strings, in order, before the existing children', () => {
            element.appendChild(child('a'));
            element.prepend(child('b'), 'text');
            expect(describeChildren(element)).toEqual(['b', 'text', 'a']);
        });

        test('a single argument is added without a fragment', () => {
            const node = child('only');
            element.append(node);
            expect(element.childNodes[0]).toBe(node);
        });

        test('no arguments changes nothing', () => {
            element.append();
            element.prepend();
            expect(element.childNodes).toEqual([]);
        });

        test('document and fragment are parents too', () => {
            document.append('x', child('y'));
            expect(describeChildren(document)).toEqual(['x', 'y']);
            const fragment = document.createDocumentFragment();
            fragment.prepend('z');
            expect(describeChildren(fragment)).toEqual(['z']);
        });
    });

    describe('scrolling', () => {
        test('scrollTo with an options object', () => {
            element.scrollTo({ top: 120, left: 30, behavior: 'smooth' });
            expect([element.scrollLeft, element.scrollTop]).toEqual([30, 120]);
        });

        test('scrollTo with x and y', () => {
            element.scrollTo(5, 6);
            expect([element.scrollLeft, element.scrollTop]).toEqual([5, 6]);
        });

        test('a missing coordinate keeps the current position', () => {
            element.scrollLeft = 40;
            element.scrollTop = 50;
            element.scrollTo({ top: 0 });
            expect([element.scrollLeft, element.scrollTop]).toEqual([40, 0]);
            element.scrollTo({ left: 1 });
            expect([element.scrollLeft, element.scrollTop]).toEqual([1, 0]);
        });

        test('non finite values count as 0', () => {
            element.scrollTop = 10;
            element.scrollTo({ top: NaN, left: Infinity });
            expect([element.scrollLeft, element.scrollTop]).toEqual([0, 0]);
        });

        test('scroll is the same as scrollTo', () => {
            element.scroll({ top: 9 });
            expect(element.scrollTop).toBe(9);
        });

        test('scrollBy adds to the current position', () => {
            element.scrollLeft = 10;
            element.scrollTop = 20;
            element.scrollBy({ top: 5 });
            element.scrollBy(1, -3);
            expect([element.scrollLeft, element.scrollTop]).toEqual([11, 22]);
        });

        test('no arguments changes nothing and a non-object is a TypeError', () => {
            element.scrollTop = 3;
            element.scrollTo();
            element.scrollBy();
            expect(element.scrollTop).toBe(3);
            expect(() => element.scrollTo(10)).toThrow(TypeError);
            expect(() => element.scrollBy(null)).toThrow(TypeError);
        });
    });
});
