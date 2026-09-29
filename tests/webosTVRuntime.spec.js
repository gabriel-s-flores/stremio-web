const { React, loader, mount, tick } = require('./helpers/tvDom');
let view;
beforeEach(() => { jest.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(async () => { if (view) view.unmount(); view = null; await tick(); jest.useRealTimers(); delete global.IntersectionObserver; });

test('keyboard visibility and viewport resize reveal the current input without changing its value', async () => {
    const install = loader()('src/common/TV/keyboard.js');
    document.body.innerHTML = '<input id="email" value="unchanged"><textarea id="url"></textarea><button>Other</button>';
    const input = document.querySelector('input'); const textarea = document.querySelector('textarea');
    input.scrollIntoView = jest.fn(); textarea.scrollIntoView = jest.fn(); input.focus();
    const cleanup = install(document, window);
    document.dispatchEvent(new window.CustomEvent('keyboardStateChange', { detail: { visibility: true } }));
    await tick();
    expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'start', inline: 'nearest', behavior: 'auto' });
    expect(input.value).toBe('unchanged');
    textarea.focus(); window.dispatchEvent(new window.Event('resize')); await tick();
    expect(textarea.scrollIntoView).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new window.CustomEvent('keyboardStateChange', { detail: { visibility: 'false' } }));
    input.focus(); await tick();
    expect(input.scrollIntoView).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new window.CustomEvent('keyboardStateChange', { detail: { visibility: false } }));
    textarea.focus(); await tick(); expect(textarea.scrollIntoView).toHaveBeenCalledTimes(1);
    cleanup(); input.focus(); window.dispatchEvent(new window.Event('resize')); await tick();
    expect(input.scrollIntoView).toHaveBeenCalledTimes(2);
});

test.each([{}, { getGamepads: () => { throw new Error('SecurityError'); } }, { getGamepads: () => null }, { getGamepads: () => [null, undefined] }])('gamepad unavailable returns an empty list safely: %p', host => {
    const read = loader()('src/services/GamepadContext/readGamepads.ts').default;
    expect(read(host)).toEqual([]);
});

test('gamepad reader preserves its receiver and ignores disconnected slots', () => {
    const read = loader()('src/services/GamepadContext/readGamepads.ts').default;
    const pad = { connected: true };
    const host = { getGamepads() { expect(this).toBe(host); return [null, pad, { connected: false }]; } };
    expect(read(host)).toEqual([pad]);
});

test('shared IntersectionObserver loads intersecting posters once and releases all registrations', () => {
    let callback; const observer = { observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() };
    global.IntersectionObserver = jest.fn((cb, options) => { callback = cb; expect(options.rootMargin).toBe('400px'); return observer; });
    const observe = loader()('src/common/TV/lazyImages.js');
    const a = {}; const b = {}; const first = jest.fn(); const second = jest.fn();
    const cleanupA = observe(a, first); const cleanupB = observe(b, second);
    expect(global.IntersectionObserver).toHaveBeenCalledTimes(1);
    callback([{ target: a, isIntersecting: false, intersectionRatio: 0 }]); expect(first).not.toHaveBeenCalled();
    callback([{ target: a, isIntersecting: true }]); expect(first).toHaveBeenCalledTimes(1);
    callback([{ target: a, isIntersecting: true }]); expect(first).toHaveBeenCalledTimes(1);
    cleanupA(); expect(observer.disconnect).not.toHaveBeenCalled();
    cleanupB(); expect(observer.disconnect).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled();
});

test('Image defers TV network src until intersection; missing API and desktop load immediately', async () => {
    let callback;
    global.IntersectionObserver = jest.fn(cb => { callback = cb; return { observe() {}, unobserve() {}, disconnect() {} }; });
    const Image = loader()('src/components/Image/Image.tsx').default;
    view = mount(React.createElement(Image, { src: '/poster.jpg', alt: 'Poster' }));
    expect(view.container.querySelector('img').hasAttribute('src')).toBe(false);
    React.act(() => callback([{ target: view.container.querySelector('img'), intersectionRatio: 1 }]));
    expect(view.container.querySelector('img').getAttribute('src')).toBe('/poster.jpg');
    view.unmount(); view = null; delete global.IntersectionObserver;
    const Fallback = loader()('src/components/Image/Image.tsx').default;
    view = mount(React.createElement(Fallback, { src: '/fallback.jpg' }));
    expect(view.container.querySelector('img').getAttribute('src')).toBe('/fallback.jpg');
    view.unmount(); view = null;
    const Desktop = loader(false)('src/components/Image/Image.tsx').default;
    view = mount(React.createElement(Desktop, { src: '/desktop.jpg' }));
    expect(view.container.querySelector('img').getAttribute('src')).toBe('/desktop.jpg');
});

test('pagination rearms when appended content grows while focus remains near the bottom', () => {
    const useScroll = loader()('src/common/useOnScrollToBottom.js');
    const load = jest.fn(); let onScroll;
    function List() { onScroll = useScroll(load, 400); return null; }
    view = mount(React.createElement(List));
    const container = { scrollTop: 450, clientHeight: 500, scrollHeight: 1000 };
    onScroll({ target: container }); onScroll({ target: container }); expect(load).toHaveBeenCalledTimes(1);
    container.scrollHeight = 1200;
    onScroll({ target: container }); onScroll({ target: container }); expect(load).toHaveBeenCalledTimes(2);
    container.scrollTop = 0; onScroll({ target: container });
    container.scrollTop = 600; onScroll({ target: container }); expect(load).toHaveBeenCalledTimes(3);
});

test('desktop pagination still fires only on threshold entry', () => {
    const useScroll = loader(false)('src/common/useOnScrollToBottom.js'); const load = jest.fn(); let onScroll;
    function List() { onScroll = useScroll(load, 400); return null; }
    view = mount(React.createElement(List));
    const target = { scrollTop: 450, clientHeight: 500, scrollHeight: 1000 };
    onScroll({ target }); target.scrollHeight = 1200; onScroll({ target });
    expect(load).toHaveBeenCalledTimes(1);
});

test('GamepadProvider survives API exceptions during startup, polling and disconnect', async () => {
    const original = navigator.getGamepads;
    const hasFocus = document.hasFocus;
    const read = jest.fn(() => { throw new Error('Unsupported gamepad API'); });
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: read });
    document.hasFocus = () => true;
    const toast = { show: jest.fn() };
    const t = key => key;
    try {
        const Provider = loader(true, {
            'stremio/common/Toast/useToast': () => toast,
            'react-i18next': { useTranslation: () => ({ t }) }
        })('src/services/GamepadContext/GamepadProvider.tsx').default;
        view = mount(React.createElement(Provider, { enabled: true }, React.createElement('button', {}, 'Remote works')));
        await tick(40);
        React.act(() => window.dispatchEvent(new window.Event('gamepaddisconnected')));
        expect(read.mock.calls.length).toBeGreaterThanOrEqual(3);
        expect(view.container.textContent).toBe('Remote works');
        view.unmount(); view = null;
        const reads = read.mock.calls.length; await tick(100);
        expect(read).toHaveBeenCalledTimes(reads);
    } finally {
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: original });
        document.hasFocus = hasFocus;
    }
});
