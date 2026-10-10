// DOM methods missing from Chromium 53 (webOS TV 4.x): ParentNode#append/prepend (native since 54)
// and Element#scroll/scrollTo/scrollBy (native since 61). Page only.
// Scrolling is always instant: `behavior: 'smooth'` is accepted and ignored.

const toNode = (document, nodes) => {
    const toNodeOrText = (node) => {
        return node instanceof Node ? node : document.createTextNode(String(node));
    };
    if (nodes.length === 1) {
        return toNodeOrText(nodes[0]);
    }
    const fragment = document.createDocumentFragment();
    Array.prototype.forEach.call(nodes, (node) => fragment.appendChild(toNodeOrText(node)));
    return fragment;
};

const ownerDocument = (parent) => {
    return parent.nodeType === Node.DOCUMENT_NODE ? parent : parent.ownerDocument;
};

function append() {
    if (arguments.length === 0) {
        return;
    }
    this.appendChild(toNode(ownerDocument(this), arguments));
}

function prepend() {
    if (arguments.length === 0) {
        return;
    }
    this.insertBefore(toNode(ownerDocument(this), arguments), this.firstChild);
}

const toFiniteNumber = (value) => {
    const number = Number(value);
    return isFinite(number) ? number : 0;
};

// scroll(x, y) or scroll({ left, top, behavior }): a missing coordinate keeps the current one.
const getScrollCoordinates = (args) => {
    if (args.length === 0) {
        return null;
    }
    if (args.length === 1) {
        const options = args[0];
        if (options === null || typeof options !== 'object') {
            throw new TypeError('Failed to execute \'scroll\' on \'Element\': parameter 1 (\'options\') is not an object.');
        }
        return { left: options.left, top: options.top };
    }
    return { left: args[0], top: args[1] };
};

function scrollTo() {
    const coordinates = getScrollCoordinates(arguments);
    if (!coordinates) {
        return;
    }
    if (coordinates.left !== undefined) {
        this.scrollLeft = toFiniteNumber(coordinates.left);
    }
    if (coordinates.top !== undefined) {
        this.scrollTop = toFiniteNumber(coordinates.top);
    }
}

function scrollBy() {
    const coordinates = getScrollCoordinates(arguments);
    if (!coordinates) {
        return;
    }
    if (coordinates.left !== undefined) {
        this.scrollLeft += toFiniteNumber(coordinates.left);
    }
    if (coordinates.top !== undefined) {
        this.scrollTop += toFiniteNumber(coordinates.top);
    }
}

const define = (prototype, name, value) => {
    if (!prototype || typeof prototype[name] === 'function') {
        return;
    }
    Object.defineProperty(prototype, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: false
    });
};

export const install = (global) => {
    // Element, Document and DocumentFragment are the ParentNode implementers.
    [global.Element, global.Document, global.DocumentFragment].forEach((Interface) => {
        define(Interface && Interface.prototype, 'append', append);
        define(Interface && Interface.prototype, 'prepend', prepend);
    });
    define(global.Element && global.Element.prototype, 'scroll', scrollTo);
    define(global.Element && global.Element.prototype, 'scrollTo', scrollTo);
    define(global.Element && global.Element.prototype, 'scrollBy', scrollBy);
};
