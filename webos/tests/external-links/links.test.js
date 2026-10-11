/**
 * @jest-environment jsdom
 */
// webos/external-links/links.js: what counts as an external link, the store, and the two ways the
// app has to open one (window.open and a click on a link).

const { classify, absoluteUrl, createStore, install } = require('../../external-links/links');

describe('classify', () => {
    const win = { location: { href: 'file:///media/developer/apps/usr/palm/applications/stremio/index.html#/', origin: 'file://' } };

    test.each([
        ['https://www.stremio.com/tos', 'web'],
        ['http://example.com/configure', 'web'],
        ['https://stremio.zendesk.com/hc/en-us', 'web'],
        ['magnet:?xt=urn:btih:abc', 'blocked'],
        ['stremio:///detail/movie/tt1', 'blocked'],
        ['mailto:someone@example.com', 'blocked'],
        ['intent://x#Intent;end', 'blocked'],
        ['#/settings', 'local'],
        ['file:///media/developer/x.html', 'local'],
        ['blob:file:///1234', 'local'],
        ['data:text/plain,hi', 'local'],
        ['javascript:void(0)', 'local'],
    ])('%s is %s', (url, expected) => {
        expect(classify(url, win)).toBe(expected);
    });

    test('a web URL of the page\'s own origin is the app\'s (the app served from the web)', () => {
        const served = { location: { href: 'https://app.example/index.html#/', origin: 'https://app.example' } };
        expect(classify('https://app.example/other', served)).toBe('local');
        expect(classify('https://www.stremio.com/', served)).toBe('web');
    });

    test('text that is not a URL is left alone', () => {
        expect(classify('http://', win)).toBe('local');
    });

    test('absoluteUrl resolves against the page', () => {
        expect(absoluteUrl('https://www.stremio.com/tos', win)).toBe('https://www.stremio.com/tos');
        expect(absoluteUrl('//example.com/x', { location: { href: 'https://app.example/' } })).toBe('https://example.com/x');
    });
});

describe('createStore', () => {
    test('open and close notify the subscribers; closing twice is silent', () => {
        const store = createStore();
        const listener = jest.fn();
        const unsubscribe = store.subscribe(listener);
        expect(store.getState()).toEqual({ url: null });
        store.open('https://a.example/');
        expect(store.getState()).toEqual({ url: 'https://a.example/' });
        store.open('https://b.example/');
        store.close();
        store.close();
        expect(listener.mock.calls.map(([state]) => state.url)).toEqual(['https://a.example/', 'https://b.example/', null]);
        unsubscribe();
        store.open('https://c.example/');
        expect(listener).toHaveBeenCalledTimes(3);
    });
});

describe('install', () => {
    let store;
    let uninstall;
    let originalOpen;

    beforeEach(() => {
        store = createStore();
        originalOpen = jest.fn(() => 'native window');
        window.open = originalOpen;
        uninstall = install(window, store);
    });

    afterEach(() => {
        uninstall();
        document.body.innerHTML = '';
    });

    const link = (attributes, parent = document.body) => {
        const anchor = document.createElement('a');
        Object.keys(attributes).forEach((name) => anchor.setAttribute(name, attributes[name]));
        parent.appendChild(anchor);
        return anchor;
    };

    // Dispatches a click and says whether the browser would have followed the link.
    const click = (element) => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return !event.defaultPrevented;
    };

    describe('window.open', () => {
        test('shows a web URL as a QR code and opens no window', () => {
            expect(window.open('https://www.stremio.com/warning#x', '_blank')).toBeNull();
            expect(store.getState().url).toBe('https://www.stremio.com/warning#x');
            expect(originalOpen).not.toHaveBeenCalled();
        });

        test('disables the other external schemes', () => {
            expect(window.open('magnet:?xt=urn:btih:abc')).toBeNull();
            expect(window.open('stremio:///detail/movie/tt1', '_blank')).toBeNull();
            expect(store.getState().url).toBeNull();
            expect(originalOpen).not.toHaveBeenCalled();
        });

        test('leaves the rest to the browser (no URL, local URLs)', () => {
            expect(window.open()).toBe('native window');
            expect(window.open('')).toBe('native window');
            expect(window.open('#/settings')).toBe('native window');
            expect(originalOpen).toHaveBeenCalledTimes(3);
            expect(store.getState().url).toBeNull();
        });

        test('uninstall puts the original back', () => {
            uninstall();
            expect(window.open).toBe(originalOpen);
            uninstall = install(window, store);
        });
    });

    describe('clicks on links', () => {
        test('a target=_blank web link shows its QR code and is not followed', () => {
            const anchor = link({ href: 'https://www.stremio.com/tos', target: '_blank' });
            expect(click(anchor)).toBe(false);
            expect(store.getState().url).toBe('https://www.stremio.com/tos');
        });

        test('a web link without a target is caught too: following it would take the app away', () => {
            expect(click(link({ href: 'https://example.com/page' }))).toBe(false);
            expect(store.getState().url).toBe('https://example.com/page');
        });

        test('works from a child of the link (the icon and the label of a Button)', () => {
            const anchor = link({ href: 'https://stremio.zendesk.com/', target: '_blank' });
            const label = document.createElement('span');
            anchor.appendChild(label);
            expect(click(label)).toBe(false);
            expect(store.getState().url).toBe('https://stremio.zendesk.com/');
        });

        test('a download link to the web is a QR code too', () => {
            expect(click(link({ href: 'https://example.com/export.json', download: 'export.json' }))).toBe(false);
            expect(store.getState().url).toBe('https://example.com/export.json');
        });

        test('other external schemes are disabled, with no dialog', () => {
            expect(click(link({ href: 'magnet:?xt=urn:btih:abc' }))).toBe(false);
            expect(click(link({ href: 'stremio:///detail/movie/tt1' }))).toBe(false);
            expect(store.getState().url).toBeNull();
        });

        test('links inside the app are left alone', () => {
            expect(click(link({ href: '#/settings' }))).toBe(true);
            expect(click(link({ href: 'file:///media/developer/x.html' }))).toBe(true);
            expect(store.getState().url).toBeNull();
        });

        test('elements that are not links, and anchors without href, are left alone', () => {
            const button = document.createElement('button');
            document.body.appendChild(button);
            expect(click(button)).toBe(true);
            expect(click(link({ name: 'anchor' }))).toBe(true);
            expect(store.getState().url).toBeNull();
        });

        test('a click an app handler already dealt with (preventDefault) is not ours', () => {
            const anchor = link({ href: 'https://example.com/handled', target: '_blank' });
            anchor.addEventListener('click', (event) => event.preventDefault());
            click(anchor);
            expect(store.getState().url).toBeNull();
        });

        test('uninstall stops catching clicks', () => {
            uninstall();
            const anchor = link({ href: 'https://example.com/x' });
            anchor.addEventListener('click', (event) => event.preventDefault());
            click(anchor);
            expect(store.getState().url).toBeNull();
            uninstall = install(window, store);
        });
    });
});
