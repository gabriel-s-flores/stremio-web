/**
 * @jest-environment jsdom
 */
// webos/lib/navigation/RemoteNavigation.js, the part of the navigation mounted once for the app
// (src/App/index.webos.js): the overlays, the context menus and the side bar on the input hub, the
// interface zoom, and the diagnostics the emulator tests read.

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const RemoteNavigation = require('../../lib/navigation/RemoteNavigation');
const { getInputHub } = require('../../lib/navigation/core/input');
const { createScreenFocus } = require('../../lib/navigation/core/screenFocus');

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
    Element.prototype.getClientRects = function () {
        return this.closest('[data-hidden]') ? [] : [{}];
    };
    Element.prototype.getBoundingClientRect = function () {
        return { top: 0, left: 0, width: 10, height: 10, right: 10, bottom: 10 };
    };
});

let root;
let host;
beforeEach(() => {
    jest.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    jest.useRealTimers();
    document.body.innerHTML = '';
});

test('installs the app-wide parts on the input hub, and removes them', () => {
    const before = getInputHub(window).listeners;
    act(() => root.render(React.createElement(RemoteNavigation)));
    const hub = getInputHub(window);
    // The overlays, the YELLOW key and the side bar.
    expect(hub.listeners.keys).toBe(before.keys + 3);
    expect(hub.listeners.focus).toBe(before.focus + 1);
    expect(window.__webosModalFocus).toBeDefined();
    expect(window.__webosNavigation.hub).toBe(hub);
    expect(window.__webosNavigationF41b).toBe(window.__webosNavigation);
    act(() => root.unmount());
    root = createRoot(host);
    expect(hub.listeners).toEqual(before);
    expect(window.__webosNavigation).toBeUndefined();
    expect(window.__webosModalFocus).toBeUndefined();
});

test('a resize (the interface zoom) realigns the focus of the visible screen, once per burst', () => {
    act(() => root.render(React.createElement(RemoteNavigation)));
    document.body.insertAdjacentHTML('beforeend', '<div class="routes-container"><div class="route-container"><div class="route-content"><a href="#/x" id="item">x</a></div></div></div>');
    const realign = jest.fn();
    const focus = createScreenFocus(document.querySelector('.route-content'), { initial: () => null, realign });
    document.getElementById('item').focus();
    expect(window.__webosNavigation.screen()).toBe(focus);
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect(realign).not.toHaveBeenCalled();
    jest.advanceTimersByTime(0);
    expect(realign).toHaveBeenCalledTimes(1);
    expect(realign.mock.calls[0][0]).toBe(document.getElementById('item'));
    focus.destroy();
});
