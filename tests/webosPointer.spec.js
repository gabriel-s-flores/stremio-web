const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');

const loadTypeScriptModule = (file) => {
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        process: { env: {} },
    });
    return module.exports;
};

const makeDocument = () => {
    const listeners = new Map();
    const document = {
        documentElement: { clientWidth: 1920, clientHeight: 1080 },
        defaultView: {
            getComputedStyle: element => ({
                overflowX: element.overflowX,
                overflowY: element.overflowY,
            }),
        },
        addEventListener: jest.fn((type, listener, options) => {
            listeners.set(type, { listener, options });
        }),
        removeEventListener: jest.fn((type, listener, options) => {
            const current = listeners.get(type);
            if (current?.listener === listener) listeners.delete(type);
            document.removed.push([type, listener, options]);
        }),
        removed: [],
        listeners,
    };
    document.documentElement.ownerDocument = document;
    document.documentElement.parentElement = null;
    return document;
};

const makeElement = (document, options = {}) => {
    let scrollLeft = options.scrollLeft || 0;
    const maxScrollLeft = Math.max(0, (options.scrollWidth || 0) - (options.clientWidth || 0));
    const element = {
        nodeType: 1,
        ownerDocument: document,
        parentElement: options.parentElement || document.documentElement,
        overflowX: options.overflowX || 'visible',
        overflowY: options.overflowY || 'visible',
        scrollWidth: options.scrollWidth || 0,
        clientWidth: options.clientWidth || 0,
        scrollHeight: options.scrollHeight || 0,
        clientHeight: options.clientHeight || 0,
    };
    Object.defineProperty(element, 'scrollLeft', {
        get: () => scrollLeft,
        set: value => { scrollLeft = Math.min(maxScrollLeft, Math.max(0, value)); },
    });
    return element;
};

const makeWheelEvent = (target, overrides = {}) => ({
    target,
    cancelable: true,
    ctrlKey: false,
    defaultPrevented: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 40,
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
});

test('Magic Remote wheel advances the nearest horizontal list and consumes only movement', () => {
    const { installTVWheelScrolling } = loadTypeScriptModule('src/common/Platform/webos/pointer.ts');
    const document = makeDocument();
    const row = makeElement(document, { overflowX: 'auto', scrollWidth: 400, clientWidth: 200, scrollLeft: 20 });
    const child = makeElement(document, { parentElement: row });
    const dispose = installTVWheelScrolling(document);
    const wheel = document.listeners.get('wheel').listener;
    const event = makeWheelEvent(child);

    wheel(event);

    expect(row.scrollLeft).toBe(60);
    expect(event.tvWheelScrollTarget).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    dispose();
    expect(document.listeners.has('wheel')).toBe(false);
    expect(document.removed).toHaveLength(1);
    expect(document.removed[0][2]).toBe(true);
});

test('vertical lists keep native wheel behavior and horizontal edges are not consumed', () => {
    const { installTVWheelScrolling } = loadTypeScriptModule('src/common/Platform/webos/pointer.ts');
    const document = makeDocument();
    const vertical = makeElement(document, {
        overflowY: 'auto', scrollHeight: 600, clientHeight: 200,
    });
    const row = makeElement(document, {
        overflowX: 'auto', scrollWidth: 400, clientWidth: 200, scrollLeft: 200,
    });
    const onWheel = installTVWheelScrolling(document);
    const wheel = document.listeners.get('wheel').listener;
    const verticalEvent = makeWheelEvent(vertical);
    const edgeEvent = makeWheelEvent(row);

    wheel(verticalEvent);
    wheel(edgeEvent);

    expect(verticalEvent.defaultPrevented).toBe(false);
    expect(verticalEvent.tvWheelScrollTarget).toBeUndefined();
    expect(edgeEvent.tvWheelScrollTarget).toBe(true);
    expect(edgeEvent.defaultPrevented).toBe(false);
    onWheel();
});

test.each([
    ['zoom', { ctrlKey: true }],
    ['already consumed', { defaultPrevented: true }],
    ['non-cancelable', { cancelable: false }],
])('wheel %s does not change a list', (_name, overrides) => {
    const { installTVWheelScrolling } = loadTypeScriptModule('src/common/Platform/webos/pointer.ts');
    const document = makeDocument();
    const row = makeElement(document, { overflowX: 'auto', scrollWidth: 400, clientWidth: 200 });
    installTVWheelScrolling(document);
    const event = makeWheelEvent(row, overrides);

    document.listeners.get('wheel').listener(event);

    expect(row.scrollLeft).toBe(0);
    expect(event.defaultPrevented).toBe(overrides.defaultPrevented || false);
});

test('cursor visibility accepts boolean transitions only, deduplicates them, and cleans up', () => {
    const { createWebOSAdapter } = loadTypeScriptModule('src/common/Platform/webos/adapter.ts');
    const listeners = new Map();
    const target = {
        hidden: false,
        addEventListener: jest.fn((name, listener, capture) => listeners.set(name, { listener, capture })),
        removeEventListener: jest.fn((name, listener, capture) => {
            if (listeners.get(name)?.listener === listener) listeners.delete(name);
            expect(capture).toBe(true);
        }),
    };
    const adapter = createWebOSAdapter(true, () => ({}), target);
    const changed = jest.fn();
    const unsubscribe = adapter.subscribeCursorVisibility(changed);
    const cursorEvent = listeners.get('cursorStateChange').listener;

    expect(adapter.getCursorVisible()).toBe(null);
    cursorEvent({ detail: { visibility: 'false' } });
    cursorEvent({ detail: {} });
    expect(adapter.getCursorVisible()).toBe(null);
    expect(changed).not.toHaveBeenCalled();

    cursorEvent({ detail: { visibility: false } });
    cursorEvent({ detail: { visibility: false } });
    expect(adapter.getCursorVisible()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    cursorEvent({ detail: { visibility: true } });
    expect(adapter.getCursorVisible()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);

    unsubscribe();
    adapter.dispose();
    expect(target.removeEventListener).toHaveBeenCalledWith('cursorStateChange', cursorEvent, true);
    expect(listeners.has('cursorStateChange')).toBe(false);
});
