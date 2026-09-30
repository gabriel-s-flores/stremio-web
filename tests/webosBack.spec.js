const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');

const loadTypeScriptModule = (file, dependencies = {}, globals = {}) => {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.React,
            esModuleInterop: true,
        },
    }).outputText;
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        require: (id) => Object.prototype.hasOwnProperty.call(dependencies, id) ? dependencies[id] : require(id),
        ...globals,
    });
    return module.exports;
};

const keyboard = loadTypeScriptModule('src/common/Shortcuts/keyboard.ts');
const backHandlers = loadTypeScriptModule('src/common/Shortcuts/backHandlers.ts');
const dispatchWebOSShortcut = loadTypeScriptModule('src/common/Shortcuts/dispatchWebOSShortcut.ts');
const { getBackNavigationAction } = require('../src/common/Shortcuts/backNavigation');

const makeEvent = (properties = {}) => ({
    key: '',
    code: 'Unidentified',
    keyCode: 0,
    which: 0,
    repeat: false,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    stopImmediatePropagation: jest.fn(),
    ...properties,
});

test.each([
    ['webOS key code', { keyCode: 461, which: 461 }],
    ['webOS which fallback', { which: 461 }],
    ['Back key alias', { key: 'Back' }],
    ['GoBack key alias', { key: 'GoBack' }],
    ['XF86Back key alias', { key: 'XF86Back' }],
    ['lowercase Back alias', { key: 'back' }],
])('normalizes the %s as Back', (_name, properties) => {
    expect(keyboard.isBackKeyboardEvent(makeEvent(properties))).toBe(true);
});

test('keeps Escape and Backspace distinct from Back', () => {
    expect(keyboard.isBackKeyboardEvent(makeEvent({ key: 'Escape', keyCode: 27 }))).toBe(false);
    expect(keyboard.getKeyboardShortcutKey(makeEvent({ key: 'Escape', keyCode: 27 }))).toBe('Escape');
    expect(keyboard.isBackKeyboardEvent(makeEvent({ key: 'Backspace', keyCode: 8 }))).toBe(false);
});

test('dispatches only the highest active Back layer and consumes the event', () => {
    const event = makeEvent();
    const playerMenu = jest.fn(() => true);
    const route = jest.fn(() => true);

    expect(backHandlers.dispatchBackHandlers(event, [
        { priority: 300, order: 3, handler: route },
        { priority: 400, order: 2, handler: playerMenu },
    ])).toBe(true);
    expect(playerMenu).toHaveBeenCalledTimes(1);
    expect(route).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
});

test('tries equal-priority handlers in reverse registration order until one consumes Back', () => {
    const first = jest.fn(() => true);
    const lastRegistered = jest.fn(() => false);

    backHandlers.dispatchBackHandlers(makeEvent(), [
        { priority: 500, order: 1, handler: first },
        { priority: 500, order: 2, handler: lastRegistered },
    ]);
    expect(lastRegistered).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
});

test('does not consume an event when every registered layer declines it', () => {
    const event = makeEvent();
    expect(backHandlers.dispatchBackHandlers(event, [
        { priority: 1, order: 1, handler: () => false },
    ])).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
});

test('closes an explicit route origin before considering history', () => {
    expect(getBackNavigationAction({
        pathname: '/metadetails/movie/id',
        state: { from: { pathname: '/discover', search: '?genre=drama' } },
    }, { idx: 8 })).toEqual({ type: 'route-origin', target: '/discover?genre=drama' });
});

test.each([1, 2])('uses one internal router entry for positive idx %s', idx => {
    expect(getBackNavigationAction({ pathname: '/settings', state: null }, { idx })).toEqual({ type: 'history' });
});

test('calls the platform only from Board root and ignores global history length', () => {
    expect(getBackNavigationAction({ pathname: '/', state: null }, { idx: 0 })).toEqual({ type: 'platform' });
    expect(getBackNavigationAction({ pathname: '/settings', state: null }, { idx: 0, length: 10 })).toEqual({ type: 'none' });
    expect(getBackNavigationAction({ pathname: '/settings', state: null }, null)).toEqual({ type: 'none' });
});

test('App Back navigation registers route and fallback handlers with its provider and runs one action', () => {
    const navigate = jest.fn();
    const platformBack = jest.fn();
    const location = {
        pathname: '/movie/id',
        search: '',
        hash: '',
        state: { from: { pathname: '/discover' } },
    };
    const registered = [];
    const priorities = { ROUTE_MODAL: 300, FALLBACK: 100 };
    const historyState = { idx: 2 };
    const dependencies = {
        react: { useCallback: callback => callback },
        'react-router': { useLocation: () => location, useNavigate: () => navigate },
        'stremio/common': {
            usePlatform: () => ({ webos: { platformBack } }),
            useBackHandler: (...args) => registered.push(args),
            BACK_HANDLER_PRIORITIES: priorities,
        },
        'stremio/common/Shortcuts/backNavigation': { getBackNavigationAction },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync('src/App/BackNavigation.js', 'utf8'), {
        module,
        exports: module.exports,
        require: id => dependencies[id],
        window: { history: { state: historyState } },
    });
    module.exports();

    expect(registered.map(([, priority, enabled]) => [priority, enabled])).toEqual([
        [priorities.ROUTE_MODAL, true],
        [priorities.FALLBACK, undefined],
    ]);
    const [routeHandler] = registered[0];
    const [fallbackHandler] = registered[1];
    expect(routeHandler()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/discover', { replace: true });
    expect(fallbackHandler()).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);

    location.state = null;
    fallbackHandler();
    expect(navigate).toHaveBeenLastCalledWith(-1);
    historyState.idx = 0;
    location.pathname = '/';
    fallbackHandler();
    expect(platformBack).toHaveBeenCalledTimes(1);
});

test('ShortcutsProvider handles Back before its focused-input shortcut filter and only once per hold', () => {
    let onKeyDown;
    const fakeDocument = {
        activeElement: { tagName: 'INPUT', isContentEditable: false },
        addEventListener: jest.fn((name, listener) => { if (name === 'keydown') onKeyDown = listener; }),
        removeEventListener: jest.fn(),
    };
    class FakeHTMLElement {}
    Object.setPrototypeOf(fakeDocument.activeElement, FakeHTMLElement.prototype);

    const fakeReact = {
        createContext: () => ({ Provider: 'provider' }),
        createElement: (type, props, children) => ({ type, props: { ...props, children } }),
        useCallback: callback => callback,
        useContext: () => ({}),
        useEffect: effect => effect(),
        useRef: value => ({ current: value }),
    };
    const providerModule = loadTypeScriptModule('src/common/Shortcuts/Shortcuts.tsx', {
        react: fakeReact,
        './keyboard': keyboard,
        './backHandlers': backHandlers,
        './dispatchWebOSShortcut': dispatchWebOSShortcut,
        './shortcuts.json': [],
    }, { document: fakeDocument, HTMLElement: FakeHTMLElement });
    const onShortcut = jest.fn();
    const provider = providerModule.ShortcutsProvider({ children: 'app', onShortcut, backEnabled: true });
    const handler = jest.fn(() => true);
    const mediaBackShortcut = jest.fn(() => true);
    provider.props.value.on('Back', mediaBackShortcut);
    const unregister = provider.props.value.registerBackHandler(handler, 100);

    const first = makeEvent({ keyCode: 461, which: 461 });
    onKeyDown(first);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mediaBackShortcut).not.toHaveBeenCalled();
    expect(onShortcut).not.toHaveBeenCalled();
    expect(first.preventDefault).toHaveBeenCalledTimes(1);

    const repeat = makeEvent({ keyCode: 461, which: 461, repeat: true });
    onKeyDown(repeat);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(repeat.preventDefault).toHaveBeenCalledTimes(1);

    unregister();
    const afterCleanup = makeEvent({ key: 'Back' });
    onKeyDown(afterCleanup);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(afterCleanup.preventDefault).not.toHaveBeenCalled();

    expect(fakeDocument.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
});

test('cancelling an active seek clears its preview and stale commit flush without seeking', () => {
    let preview = null;
    const animationCallbacks = [];
    const fakeReact = {
        createContext: () => ({}),
        useCallback: callback => callback,
        useLayoutEffect: () => {},
        useRef: current => ({ current }),
        useState: initial => [initial, next => { preview = next; }],
    };
    const fakeDebounce = callback => {
        let pending = false;
        const debounced = () => { pending = true; };
        debounced.cancel = () => { pending = false; };
        debounced.flush = () => {
            if (pending) {
                pending = false;
                callback();
            }
        };
        return debounced;
    };
    const module = loadTypeScriptModule('src/routes/Player/useKeyboardSeek.ts', {
        react: fakeReact,
        'stremio/common': { useLiveRef: current => ({ current }) },
        'lodash.debounce': fakeDebounce,
    }, {
        requestAnimationFrame: callback => { animationCallbacks.push(callback); },
    });
    const onSeek = jest.fn();
    const setSeeking = jest.fn();
    const seek = module.default({ time: 100, duration: 1000, onSeek, setSeeking });

    seek.seekBy(30);
    expect(preview).toBe(130);
    expect(setSeeking).toHaveBeenLastCalledWith(true);
    seek.release();
    seek.cancel();
    animationCallbacks.forEach(callback => callback());

    expect(preview).toBe(null);
    expect(onSeek).not.toHaveBeenCalled();
    expect(setSeeking).toHaveBeenLastCalledWith(false);
});

test.each(['hosted', 'packaged'])('keeps the demo %s appinfo Back interception flag enabled', model => {
    const appinfo = JSON.parse(fs.readFileSync(`webos/hello/${model}/appinfo.json`, 'utf8'));
    expect(appinfo.disableBackHistoryAPI).toBe(true);
});
