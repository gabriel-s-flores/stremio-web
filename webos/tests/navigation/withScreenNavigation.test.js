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
