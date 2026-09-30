const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');

const loadButton = () => {
    let nextTimerId = 1;
    const timers = new Map();
    const keyupListeners = new Set();
    const cleanups = [];
    const fakeWindow = {
        addEventListener: jest.fn((name, listener) => {
            if (name === 'keyup') keyupListeners.add(listener);
        }),
        removeEventListener: jest.fn((name, listener) => {
            if (name === 'keyup') keyupListeners.delete(listener);
        }),
    };
    const react = {
        createElement: (type, props, children) => ({ type, props, children }),
        forwardRef: callback => callback,
        useCallback: callback => callback,
        useEffect: callback => { cleanups.push(callback()); },
        useRef: current => ({ current }),
    };
    const classNames = (...values) => values.filter(Boolean).join(' ');
    classNames.default = classNames;
    const dependencies = {
        react,
        classnames: classNames,
        'use-long-press': {
            LongPressEventType: { Pointer: 'pointer' },
            useLongPress: () => () => ({}),
        },
        './Button.less': { 'button-container': 'button-container' },
    };
    const source = ts.transpileModule(fs.readFileSync('src/components/Button/Button.tsx', 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.React,
            esModuleInterop: true,
        },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        require: id => dependencies[id] || require(id),
        process: { env: { WEBOS: '1' } },
        window: fakeWindow,
        setTimeout: (callback, delay) => {
            const id = nextTimerId++;
            timers.set(id, { callback, delay });
            return id;
        },
        clearTimeout: jest.fn(id => timers.delete(id)),
    });

    return {
        Button: module.exports.default,
        keyupListeners,
        timers,
        cleanups,
        render: (props) => {
            const target = { click: jest.fn() };
            const node = module.exports.default({ children: 'OK', ...props }, null);
            return { ...node, target };
        },
    };
};

const makeKeyEvent = (target, overrides = {}) => ({
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    target,
    currentTarget: target,
    repeat: false,
    defaultPrevented: false,
    nativeEvent: {},
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
});

const dispatchKeyUp = (listeners, event) => {
    [...listeners].forEach(listener => listener(event));
};

test('short OK invokes one click on keyup for a Button with long-press behavior', () => {
    const harness = loadButton();
    const onLongPress = jest.fn();
    const button = harness.render({ onLongPress });
    const keydown = makeKeyEvent(button.target);

    button.props.onKeyDown(keydown);
    expect(keydown.defaultPrevented).toBe(true);
    expect([...harness.timers.values()].map(timer => timer.delay)).toEqual([500]);
    expect(harness.keyupListeners.size).toBe(1);

    dispatchKeyUp(harness.keyupListeners, makeKeyEvent(button.target));
    expect(button.target.click).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(harness.keyupListeners.size).toBe(0);
    expect(harness.timers.size).toBe(0);
});

test('held OK invokes only the long-press callback and never clicks the control', () => {
    const harness = loadButton();
    const onLongPress = jest.fn();
    const button = harness.render({ onLongPress });
    button.props.onKeyDown(makeKeyEvent(button.target));

    const timer = [...harness.timers.values()][0];
    timer.callback();
    dispatchKeyUp(harness.keyupListeners, makeKeyEvent(button.target));

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(button.target.click).not.toHaveBeenCalled();
    expect(harness.keyupListeners.size).toBe(0);
});

test('repeated OK keydowns are prevented without starting another press timer', () => {
    const harness = loadButton();
    const onLongPress = jest.fn();
    const button = harness.render({ onLongPress, href: '/stream' });
    button.props.onKeyDown(makeKeyEvent(button.target));
    const repeat = makeKeyEvent(button.target, { repeat: true });

    button.props.onKeyDown(repeat);

    expect(repeat.defaultPrevented).toBe(true);
    expect(harness.timers.size).toBe(1);
    [...harness.timers.values()][0].callback();
    dispatchKeyUp(harness.keyupListeners, makeKeyEvent(button.target));
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(button.target.click).not.toHaveBeenCalled();
});

test.each([
    { key: 'Accept' },
    { key: 'Select' },
    { key: 'OK' },
    { code: 'NumpadEnter' },
    { key: 'Unidentified', code: 'Unidentified', keyCode: 13, which: 13 },
])('accepts webOS OK alias %p', alias => {
    const harness = loadButton();
    const button = harness.render({ onLongPress: jest.fn() });
    const keydown = makeKeyEvent(button.target, alias);

    button.props.onKeyDown(keydown);

    expect(keydown.defaultPrevented).toBe(true);
    expect(harness.timers.size).toBe(1);
});

test('blur and unmount clear a pending long press and remove its keyup listener', () => {
    const blurHarness = loadButton();
    const blurButton = blurHarness.render({ onLongPress: jest.fn() });
    blurButton.props.onKeyDown(makeKeyEvent(blurButton.target));
    blurButton.props.onBlur({ currentTarget: blurButton.target });
    expect(blurHarness.timers.size).toBe(0);
    expect(blurHarness.keyupListeners.size).toBe(0);
    dispatchKeyUp(blurHarness.keyupListeners, makeKeyEvent(blurButton.target));
    expect(blurButton.target.click).not.toHaveBeenCalled();

    const unmountHarness = loadButton();
    const unmountButton = unmountHarness.render({ onLongPress: jest.fn() });
    unmountButton.props.onKeyDown(makeKeyEvent(unmountButton.target));
    unmountHarness.cleanups.forEach(cleanup => cleanup?.());
    expect(unmountHarness.timers.size).toBe(0);
    expect(unmountHarness.keyupListeners.size).toBe(0);
});
