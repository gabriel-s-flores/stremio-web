/**
 * @jest-environment jsdom
 */
// findTopOverlay (webos/back/overlays.js): the catalogue the focus of the overlays reads. The DOM
// mimics what the upstream components render (CSS modules: `<local>-<hash>`).

const { findTopOverlay, OVERLAY_HINT } = require('../../back/overlays');

const render = (content, modals = '') => {
    document.body.innerHTML = `<div class="routes-container"><div class="route-container"><div class="route-content">${content}</div><div class="modals-container">${modals}</div></div></div>`;
};

afterEach(() => {
    document.body.innerHTML = '';
});

describe('findTopOverlay', () => {
    test('is null with nothing open', () => {
        render('<div class="menu-layer-x">not in a player</div>');
        expect(findTopOverlay(document)).toBeNull();
    });

    test('a route modal: the modal container is the root', () => {
        render('', '<div class="modal-container modal-container-q1"><div id="x"></div></div>');
        const overlay = findTopOverlay(document);
        expect(overlay).toMatchObject({ name: 'modal', trapsFocus: true });
        expect(overlay.root).toBe(document.querySelector('.modal-container'));
    });

    test('the Player: the open menu layer is the root, not the whole Player', () => {
        render('<div class="player-container-p1"><div class="bar-b1"></div><div class="menu-layer-m1 layer-l1" id="layer"></div></div>');
        const overlay = findTopOverlay(document);
        expect(overlay.name).toBe('player-menu');
        expect(overlay.root).toBe(document.getElementById('layer'));
    });

    test('the corner popup of the next video does not hold the focus', () => {
        render('<div class="player-container-p1"><div class="next-video-popup-container-n1 menu-layer-m1"><div class="dismiss-d1"></div></div></div>');
        expect(findTopOverlay(document)).toMatchObject({ name: 'next-video-popup', trapsFocus: false });
    });

    test('a Popup: its menu; a MultiselectMenu without portal: the container of label and dropdown', () => {
        render('<div class="active label-a1"><div class="menu-container-m1" id="menu"></div></div>');
        expect(findTopOverlay(document).root).toBe(document.getElementById('menu'));
        render('<div class="multiselect-menu-m1" id="box"><div aria-haspopup="listbox" aria-expanded="true"></div><div class="dropdown-d1"></div></div>');
        const overlay = findTopOverlay(document);
        expect(overlay.name).toBe('popup');
        expect(overlay.root).toBe(document.getElementById('box'));
    });

    test('the root of a react-focus-lock overlay is its lock wrapper', () => {
        document.body.innerHTML = '<div id="lock" data-focus-lock-disabled="disabled"><div class="backdrop-b1"></div><div><h1 id="streaming-server-url-modal-title"></h1></div></div>';
        const overlay = findTopOverlay(document);
        expect(overlay.name).toBe('streaming-server-url-modal');
        expect(overlay.root).toBe(document.getElementById('lock'));
    });

    test('the topmost overlay wins: a popup over a modal', () => {
        render('', '<div class="modal-container modal-container-q1"><div class="active label-a1"><div class="menu-container-m1"></div></div></div>');
        expect(findTopOverlay(document).name).toBe('popup');
    });
});

// The focus layer only runs the full search when a mutated node matches OVERLAY_HINT: every overlay
// the catalogue can find has to be reachable through it, at the node that mounts it.
describe('OVERLAY_HINT', () => {
    const hints = (fixture, modals) => {
        render(fixture, modals);
        const overlay = findTopOverlay(document);
        expect(overlay).not.toBeNull();
        const mounted = overlay.element;
        return mounted.closest(OVERLAY_HINT) !== null || mounted.querySelector(OVERLAY_HINT) !== null || overlay.root.closest(OVERLAY_HINT) !== null;
    };

    test.each([
        ['route modal', '', '<div class="modal-container modal-container-q1"></div>'],
        ['Player menu layer', '<div class="player-container-p1"><div class="menu-layer-m1"></div></div>', ''],
        ['Player side drawer', '<div class="player-container-p1"><div class="side-drawer-layer-d1"></div></div>', ''],
        ['next video popup', '<div class="player-container-p1"><div class="next-video-popup-container-n1 menu-layer-m1"><div class="dismiss-d1"></div></div></div>', ''],
        ['Popup menu', '<div class="active label-a1"><div class="menu-container-m1"></div></div>', ''],
        ['Popup portal layer', '<div class="portal-layer-p1"><div class="menu-container-m1"></div></div>', ''],
        ['ActionMenu', '<div role="menu"></div>', ''],
        ['MultiselectMenu dropdown', '<div class="multiselect-menu-m1"><div aria-haspopup="listbox" aria-expanded="true"></div><div class="dropdown-d1"></div></div>', ''],
    ])('%s', (name, fixture, modals) => {
        expect(hints(fixture, modals)).toBe(true);
    });

    test('ContextMenu, ShortcutsModal and the server URL modal sit in the body', () => {
        document.body.innerHTML = '<div class="context-menu-container-c1"></div>';
        expect(document.body.firstChild.matches(OVERLAY_HINT)).toBe(true);
        document.body.innerHTML = '<div class="shortcuts-modal-s1"></div>';
        expect(document.body.firstChild.matches(OVERLAY_HINT)).toBe(true);
        document.body.innerHTML = '<div><div><h1 id="streaming-server-url-modal-title"></h1></div></div>';
        expect(document.body.firstChild.querySelector(OVERLAY_HINT)).not.toBeNull();
    });

    test('ordinary page content does not match', () => {
        render('<div class="board-container-b1"><a class="meta-item-link-m1" tabindex="0"></a><div class="meta-row-container-r1"></div></div>');
        expect(document.querySelector('.route-container').querySelector(OVERLAY_HINT)).toBeNull();
    });
});
