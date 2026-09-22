const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const React = require('react');

function render(file, webos, props = {}, dependencies = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true }
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, document: { body: {} }, process: { env: { WEBOS: webos } }, require: id => {
        if (Object.prototype.hasOwnProperty.call(dependencies, id)) return dependencies[id];
        if (id === 'react') return { ...React, forwardRef: fn => fn, useCallback: fn => fn, useMemo: fn => fn() };
        if (id === 'use-long-press') return { LongPressEventType: {}, useLongPress: () => () => ({}) };
        if (id.endsWith('.less')) return {};
        return require(id);
    } });
    return (module.exports.default || module.exports)({ children: 'test', ...props }, null).props;
}

const button = (webos, props) => render('src/components/Button/Button.tsx', webos, props);

test.each([true, false])('gamepad modal preserves its DOM marker for background navigation detection: %s', webos => {
    const modal = render('src/App/GamepadModal/GamepadModal.tsx', webos, {}, {
        react: { ...React, useEffect: () => {} },
        'react-dom': { createPortal: child => child },
        'react-i18next': { useTranslation: () => ({ t: key => key }) },
        'stremio/components': { Button: 'button' },
        'stremio/services': { useGamepad: () => null },
        '@stremio/stremio-icons/react': 'svg',
        './GamepadDiagram': 'svg',
        'react-focus-lock': 'div'
    });
    expect((webos ? modal.lockProps : modal)['data-gamepad-modal']).toBe(true);
});

test.each([true, false])('server URL modal lets TV arrows reach spatial navigation and preserves desktop handling: %s', webos => {
    const onCancel = jest.fn();
    const modal = render('src/App/StreamingServerUrlModal/StreamingServerUrlModal.tsx', webos, { onCancel }, {
        react: { ...React, useCallback: fn => fn, useEffect: () => {} },
        'react-dom': { createPortal: child => child },
        'react-i18next': { useTranslation: () => ({ t: key => key }) },
        'stremio/components': { Button: 'button' },
        '@stremio/stremio-icons/react': 'svg',
        'react-focus-lock': 'div'
    });
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        const event = { key, stopPropagation: jest.fn(), preventDefault: jest.fn() };
        modal.lockProps.onKeyDown(event);
        expect(event.stopPropagation).toHaveBeenCalledTimes(webos ? 0 : 1);
        expect(event.preventDefault).not.toHaveBeenCalled();
    }
    const escape = { key: 'Escape', stopPropagation: jest.fn(), preventDefault: jest.fn() };
    modal.lockProps.onKeyDown(escape);
    expect(escape.stopPropagation).toHaveBeenCalledTimes(1);
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
});

test('TV custom input submit consumes Enter so a containing form cannot also submit', () => {
    const onSubmit = jest.fn();
    const input = render('src/components/TextInput/TextInput.tsx', true, { onSubmit, tabIndex: -1 });
    const event = { key: 'Enter', preventDefault: jest.fn() };
    input.onKeyDown(event);
    expect(input.tabIndex).toBe(0);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    input.onKeyDown({ ...event, repeat: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('TV promotes explicit negative stops; desktop preserves the caller tabindex', () => {
    expect(button(true, { tabIndex: -1 }).tabIndex).toBe(0);
    expect(button(false, { tabIndex: -1 }).tabIndex).toBe(-1);
});

test.each([{ disabled: true }, { className: 'control disabled' }])('TV disabled controls cannot activate or focus: %j', props => {
    const rendered = button(true, props);
    expect(rendered.tabIndex).toBe(-1);
    const click = jest.fn();
    rendered.onKeyDown({ key: 'Enter', target: {}, currentTarget: { click }, nativeEvent: {}, preventDefault() {} });
    expect(click).not.toHaveBeenCalled();
});

test('TV Enter activates its owner once, ignoring bubbled and repeated keydowns', () => {
    const rendered = button(true);
    const node = { click: jest.fn() };
    const event = { key: 'Enter', target: node, currentTarget: node, nativeEvent: {}, preventDefault() {} };
    rendered.onKeyDown(event);
    rendered.onKeyDown({ ...event, target: {} });
    rendered.onKeyDown({ ...event, repeat: true });
    expect(node.click).toHaveBeenCalledTimes(1);
});

test('TV honors a keyboard handler that cancels activation', () => {
    const rendered = button(true, { onKeyDown: event => { event.defaultPrevented = true; } });
    const node = { click: jest.fn() };
    rendered.onKeyDown({ key: 'Enter', target: node, currentTarget: node, nativeEvent: {} });
    expect(node.click).not.toHaveBeenCalled();
});

test('spatial boundary cancels background candidates and permits internal navigation', () => {
    let listener;
    const inside = {};
    const document = { activeElement: { closest: () => ({ contains: target => target === inside }) },
        addEventListener: jest.fn((name, fn) => { listener = fn; }), removeEventListener: jest.fn() };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync('src/common/installTVSpatialNavigation.js', 'utf8'), { module, document });
    const cleanup = module.exports();
    const blocked = { target: {}, preventDefault: jest.fn() };
    const allowed = { target: inside, preventDefault: jest.fn() };
    listener(blocked); listener(allowed);
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1);
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    cleanup();
    expect(document.removeEventListener).toHaveBeenCalledWith('navbeforefocus', listener, true);
});

test('TV navigation reveals the few pixels clipped by native C68 scrollIntoView rounding', () => {
    let listener;
    const parent = { parentElement: null, scrollTop: 20, scrollLeft: 0, scrollHeight: 1000, clientHeight: 500,
        scrollWidth: 500, clientWidth: 500,
        getBoundingClientRect: () => ({ top: 109.5, bottom: 609.5, left: 0, right: 500 }) };
    const target = { parentElement: parent,
        getBoundingClientRect: () => ({ top: 107.5, bottom: 150.5, left: 20, right: 200 }) };
    const document = { activeElement: { closest: () => null }, addEventListener: (name, fn) => { listener = fn; } };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync('src/common/installTVSpatialNavigation.js', 'utf8'), {
        module, document, getComputedStyle: () => ({ overflowY: 'auto', overflowX: 'hidden',
            borderTopWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px', borderRightWidth: '0px' })
    });
    module.exports();
    listener({ target });
    expect(parent.scrollTop).toBe(18);
    expect(parent.scrollLeft).toBe(0);
});

test('TV row focus reveals horizontal items without starting another vertical smooth scroll', () => {
    const row = render('src/components/MetaRow/MetaRow.js', true, { catalog: { items: [] } }, {
        'stremio/components': { Button: 'button' },
        'stremio/common/CONSTANTS': { CATALOG_PREVIEW_SIZE: 1 },
        'stremio/common/useTranslate': () => ({ catalogTitle: () => '', string: () => '' }),
        'stremio/common/Platform': { usePlatform: () => ({ name: 'webos' }) },
        './MetaRowPlaceholder': () => null,
        './styles': { 'meta-item': 'meta-item' }
    });
    const item = { scrollIntoView: jest.fn(), getBoundingClientRect: () => ({ left: 90, right: 180 }) };
    const container = { scrollWidth: 200, clientWidth: 100, scrollLeft: 0, scrollTop: 30,
        contains: () => true, getBoundingClientRect: () => ({ left: 0, right: 100 }) };
    row.children[1].props.onFocusCapture({ currentTarget: container, target: { closest: () => item } });
    expect(container.scrollLeft).toBe(80);
    expect(container.scrollTop).toBe(30);
    expect(item.scrollIntoView).not.toHaveBeenCalled();
});

test('TV focus finishes a fade-in before measuring and focusing its control', () => {
    let listener;
    const style = {};
    const target = { parentElement: null, classList: { contains: name => name === 'animation-fade-in' },
        style, getBoundingClientRect: () => ({}) };
    const document = { activeElement: { closest: () => null }, addEventListener: (name, fn) => { listener = fn; } };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync('src/common/installTVSpatialNavigation.js', 'utf8'), { module, document });
    module.exports();
    listener({ target });
    expect(style.animationName).toBe('none');
});
