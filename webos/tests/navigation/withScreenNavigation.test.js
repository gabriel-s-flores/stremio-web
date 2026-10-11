/**
 * @jest-environment jsdom
 */
// The React wrapper of the F4.1a screens (webos/lib/navigation/withScreenNavigation.js), rendered with
// react-dom: the focus is attached to the route content, the route going under another one takes the
// snapshot (leave) and coming back restores it, after the screen's own effects (the SearchBar
// focuses its field whenever the route comes back).

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;

// The route context of src/common/useRouteFocused.ts (TypeScript, behind the stremio/ alias).
let mockRouteActive = true;
jest.mock('stremio/common/useRouteFocused', () => ({ useRouteActive: () => mockRouteActive }), { virtual: true });

const withScreenNavigation = require('../../lib/navigation/withScreenNavigation');

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
    // jsdom has no layout: everything not under [data-hidden] is shown.
    Element.prototype.getClientRects = function () {
        return this.closest('[data-hidden]') ? [] : [{}];
    };
    Element.prototype.getBoundingClientRect = function () {
        return { top: 0, left: 0, width: 10, height: 10, right: 10, bottom: 10 };
    };
});

// A screen like Search: a field it focuses itself whenever the route comes back, and two items.
const Screen = ({ active }) => {
    const fieldRef = React.useRef(null);
    React.useEffect(() => {
        if (active) fieldRef.current.focus();
    }, [active]);
    return React.createElement('div', null,
        React.createElement('input', { ref: fieldRef, tabIndex: -1 }),
        React.createElement('a', { href: '#/one', tabIndex: 0 }, 'one'),
        React.createElement('a', { href: '#/two', tabIndex: 0 }, 'two'));
};

const screen = {
    initial: (container) => container.querySelector('a'),
    navigate: () => null,
    isContent: () => true,
    align: jest.fn(),
};

const Wrapped = withScreenNavigation(Screen, screen);

let root;
let host;
const render = () => act(() => {
    root.render(React.createElement('div', { className: 'route-content' }, React.createElement(Wrapped, { active: mockRouteActive })));
});

beforeEach(() => {
    mockRouteActive = true;
    host = document.createElement('div');
    host.className = 'route-container';
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

test('the marker sits in the route content, next to the screen', () => {
    render();
    const marker = host.querySelector('span[hidden]');
    expect(marker.parentElement.className).toBe('route-content');
    expect(Wrapped.displayName).toBe('WithScreenNavigation(Screen)');
});

test('the focus the screen took on mount is kept (no initial focus over it)', () => {
    render();
    expect(document.activeElement.tagName).toBe('INPUT');
});

test('back on the route: the element left, after the screen focused its own field', () => {
    render();
    const two = host.querySelectorAll('a')[1];
    act(() => two.focus());
    // Another route on top: this one is hidden.
    mockRouteActive = false;
    host.setAttribute('data-hidden', '');
    render();
    act(() => document.activeElement.blur());
    // Back: the screen focuses its field in its effect; the wrapper's effect comes after it.
    mockRouteActive = true;
    host.removeAttribute('data-hidden');
    render();
    expect(document.activeElement).toBe(two);
});

test('unmounting removes the listeners', () => {
    render();
    const content = host.querySelector('.route-content');
    act(() => root.unmount());
    root = createRoot(host);
    const event = new KeyboardEvent('keydown', { keyCode: 40, bubbles: true, cancelable: true });
    content.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
});

// A screen that does not focus anything itself, inside a router location (the views of
// src/router/Routes.tsx each get their own).
const { UNSAFE_LocationContext: LocationContext } = require('react-router');
const { getInputHub } = require('../../lib/navigation/core/input');

const Plain = () => React.createElement('div', null,
    React.createElement('a', { href: '#/one', tabIndex: 0 }, 'one'),
    React.createElement('a', { href: '#/two', tabIndex: 0 }, 'two'));
const WrappedPlain = withScreenNavigation(Plain, screen);
const renderAt = (search) => act(() => {
    root.render(React.createElement(LocationContext.Provider, { value: { location: { pathname: '/library', search, hash: '', state: null, key: search }, navigationType: 'PUSH' } },
        React.createElement('div', { className: 'route-content' }, React.createElement(WrappedPlain))));
});

test('mounted with nothing focused: the screen\'s initial element', () => {
    renderAt('');
    expect(document.activeElement.textContent).toBe('one');
});

test('unmounting removes its handlers from the input hub', () => {
    const before = getInputHub(window).listeners;
    renderAt('');
    expect(getInputHub(window).listeners.keys).toBe(before.keys + 1);
    act(() => root.unmount());
    root = createRoot(host);
    expect(getInputHub(window).listeners).toEqual(before);
});

test('another location on the same screen (a filter): the focus lost with the old list comes back', () => {
    jest.useFakeTimers();
    try {
        renderAt('');
        const [one] = host.querySelectorAll('a');
        act(() => one.blur());
        expect(document.activeElement).toBe(document.body);
        renderAt('?sort=name');
        act(() => jest.advanceTimersByTime(0));
        expect(document.activeElement).toBe(one);
        // Not while the route is under another one.
        act(() => one.blur());
        mockRouteActive = false;
        renderAt('?sort=year');
        act(() => jest.advanceTimersByTime(0));
        expect(document.activeElement).toBe(document.body);
    } finally {
        jest.useRealTimers();
    }
});
