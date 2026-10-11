/**
 * @jest-environment jsdom
 */
// webos/external-links/links.js: what counts as an external link, the store, and the two ways the
// app has to open one (window.open and a click on a link).

const { classify, isLoopbackHost, absoluteUrl, createStore, install } = require('../../external-links/links');

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
        ['http://127.0.0.1:47443/proxy?t=SECRET&url=https%3A%2F%2Fexample.com%2Fsub.srt', 'blocked'],
        ['http://127.0.0.1:47444/anything', 'blocked'],
        ['http://127.1.2.3/', 'blocked'],
        ['http://localhost:8080/x', 'blocked'],
        ['http://app.localhost/x', 'blocked'],
        ['http://0.0.0.0:1/', 'blocked'],
        ['http://[::1]:47443/proxy?t=SECRET', 'blocked'],
        ['https://www.stremio.com/warning#http%3A%2F%2F127.0.0.1%3A47443%2Fproxy%3Ft%3DSECRET%26url%3Dx', 'blocked'],
        ['https://www.stremio.com/warning#http%3A%2F%2Flocalhost%2Fx', 'blocked'],
        ['https://www.stremio.com/warning#https%3A%2F%2Fexample.com%2Fconfigure', 'web'],
        ['https://www.stremio.com/warning#%E0%A4%A', 'web'],
        ['http://192.168.1.20:7000/configure', 'web'],
        ['https://127.example.com/x', 'web'],
        ['#/settings', 'local'],
        ['file:///media/developer/x.html', 'local'],
        ['blob:file:///1234', 'local'],
        ['data:text/plain,hi', 'local'],
        ['javascript:void(0)', 'local'],
    ])('%s is %s', (url, expected) => {
        expect(classify(url, win)).toBe(expected);
    });

    // The forms of the TV's own address (F3.4 debt, F7.3). The Chromium 53 of the TV writes the numeric
    // ones the canonical way in `new URL` (measured on the emulator: evidencias/d2/b1-chromium53-url.txt);
    // the ones it leaves (trailing dot, IPv6 with an IPv4 inside) are covered by the parsing in links.js.
    test.each([
        'http://127.0.0.1/', 'http://127.255.255.254/', 'http://user@127.0.0.1/', 'http://user:pw@127.0.0.1:47443/proxy?t=S',
        'http://127.0.0.1@127.0.0.1/', 'http://example.com@127.0.0.1/',
        'http://2130706433/', 'http://0x7f000001/', 'http://0X7F000001/', 'http://017700000001/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/',
        'http://127.1/', 'http://127.0.1/', 'http://127.0.0.0x1/', 'http://0/', 'http://0x0/', 'http://00/', 'http://0.0.0.0/',
        'http://[::1]/', 'http://[0:0:0:0:0:0:0:1]/', 'http://[0000:0000:0000:0000:0000:0000:0000:0001]/', 'http://[::0001]/',
        'http://[::]/', 'http://[0::0]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::FFFF:7F00:1]/',
        'http://[::ffff:0.0.0.0]/', 'http://[::127.0.0.1]/', 'http://[::7f00:1]/', 'http://[0:0:0:0:0:ffff:7f00:1]/',
        'http://localhost/', 'http://LOCALHOST:8080/', 'http://localhost./', 'http://a.b.localhost/', 'http://a.localhost./',
        'http://127.0.0.1./', 'http://127.0.0.1:80#@example.com',
    ])('the TV itself, %s, is blocked', (url) => {
        expect(classify(url, win)).toBe('blocked');
        expect(classify(`https://www.stremio.com/warning#${encodeURIComponent(url)}`, win)).toBe('blocked');
    });

    test.each([
        'http://example.com@evil.example.com/', 'http://127.0.0.1@example.com/', 'http://localhost@example.com/',
        'http://127.0.0.1.example.com/', 'http://127.example.com/', 'http://0x7f.example.com/', 'http://2130706433.example.com/',
        'http://notlocalhost/', 'http://localhost.example.com/', 'http://mylocalhost.com/', 'http://example.localhost.example.com/',
        'http://128.0.0.1/', 'http://126.255.255.255/', 'http://1.1.1.1/', 'http://8.8.8.8/', 'http://10.0.0.5/',
        'http://192.168.1.20:7000/configure', 'http://169.254.1.1/', 'http://1/', 'http://16777217/',
        'http://[::2]/', 'http://[2001:db8::1]/', 'http://[::ffff:8.8.8.8]/', 'http://[::ffff:808:808]/', 'http://[::ffff:128.0.0.1]/',
        'http://[2606:4700:4700::1111]/', 'https://www.stremio.com/', 'https://stremio.zendesk.com/hc/en-us',
    ])('a public or LAN host, %s, is not blocked', (url) => {
        expect(classify(url, win)).toBe('web');
    });

    test('a warning page inside a warning page is looked through too (up to two wrappers)', () => {
        const wrap = (url) => `https://www.stremio.com/warning#${encodeURIComponent(url)}`;
        const proxy = 'http://127.0.0.1:47443/proxy?t=SECRET';
        expect(classify(wrap(wrap(proxy)), win)).toBe('blocked');
        expect(classify(wrap(wrap(wrap(proxy))), win)).toBe('web');
        expect(classify(wrap(wrap('https://example.com/configure')), win)).toBe('web');
    });

    test('the host is read here too, not only as `new URL` writes it', () => {
        // Hostnames as a platform that does not canonicalize would hand them over.
        ['2130706433', '0x7f000001', '017700000001', '127.1', '0177.0.1', '0', '0x0', '127.0.0.1.', 'localhost.', 'LocalHost',
            '[0:0:0:0:0:0:0:1]', '[::ffff:127.0.0.1]', '[::FFFF:7F00:0001]', '[::127.0.0.1]', '[0:0:0:0:0:0:0:0]', '[0::0:0]',
        ].forEach((host) => expect([host, isLoopbackHost(host)]).toEqual([host, true]));
        ['example.com', '127.example.com', '0x7f.example.com', '1.2.3.4', '256.0.0.1', '4294967296', '1.2.3.4.5', '128.1', '0x80000001',
            'localhost.example.com', '', '[::2]', '[::ffff:1.2.3.4]', '[1:2:3:4:5:6:7:8]', '[1:2:3:4:5:6:7]', '[:::1]', '[1::2::3]', '[::1.2.3]', '[zz::1]', '[::12345]',
        ].forEach((host) => expect([host, isLoopbackHost(host)]).toEqual([host, false]));
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

        test('links to the TV itself (the tlsproxy URL with its token) are disabled, never shown, stored or logged', () => {
            const secret = 'http://127.0.0.1:47443/proxy?t=SECRET-TOKEN&url=https%3A%2F%2Fexample.com%2Fsub.srt';
            const logs = ['log', 'info', 'warn', 'error', 'debug'].map((method) => jest.spyOn(console, method).mockImplementation(() => {}));
            const states = [];
            store.subscribe((state) => states.push(state));
            expect(window.open(secret, '_blank')).toBeNull();
            // Through Platform.openExternal: the stremio.com warning page around it.
            expect(window.open(`https://www.stremio.com/warning#${encodeURIComponent(secret)}`, '_blank')).toBeNull();
            expect(originalOpen).not.toHaveBeenCalled();
            expect(store.getState().url).toBeNull();
            expect(states).toEqual([]);
            logs.forEach((spy) => {
                expect(spy).not.toHaveBeenCalled();
                spy.mockRestore();
            });
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

        test('a download link inside a container that stops the clicks (the context menu) still opens the dialog, once', () => {
            const menu = document.createElement('div');
            menu.addEventListener('click', (event) => event.stopPropagation());
            document.body.appendChild(menu);
            const opened = [];
            store.subscribe((state) => opened.push(state.url));
            const anchor = link({ href: 'https://example.com/sub.srt', target: '_blank', download: 'sub' }, menu);
            expect(click(anchor)).toBe(false);
            expect(opened).toEqual(['https://example.com/sub.srt']);
            // a loopback download (the proxy URL) is disabled, and not shown
            store.close();
            const proxy = link({ href: 'http://127.0.0.1:47443/proxy?t=SECRET&url=x', target: '_blank', download: 'sub' }, menu);
            expect(click(proxy)).toBe(false);
            expect(store.getState().url).toBeNull();
        });

        test('a link without download in such a container is not touched (its own handler decides)', () => {
            const menu = document.createElement('div');
            menu.addEventListener('click', (event) => event.stopPropagation());
            document.body.appendChild(menu);
            expect(click(link({ href: 'https://example.com/page', target: '_blank' }, menu))).toBe(true);
            expect(store.getState().url).toBeNull();
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

        test('a click on a link to the TV itself is cancelled, with no dialog and no trace of the URL', () => {
            const logs = ['log', 'info', 'warn', 'error', 'debug'].map((method) => jest.spyOn(console, method).mockImplementation(() => {}));
            const anchor = link({ href: 'http://127.0.0.1:47443/proxy?t=SECRET-TOKEN&url=x', target: '_blank' });
            expect(click(anchor)).toBe(false);
            const behindWarning = link({ href: `https://www.stremio.com/warning#${encodeURIComponent('http://127.0.0.1:47443/proxy?t=SECRET-TOKEN')}`, target: '_blank' });
            expect(click(behindWarning)).toBe(false);
            expect(store.getState().url).toBeNull();
            expect(document.body.textContent).not.toContain('SECRET-TOKEN');
            logs.forEach((spy) => {
                expect(spy).not.toHaveBeenCalled();
                spy.mockRestore();
            });
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
