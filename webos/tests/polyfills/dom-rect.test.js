const fs = require('fs');
const path = require('path');
const { install } = require('../../polyfills/dom-rect');

describe('DOMRect polyfill', () => {
    let DOMRect, DOMRectReadOnly;

    beforeAll(() => {
        const target = {};
        install(target);
        ({ DOMRect, DOMRectReadOnly } = target);
    });

    test('installs DOMRect and DOMRectReadOnly where they are missing', () => {
        expect(typeof DOMRect).toBe('function');
        expect(typeof DOMRectReadOnly).toBe('function');
        expect(new DOMRect()).toBeInstanceOf(DOMRectReadOnly);
    });

    test('keeps native implementations', () => {
        const native = function DOMRect() {};
        const nativeReadOnly = function DOMRectReadOnly() {};
        const target = { DOMRect: native, DOMRectReadOnly: nativeReadOnly };
        install(target);
        expect(target.DOMRect).toBe(native);
        expect(target.DOMRectReadOnly).toBe(nativeReadOnly);
    });

    test('computes the edges like the native one, also for negative sizes', () => {
        const rect = new DOMRect(10, 20, 30, 40);
        expect([rect.x, rect.y, rect.width, rect.height]).toEqual([10, 20, 30, 40]);
        expect([rect.top, rect.right, rect.bottom, rect.left]).toEqual([20, 40, 60, 10]);
        const flipped = new DOMRect(10, 20, -30, -40);
        expect([flipped.top, flipped.right, flipped.bottom, flipped.left]).toEqual([-20, 10, 20, -20]);
        expect(new DOMRect()).toMatchObject({ x: 0, y: 0, width: 0, height: 0 });
    });

    test('the interface scale divides a rect the way getInterfaceRect does', () => {
        const scale = 1.25;
        const rect = new DOMRect(100 / scale, 50 / scale, 250 / scale, 125 / scale);
        expect(rect.toJSON()).toEqual({ x: 80, y: 40, width: 200, height: 100, top: 40, right: 280, bottom: 140, left: 80 });
    });

    test('DOMRect is writable and DOMRectReadOnly is not', () => {
        const rect = new DOMRect(1, 2, 3, 4);
        rect.x = 5;
        rect.width = 10;
        expect([rect.x, rect.right]).toEqual([5, 15]);
        const readOnly = new DOMRectReadOnly(1, 2, 3, 4);
        expect(() => {
            'use strict';
            readOnly.x = 5;
        }).toThrow(TypeError);
        expect(readOnly.x).toBe(1);
    });

    test('fromRect builds the right class', () => {
        expect(DOMRect.fromRect({ x: 1, y: 2, width: 3, height: 4 })).toBeInstanceOf(DOMRect);
        expect(DOMRectReadOnly.fromRect({ width: 3 }).toJSON()).toMatchObject({ x: 0, width: 3, right: 3 });
    });

    test('is installed by the page polyfills, so new DOMRect() in getInterfaceRect works', () => {
        const index = fs.readFileSync(path.join(__dirname, '..', '..', 'polyfills', 'index.js'), 'utf8');
        expect(index).toContain("from './dom-rect'");
        expect(index).toContain('installDOMRect(self);');
    });
});
