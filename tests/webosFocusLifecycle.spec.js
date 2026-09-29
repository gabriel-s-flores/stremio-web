const { React, loader, mount, tick } = require('./helpers/tvDom');
let view;
beforeEach(() => { jest.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(async () => { if (view) view.unmount(); view = null; await tick(); jest.useRealTimers(); });

function fixture(webos = true) {
    const useInitialFocus = loader(webos)('src/common/TV/useInitialFocus.js');
    return ({ active = true, locationKey = 'catalog', pathname = '/discover', children }) => {
        const ref = React.useRef(null);
        useInitialFocus(ref, active, locationKey, pathname);
        return React.createElement('div', { ref, 'data-tv-route-active': String(active) }, children);
    };
}
const card = (id, props = {}) => React.createElement('button', { key: id, id, 'data-focus-priority': 10, ...props }, id);

test('initial card, retained Discover → details → Back, and removed-item fallback', async () => {
    const Route = fixture();
    const render = (active, second = true) => React.createElement(Route, { active }, [card('first'), second && card('second')]);
    view = mount(render(true));
    await tick();
    expect(document.activeElement.id).toBe('first');
    document.getElementById('second').focus();
    view.render(render(false));
    const overlay = document.createElement('button');
    document.body.appendChild(overlay); overlay.focus();
    view.render(render(true));
    await tick();
    expect(document.activeElement.id).toBe('second');
    view.render(render(false)); overlay.focus();
    view.render(render(true, false));
    await tick();
    expect(document.activeElement.id).toBe('first');
});

test('waits for asynchronous catalog cards without initially focusing See All', async () => {
    const Route = fixture();
    const content = cards => React.createElement(Route, {}, React.createElement('div', { 'data-tv-content': true }, [React.createElement('button', { key: 'all', id: 'all' }, 'All'), ...cards]));
    view = mount(content([]));
    await tick();
    expect(document.activeElement).toBe(document.body);
    view.render(content([card('loaded')]));
    await tick();
    expect(document.activeElement.id).toBe('loaded');
});

test('user interaction wins over late content and timers', async () => {
    const Route = fixture();
    view = mount(React.createElement(Route, {}, [React.createElement('button', { id: 'nav', key: 'nav' }, 'Nav')]));
    document.getElementById('nav').focus();
    view.render(React.createElement(Route, {}, [React.createElement('button', { id: 'nav', key: 'nav' }, 'Nav'), card('late')]));
    await tick(1300);
    expect(document.activeElement.id).toBe('nav');
});

test('empty catalog has navigable fallback and disabled/hidden cards are skipped', async () => {
    const Route = fixture();
    view = mount(React.createElement(Route, {}, [card('disabled', { disabled: true }), card('hidden', { hidden: true }), React.createElement('button', { id: 'nav', key: 'nav' }, 'Nav')]));
    await tick(1300);
    expect(document.activeElement.id).toBe('nav');
});

test('Search starts at its input; a fresh history entry does not restore the previous entry', async () => {
    const Route = fixture();
    view = mount(React.createElement(Route, { pathname: '/search' }, [card('result'), React.createElement('input', { id: 'search', key: 'search' })]));
    await tick(); expect(document.activeElement.id).toBe('search');
    document.getElementById('result').focus();
    view.render(React.createElement(Route, { active: false }));
    document.activeElement.blur();
    view.render(React.createElement(Route, { pathname: '/search', locationKey: 'new' }, [card('result'), React.createElement('input', { id: 'search', key: 'search' })]));
    await tick(); expect(document.activeElement.id).toBe('search');
});

test('Player prioritizes play/pause and desktop installs no initial-focus policy', async () => {
    const Route = fixture();
    view = mount(React.createElement(Route, { pathname: '/player/stream' }, [card('other'), card('play', { 'data-focus-priority': 20 })]));
    await tick(); expect(document.activeElement.id).toBe('play');
    view.unmount(); view = null;
    const Desktop = fixture(false);
    view = mount(React.createElement(Desktop, {}, card('desktop')));
    await tick(1300); expect(document.activeElement).toBe(document.body);
});

test('an open overlay keeps ownership of focus when route content arrives', async () => {
    const overlay = document.createElement('div'); overlay.dataset.focusLockDisabled = 'false';
    overlay.innerHTML = '<button id="modal">Modal</button>'; document.body.appendChild(overlay);
    document.getElementById('modal').focus();
    const Route = fixture(); view = mount(React.createElement(Route, {}, card('background')));
    await tick(1300); expect(document.activeElement.id).toBe('modal');
});

test('real shared Modal FocusLock autofocuses, traps and returns focus to opener', async () => {
    const portal = document.createElement('div'); document.body.appendChild(portal);
    const Modal = loader(true, { '../ModalsContainerContext': { useModalsContainer: () => portal } })('src/router/Modal/Modal.js');
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
    const render = open => open ? React.createElement(Modal, {}, React.createElement('button', { id: 'inside' }, 'Inside')) : null;
    view = mount(render(true)); await tick();
    expect(document.activeElement.id).toBe('inside');
    React.act(() => opener.focus()); await tick();
    expect(document.activeElement.id).toBe('inside');
    view.render(render(false)); await tick();
    expect(document.activeElement).toBe(opener);
});

test('nested focus locks restore the inner opener, then the route opener', async () => {
    const portal = document.createElement('div'); document.body.appendChild(portal);
    const Modal = loader(true, { '../ModalsContainerContext': { useModalsContainer: () => portal } })('src/router/Modal/Modal.js');
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
    const render = nested => React.createElement(React.Fragment, {}, [
        React.createElement(Modal, { key: 'outer' }, React.createElement('button', { id: 'outer' }, 'Outer')),
        nested && React.createElement(Modal, { key: 'inner' }, React.createElement('button', { id: 'inner' }, 'Inner'))
    ]);
    view = mount(render(false)); await tick(); expect(document.activeElement.id).toBe('outer');
    view.render(render(true)); await tick(); expect(document.activeElement.id).toBe('inner');
    view.render(render(false)); await tick(); expect(document.activeElement.id).toBe('outer');
    view.render(null); await tick(); expect(document.activeElement).toBe(opener);
});

test('BottomSheet participates in central Back and returns focus', async () => {
    let back;
    const Sheet = loader(true, {
        'stremio/common/useOrientation': () => 'landscape',
        'stremio/common/Shortcuts': {
            BACK_HANDLER_PRIORITIES: { MODAL: 500 },
            useBackHandler: (cb, priority, enabled) => { if (enabled) back = cb; }
        }
    })('src/components/BottomSheet/BottomSheet.tsx').default;
    let open;
    function Host() {
        const [show, setShow] = React.useState(false); open = () => setShow(true);
        return React.createElement(Sheet, { title: 'Sheet', show, onClose: () => setShow(false) }, React.createElement('button', { id: 'sheet' }, 'Action'));
    }
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
    view = mount(React.createElement(Host)); React.act(() => open()); await tick();
    expect(document.activeElement.id).toBe('sheet');
    React.act(() => back()); await tick();
    expect(document.getElementById('sheet')).toBeNull(); expect(document.activeElement).toBe(opener);
});
