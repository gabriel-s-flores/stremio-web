/**
 * @jest-environment jsdom
 */
/* global test, expect */
// The capture listener of the download links (F3.7b) next to the long press of the Magic Remote (F4.3):
// the release that follows a long press is swallowed by the F4.3 listener (window, capture) before this
// one (document, capture) sees it; a plain click on the link still opens the dialog.

const { createStore, install } = require('../../external-links/links');
const { installContextMenuTrigger } = require('../../lib/navigation/contextMenu');

const setup = () => {
    document.body.innerHTML = '<div id="menu"><a id="dl" href="https://debrid-link.com/x.srt" download="x.srt" target="_blank">Download</a><a id="web" href="https://example.com/help" target="_blank">Help</a></div>';
    const menu = document.getElementById('menu');
    // ContextMenu: the container handles contextmenu, and stops the clicks inside it
    menu.addEventListener('contextmenu', (event) => event.preventDefault());
    menu.addEventListener('click', (event) => event.stopPropagation());
    const store = createStore();
    // external-links installs at module load, before the effect that installs the F4.3 trigger
    const offLinks = install(window, store);
    let fire = null;
    const offTrigger = installContextMenuTrigger(window, { isTrusted: () => true, setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout: () => {} });
    return { store, fire: () => fire(), off: () => { offLinks(); offTrigger(); } };
};

const longPressThenRelease = (id, ctx) => {
    const element = document.getElementById(id);
    document.elementFromPoint = () => element;
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 }));
    ctx.fire();
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
};

test('a long press on a download link: the release does not open the QR', () => {
    const ctx = setup();
    longPressThenRelease('dl', ctx);
    expect(ctx.store.getState().url).toBeNull();
    ctx.off();
});

test('a long press on a plain web link: the release does not open the QR either', () => {
    const ctx = setup();
    longPressThenRelease('web', ctx);
    expect(ctx.store.getState().url).toBeNull();
    ctx.off();
});

test('a plain click on the download link, inside the container that stops the clicks, opens the QR', () => {
    const ctx = setup();
    document.getElementById('dl').click();
    expect(ctx.store.getState().url).toBe('https://debrid-link.com/x.srt');
    ctx.off();
});
