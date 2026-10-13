/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest */
// webos/lib/image-ready (F8.7): an image counts as ready once it loaded or failed; the URLs that loaded
// are remembered.

const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const { useImageReady, isLoaded } = require('../../lib/image-ready');

global.IS_REACT_ACT_ENVIRONMENT = true;

// An Image double: the test decides when it loads or fails.
const images = [];
class FakeImage {
    constructor() {
        images.push(this);
    }

    set src(url) {
        this.url = url;
    }
}

const render = (src, resolve = (url) => url) => {
    const seen = [];
    const Probe = ({ s }) => {
        seen.push(useImageReady(s, resolve, FakeImage));
        return null;
    };
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(React.createElement(Probe, { s: src })));
    return { seen, rerender: (s) => act(() => root.render(React.createElement(Probe, { s }))), unmount: () => act(() => root.unmount()) };
};

describe('useImageReady', () => {
    it('false while it loads, true once it loaded; then remembered', () => {
        images.length = 0;
        const r = render('https://a.example/1.png');
        expect(r.seen[r.seen.length - 1]).toBe(false);
        expect(images[0].url).toBe('https://a.example/1.png');
        act(() => images[0].onload());
        expect(r.seen[r.seen.length - 1]).toBe(true);
        expect(isLoaded('https://a.example/1.png')).toBe(true);
        const again = render('https://a.example/1.png');
        expect(again.seen).toEqual([true]);
    });

    it('a failure counts as ready (the upstream Image retries or shows the name) and is not remembered', () => {
        images.length = 0;
        const r = render('https://a.example/broken.png');
        act(() => images[0].onerror());
        expect(r.seen[r.seen.length - 1]).toBe(true);
        expect(isLoaded('https://a.example/broken.png')).toBe(false);
    });

    it('asks for the resolved URL; null (the proxy is starting) or no src is not ready', () => {
        images.length = 0;
        const r = render('https://images.metahub.space/x', (url) => `http://proxy/?u=${url}`);
        expect(images[0].url).toBe('http://proxy/?u=https://images.metahub.space/x');
        expect(render('https://b.example/x', () => null).seen.every((v) => v === false)).toBe(true);
        expect(render(null).seen.every((v) => v === false)).toBe(true);
        r.unmount();
    });

    it('another src is not ready because the previous one was', () => {
        images.length = 0;
        const r = render('https://a.example/2.png');
        act(() => images[0].onload());
        const before = r.seen.length;
        r.rerender('https://a.example/3.png');
        // Not even for the render in which the src changed.
        expect(r.seen.slice(before)).not.toContain(true);
        // A late answer of an unmounted or replaced image changes nothing.
        r.unmount();
        expect(() => images[1].onload && images[1].onload()).not.toThrow();
    });
});
