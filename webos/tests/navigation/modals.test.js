/**
 * @jest-environment jsdom
 */
// webos/lib/navigation/modals.js: where the focus goes when an overlay opens, that it cannot leave
// while it is open, and where it returns to. The DOM mimics what the upstream components render
// (CSS modules: `<local>-<hash>`); jsdom has no layout, so the sizes are faked.

const { createModalFocus, findInitialTarget } = require('../../lib/navigation/modals');

let modalFocus;

beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 10; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 10; } });
});

beforeEach(() => {
    jest.useFakeTimers();
    modalFocus = createModalFocus(window, { isTrusted: (event) => event.type === 'mousedown' && event.target === document.body });
});

afterEach(() => {
    modalFocus.stop();
    jest.useRealTimers();
    document.body.innerHTML = '';
});

const page = (content = '', modals = '') => {
    document.body.innerHTML = `
        <div id="app"><div class="routes-container"><div class="route-container">
            <div class="route-content"><button id="behind-a" tabindex="0">A</button><button id="behind-b" tabindex="0">B</button>${content}</div>
            <div class="modals-container">${modals}</div>
        </div></div></div>`;
};

const settle = async () => {
    await Promise.resolve();
    jest.advanceTimersByTime(200);
};

const press = (keyCode) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, keyCode });
    Object.defineProperty(event, 'keyCode', { value: keyCode });
    (document.activeElement || document.body).dispatchEvent(event);
    return event;
};

const pointerPress = () => {
    const event = new MouseEvent('mousedown', { bubbles: true });
    document.body.dispatchEvent(event);
};

const MODAL = '<div class="modal-container modal-container-q1w2e"><input id="field" type="text"><div id="close" tabindex="0">x</div><div id="ok" tabindex="0">ok</div></div>';

const openModal = async () => {
    modalFocus.start();
    await settle();
    document.getElementById('behind-a').focus();
    document.querySelector('.modals-container').innerHTML = MODAL;
    await settle();
};

describe('entering an overlay', () => {
    test('a modal opened with the remote takes the focus, on a button and not on the text field', async () => {
        page();
        await openModal();
        expect(document.activeElement.id).toBe('close');
    });

    test('an element that asks for the focus (autofocus, selected) goes first', () => {
        page('', '<div class="modal-container"><div tabindex="0" id="one"></div><div tabindex="0" id="two" class="option-x selected"></div></div>');
        expect(findInitialTarget(document.querySelector('.modal-container')).id).toBe('two');
    });

    test('hidden and disabled elements are skipped', () => {
        page('', '<div class="modal-container"><button disabled id="off">x</button><div tabindex="-1" id="skip"></div><div tabindex="0" id="on"></div></div>');
        expect(findInitialTarget(document.querySelector('.modal-container')).id).toBe('on');
    });

    test('a focus the component already placed inside is left where it is', async () => {
        page();
        modalFocus.start();
        await settle();
        document.querySelector('.modals-container').innerHTML = MODAL;
        document.getElementById('ok').focus();
        await settle();
        expect(document.activeElement.id).toBe('ok');
    });

    test('nothing moves when the last input was the pointer, but the next arrow enters the overlay', async () => {
        page();
        modalFocus.start();
        await settle();
        document.getElementById('behind-a').focus();
        pointerPress();
        document.querySelector('.modals-container').innerHTML = MODAL;
        await settle();
        expect(document.activeElement.id).toBe('behind-a');
        const event = press(40);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement.id).toBe('close');
        expect(press(40).defaultPrevented).toBe(false);
    });

    test('OK with the focus behind the overlay does not reach the page', async () => {
        page();
        modalFocus.start();
        await settle();
        document.getElementById('behind-a').focus();
        pointerPress();
        document.querySelector('.modals-container').innerHTML = MODAL;
        await settle();
        const clicks = jest.fn();
        document.getElementById('behind-a').addEventListener('keydown', clicks);
        const event = press(13);
        expect(event.defaultPrevented).toBe(true);
        expect(clicks).not.toHaveBeenCalled();
        expect(document.activeElement.id).toBe('close');
    });

    test('an overlay that renders its content a moment later gets the focus when it is there', async () => {
        page();
        modalFocus.start();
        await settle();
        document.querySelector('.modals-container').innerHTML = '<div class="modal-container"></div>';
        await Promise.resolve();
        jest.advanceTimersByTime(20);
        expect(document.activeElement).toBe(document.body);
        document.querySelector('.modal-container').innerHTML = '<div id="late" tabindex="0"></div>';
        jest.advanceTimersByTime(100);
        expect(document.activeElement.id).toBe('late');
    });

    test('the Player menu layer is the root, not the whole Player', async () => {
        page('<div class="player-container-z1x2c"><div id="bar" tabindex="0"></div><div class="menu-layer-a1 layer-b2"><div id="track" tabindex="0"></div></div></div>');
        modalFocus.start();
        await settle();
        expect(document.activeElement.id).toBe('track');
    });

    test('the corner popup of the next video does not take the focus', async () => {
        page('<div class="player-container-z1x2c"><div id="bar" tabindex="0"></div><div class="next-video-popup-container-q1 menu-layer-a1"><div class="dismiss-x" tabindex="0"></div></div></div>');
        modalFocus.start();
        await settle();
        expect(document.activeElement).toBe(document.body);
    });

    test('with the corner popup of the next video open, arrows and OK are not taken', async () => {
        page('<div class="player-container-z1x2c"><div id="bar" tabindex="0"></div><div class="next-video-popup-container-q1 menu-layer-a1"><div class="dismiss-x" tabindex="0"></div></div></div>');
        modalFocus.start();
        await settle();
        document.getElementById('bar').focus();
        expect(press(40).defaultPrevented).toBe(false);
        expect(press(13).defaultPrevented).toBe(false);
        expect(document.activeElement.id).toBe('bar');
    });

    test('the search history dropdown leaves the focus on the field', async () => {
        page('<div class="search-bar-container-s1"><input id="search"><div class="menu-container-m1"><div tabindex="0" id="entry"></div></div></div>');
        modalFocus.start();
        await settle();
        document.getElementById('search').focus();
        document.querySelector('.search-bar-container-s1').appendChild(Object.assign(document.createElement('div'), { className: 'x' }));
        await settle();
        expect(document.activeElement.id).toBe('search');
    });
});

describe('inside an overlay', () => {
    test('a focus that lands behind it comes back to the last element inside', async () => {
        page();
        await openModal();
        document.getElementById('ok').focus();
        document.getElementById('behind-b').focus();
        expect(document.activeElement.id).toBe('ok');
    });

    test('a focus change right after a mouse press is the click, not the navigation', async () => {
        page();
        await openModal();
        pointerPress();
        document.getElementById('behind-b').focus();
        expect(document.activeElement.id).toBe('behind-b');
    });

    test('focus moves inside the overlay are free', async () => {
        page();
        await openModal();
        document.getElementById('ok').focus();
        expect(document.activeElement.id).toBe('ok');
        expect(press(39).defaultPrevented).toBe(false);
    });

    test('a popup above a modal takes the focus and gives it back to the modal element that opened it', async () => {
        page('', MODAL);
        modalFocus.start();
        await settle();
        document.getElementById('ok').focus();
        const label = document.createElement('div');
        label.className = 'active label-x';
        label.innerHTML = '<div class="menu-container-m1"><div tabindex="0" id="item-1"></div><div tabindex="0" id="item-2"></div></div>';
        document.querySelector('.modal-container').appendChild(label);
        await settle();
        expect(document.activeElement.id).toBe('item-1');
        document.getElementById('behind-a').focus();
        expect(document.activeElement.id).toBe('item-1');
        label.remove();
        await settle();
        expect(document.activeElement.id).toBe('ok');
    });
});

describe('an overlay that stays in the DOM when it closes', () => {
    test('a MultiselectMenu without portal gives the focus back to its label after an option is chosen', async () => {
        page('<div class="multiselect-menu-m1" id="box"><div id="label" tabindex="0" aria-haspopup="listbox" aria-expanded="false"></div></div>');
        modalFocus.start();
        await settle();
        const label = document.getElementById('label');
        label.focus();
        label.setAttribute('aria-expanded', 'true');
        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown-d1 open-o1';
        dropdown.innerHTML = '<div id="option-1" tabindex="0" class="option-o1 selected"></div><div id="option-2" tabindex="0"></div>';
        document.getElementById('box').appendChild(dropdown);
        await settle();
        // The label is inside the root and has the focus: it stays; an arrow moves to an option.
        expect(document.activeElement.id).toBe('label');
        document.getElementById('option-1').focus();
        // OK on an option: the dropdown unmounts, the label and the container stay.
        label.setAttribute('aria-expanded', 'false');
        dropdown.remove();
        await settle();
        expect(modalFocus.current).toBeNull();
        expect(document.activeElement.id).toBe('label');
    });
});

describe('an overlay that owns the remote (the QR dialog of F3.4)', () => {
    const DIALOG = '<div role="dialog" aria-modal="true" id="qr"><button id="qr-close">Close</button></div>';

    test('nothing is pulled back to the overlay under it, and its keys are not taken', async () => {
        page();
        await openModal();
        document.getElementById('ok').focus();
        const dialog = document.createElement('div');
        dialog.innerHTML = DIALOG;
        document.body.appendChild(dialog);
        await settle();
        document.getElementById('qr-close').focus();
        expect(document.activeElement.id).toBe('qr-close');
        expect(press(40).defaultPrevented).toBe(false);
        expect(press(13).defaultPrevented).toBe(false);
        document.getElementById('qr-close').blur();
        document.getElementById('behind-b').focus();
        expect(document.activeElement.id).toBe('behind-b');
    });

    test('when it closes the overlay under it holds the focus again', async () => {
        page();
        await openModal();
        document.getElementById('ok').focus();
        const dialog = document.createElement('div');
        dialog.innerHTML = DIALOG;
        document.body.appendChild(dialog);
        await settle();
        document.getElementById('qr-close').focus();
        dialog.remove();
        document.getElementById('ok').focus();
        await settle();
        expect(modalFocus.current).toBe(document.querySelector('.modal-container'));
        document.getElementById('behind-a').focus();
        expect(document.activeElement.id).toBe('ok');
    });
});

describe('arrows inside an overlay', () => {
    // Stand-in for the polyfill: picks the next candidate in document order, none past the last.
    const searches = [];
    beforeEach(() => {
        searches.length = 0;
        HTMLElement.prototype.spatialNavigationSearch = function search(dir, { candidates, container }) {
            searches.push({ dir, container, candidates: candidates.map((element) => element.id) });
            const after = candidates.filter((candidate) => this.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING);
            return dir === 'down' ? after[0] || null : null;
        };
    });
    afterEach(() => {
        delete HTMLElement.prototype.spatialNavigationSearch;
    });

    test('the search only sees the focusables of the overlay and its result gets the focus', async () => {
        page();
        await openModal();
        const event = press(40);
        expect(event.defaultPrevented).toBe(true);
        expect(searches).toEqual([{ dir: 'down', container: document.querySelector('.modal-container'), candidates: ['field', 'ok'] }]);
        expect(document.activeElement.id).toBe('ok');
    });

    test('at the edge of the overlay the key is taken and the focus stays', async () => {
        page();
        await openModal();
        document.getElementById('ok').focus();
        expect(press(40).defaultPrevented).toBe(true);
        expect(press(38).defaultPrevented).toBe(true);
        expect(document.activeElement.id).toBe('ok');
    });

    test('a text field keeps the caret keys for the polyfill', async () => {
        page();
        await openModal();
        document.getElementById('field').focus();
        expect(press(40).defaultPrevented).toBe(false);
        expect(searches).toEqual([]);
    });

    test('ActionMenu moves its own focus', async () => {
        page('<div role="menu" id="menu"><div tabindex="0" id="i1"></div><div tabindex="0" id="i2"></div></div>');
        modalFocus.start();
        await settle();
        document.getElementById('i1').focus();
        expect(press(40).defaultPrevented).toBe(false);
    });
});

describe('leaving an overlay', () => {
    test('the focus returns to the element that opened it', async () => {
        page();
        await openModal();
        document.querySelector('.modals-container').innerHTML = '';
        // The modal unmounted with its focused element: the focus fell on the body.
        await settle();
        expect(document.activeElement.id).toBe('behind-a');
    });

    test('a modal that put the focus inside itself before it was noticed still gives it back to the opener', async () => {
        page();
        modalFocus.start();
        await settle();
        document.getElementById('behind-a').focus();
        document.querySelector('.modals-container').innerHTML = MODAL;
        document.getElementById('field').focus();
        await settle();
        document.querySelector('.modals-container').innerHTML = '';
        await settle();
        expect(document.activeElement.id).toBe('behind-a');
    });

    test('it is not stolen back from a page that already moved the focus', async () => {
        page();
        await openModal();
        document.querySelector('.modals-container').innerHTML = '';
        document.getElementById('behind-b').focus();
        await settle();
        expect(document.activeElement.id).toBe('behind-b');
    });

    test('nothing is trapped after it closed', async () => {
        page();
        await openModal();
        document.querySelector('.modals-container').innerHTML = '';
        await settle();
        document.getElementById('behind-b').focus();
        expect(document.activeElement.id).toBe('behind-b');
        expect(press(39).defaultPrevented).toBe(false);
    });

    test('stop() removes the listeners and the observer', async () => {
        page();
        await openModal();
        modalFocus.stop();
        document.getElementById('behind-b').focus();
        expect(document.activeElement.id).toBe('behind-b');
    });
});
