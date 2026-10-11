/**
 * @jest-environment jsdom
 */
// findTopOverlay (webos/back/overlays.js): the catalogue the focus of the overlays reads. The DOM
// mimics what the upstream components render (CSS modules: `<local>-<hash>`).

const { findTopOverlay } = require('../../back/overlays');

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
