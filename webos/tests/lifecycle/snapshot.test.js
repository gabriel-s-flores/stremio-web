const { capture, restore, describeElement } = require('../../lifecycle/snapshot');
const { createWindow } = require('./helpers');

const setup = () => {
    const win = createWindow({ hash: '#/discover' });
    const doc = win.document;
    const scroller = doc.create('div');
    scroller.className = 'route-content scrolled';
    const card = doc.create('a', scroller);
    card.id = 'card-7';
    return { win, doc, scroller, card };
};

describe('capture', () => {
    test('keeps the route, the focused element and the scroll of its ancestors', () => {
        const { win, doc, scroller, card } = setup();
        scroller.scrollTop = 420;
        card.focus();

        const snapshot = capture(win);

        expect(snapshot.hash).toBe('#/discover');
        expect(snapshot.focus).toBe(card);
        expect(snapshot.scrolls).toEqual([{ element: scroller, top: 420, left: 0 }]);
        expect(doc.activeElement).toBe(card);
    });

    test('nothing focused (body) leaves no focus to restore', () => {
        const { win } = setup();
        expect(capture(win).focus).toBeNull();
    });

    test('ancestors that were not scrolled are not recorded', () => {
        const { win, card } = setup();
        card.focus();
        expect(capture(win).scrolls).toEqual([]);
    });
});

describe('restore', () => {
    test('puts the focus back when the system took it, then the scroll the refocus moved', () => {
        const { win, doc, scroller, card } = setup();
        scroller.scrollTop = 420;
        card.focus();
        const snapshot = capture(win);
        doc.activeElement = doc.body;
        scroller.scrollTop = 0;

        const result = restore(win, snapshot);

        expect(result).toEqual({ routeChanged: false, focus: 'restored', scroll: 1 });
        expect(doc.activeElement).toBe(card);
        expect(scroller.scrollTop).toBe(420);
    });

    test('keeps the focus when it is still there', () => {
        const { win, card } = setup();
        card.focus();
        const snapshot = capture(win);
        card.focusCalls = 0;

        expect(restore(win, snapshot)).toEqual({ routeChanged: false, focus: 'kept', scroll: 0 });
        expect(card.focusCalls).toBe(0);
    });

    test('an element that left the page is not focused', () => {
        const { win, doc, card } = setup();
        card.focus();
        const snapshot = capture(win);
        doc.activeElement = doc.body;
        doc.detach(card);

        expect(restore(win, snapshot).focus).toBe('gone');
        expect(card.focusCalls).toBe(1);
    });

    test('a route that changed in the meantime is reported and its scroll is not forced', () => {
        const { win, doc, scroller, card } = setup();
        scroller.scrollTop = 420;
        card.focus();
        const snapshot = capture(win);
        win.location.hash = '#/library';
        doc.activeElement = doc.body;
        scroller.scrollTop = 5;

        const result = restore(win, snapshot);

        expect(result.routeChanged).toBe(true);
        expect(result.scroll).toBe(0);
        expect(scroller.scrollTop).toBe(5);
    });

    test('without a focus to restore it only reports', () => {
        const { win } = setup();
        expect(restore(win, capture(win)).focus).toBe('none');
    });
});

describe('describeElement', () => {
    test('tag, id and the first classes', () => {
        const { card, scroller } = setup();
        expect(describeElement(card)).toBe('a#card-7');
        expect(describeElement(scroller)).toBe('div.route-content.scrolled');
        expect(describeElement(null)).toBeNull();
    });
});
