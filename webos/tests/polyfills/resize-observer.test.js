const { ResizeObserver } = require('@juggle/resize-observer');
const { install } = require('../../polyfills/resize-observer');

describe('ResizeObserver polyfill', () => {
    test('installs the observer where it is missing', () => {
        const target = {};
        install(target);
        expect(target.ResizeObserver).toBe(ResizeObserver);
        expect(typeof target.ResizeObserver.prototype.observe).toBe('function');
        expect(typeof target.ResizeObserver.prototype.unobserve).toBe('function');
        expect(typeof target.ResizeObserver.prototype.disconnect).toBe('function');
    });

    test('keeps a native implementation', () => {
        const native = function ResizeObserver() {};
        const target = { ResizeObserver: native };
        install(target);
        expect(target.ResizeObserver).toBe(native);
    });
});
