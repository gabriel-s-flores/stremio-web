// DOMRect and DOMRectReadOnly for Chromium 53 (webOS TV 4.x; native since 61), which only has
// ClientRect from getBoundingClientRect(). src/common/interfaceScale.ts builds a DOMRect for tooltips,
// popups, menus and dropdowns: without it, hovering a button with a tooltip threw a ReferenceError
// inside a React effect and the whole app unmounted.
// That ClientRect also lacks x and y (they came with DOMRect), which getInterfaceRect, the Slider
// and the Player seek bar read: every tooltip, popup and menu got NaN coordinates (off screen).
// ClientRect gets x and y getters (left and top). Page only.

const toNumber = (value) => (value === undefined ? 0 : Number(value));

class DOMRectReadOnly {
    constructor(x, y, width, height) {
        Object.defineProperties(this, {
            _x: { value: toNumber(x), writable: true },
            _y: { value: toNumber(y), writable: true },
            _width: { value: toNumber(width), writable: true },
            _height: { value: toNumber(height), writable: true },
        });
    }

    static fromRect(rect = {}) {
        return new this(rect.x, rect.y, rect.width, rect.height);
    }

    get x() {
        return this._x;
    }

    get y() {
        return this._y;
    }

    get width() {
        return this._width;
    }

    get height() {
        return this._height;
    }

    get top() {
        return Math.min(this._y, this._y + this._height);
    }

    get right() {
        return Math.max(this._x, this._x + this._width);
    }

    get bottom() {
        return Math.max(this._y, this._y + this._height);
    }

    get left() {
        return Math.min(this._x, this._x + this._width);
    }

    toJSON() {
        const { x, y, width, height, top, right, bottom, left } = this;
        return { x, y, width, height, top, right, bottom, left };
    }
}

class DOMRect extends DOMRectReadOnly {
    get x() {
        return this._x;
    }

    set x(value) {
        this._x = Number(value);
    }

    get y() {
        return this._y;
    }

    set y(value) {
        this._y = Number(value);
    }

    get width() {
        return this._width;
    }

    set width(value) {
        this._width = Number(value);
    }

    get height() {
        return this._height;
    }

    set height(value) {
        this._height = Number(value);
    }
}

const define = (global, name, value) => {
    Object.defineProperty(global, name, {
        value,
        writable: true,
        configurable: true,
        enumerable: false
    });
};

const defineGetter = (prototype, name, get) => {
    Object.defineProperty(prototype, name, { get, configurable: true, enumerable: true });
};

export const install = (global) => {
    const clientRect = global.ClientRect && global.ClientRect.prototype;
    if (clientRect && !('x' in clientRect)) {
        defineGetter(clientRect, 'x', function() {
            return this.left;
        });
        defineGetter(clientRect, 'y', function() {
            return this.top;
        });
    }
    if (typeof global.DOMRectReadOnly !== 'function') {
        define(global, 'DOMRectReadOnly', DOMRectReadOnly);
    }
    if (typeof global.DOMRect !== 'function') {
        define(global, 'DOMRect', DOMRect);
    }
};
