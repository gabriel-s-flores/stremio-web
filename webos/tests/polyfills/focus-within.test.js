/**
 * @jest-environment jsdom
 */
// The :focus-within polyfill (F8.2): the [focus-within] attribute on the chain of the focused element,
// changed only where the chain changes (the common ancestors keep it, untouched).

const { install } = require('../../polyfills/focus-within');

const build = () => {
    document.body.innerHTML = `
        <div id="list">
            <div id="row1"><div id="a"><button id="a1">a1</button></div><div id="b"><button id="b1">b1</button></div></div>
            <div id="row2"><div id="c"><button id="c1">c1</button></div></div>
        </div>`;
};
const $ = (id) => document.getElementById(id);
const marked = () => Array.from(document.querySelectorAll('[focus-within]')).map((element) => element.id || element.nodeName);

// Every attribute change of the page, as [id, oldValue === null ? 'added' : 'removed'].
const recordChanges = () => {
    const changes = [];
    const observer = new MutationObserver((records) => records.forEach((record) => {
        changes.push([record.target.id || record.target.nodeName, record.oldValue === null ? 'added' : 'removed']);
    }));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['focus-within'], attributeOldValue: true, subtree: true });
    return { changes, take: () => { const out = changes.concat(observer.takeRecords().map((record) => [record.target.id || record.target.nodeName, record.oldValue === null ? 'added' : 'removed'])); changes.length = 0; return out; }, stop: () => observer.disconnect() };
};

describe('focus-within polyfill', () => {
    let polyfill;
    beforeEach(() => {
        jest.useFakeTimers();
        build();
        polyfill = install(window, { force: true });
    });
    afterEach(() => {
        polyfill.uninstall();
        jest.useRealTimers();
    });

    test('does nothing where :focus-within is native', () => {
        polyfill.uninstall();
        expect(install(window)).toBeNull();
        $('a1').focus();
        expect(marked()).toEqual([]);
        polyfill = install(window, { force: true });
    });

    test('marks the chain of the focused element up to html', () => {
        $('a1').focus();
        expect(marked()).toEqual(['HTML', 'BODY', 'list', 'row1', 'a', 'a1']);
    });

    test('moving the focus only changes the elements that leave or enter the chain', () => {
        $('a1').focus();
        const record = recordChanges();
        $('b1').focus();
        jest.runAllTimers();
        expect(record.take().sort()).toEqual([['a', 'removed'], ['a1', 'removed'], ['b', 'added'], ['b1', 'added']].sort());
        expect(marked()).toEqual(['HTML', 'BODY', 'list', 'row1', 'b', 'b1']);
        $('c1').focus();
        jest.runAllTimers();
        expect(record.take().sort()).toEqual([['b', 'removed'], ['b1', 'removed'], ['row1', 'removed'], ['c', 'added'], ['c1', 'added'], ['row2', 'added']].sort());
        record.stop();
    });

    test('a blur to nowhere clears the chain once the task runs', () => {
        $('a1').focus();
        $('a1').blur();
        expect(marked()).toContain('a1');
        jest.runAllTimers();
        expect(marked()).toEqual([]);
    });

    test('no attribute while the body has the focus', () => {
        document.body.focus();
        jest.runAllTimers();
        expect(marked()).toEqual([]);
    });

    test('a focus moved inside a focus handler leaves the chain of the final element only', () => {
        $('a1').addEventListener('focus', () => $('c1').focus());
        $('b1').focus();
        $('a1').focus();
        jest.runAllTimers();
        expect(marked()).toEqual(['HTML', 'BODY', 'list', 'row2', 'c', 'c1']);
        expect(document.activeElement).toBe($('c1'));
    });

    test('the focused element removed from the page leaves no attribute on the ancestors that stay', () => {
        $('a1').focus();
        expect(marked()).toContain('row1');
        // Chromium fires the blur of the removed node (the capture listener of the document sees it
        // while the node is still in the tree); jsdom does not, so the test fires it.
        $('a1').dispatchEvent(new FocusEvent('blur'));
        $('a1').remove();
        jest.runAllTimers();
        expect(document.activeElement).toBe(document.body);
        expect(marked()).toEqual([]);
        // The next focus starts from a clean chain.
        $('b1').focus();
        expect(marked()).toEqual(['HTML', 'BODY', 'list', 'row1', 'b', 'b1']);
    });

    test('uninstall removes the attributes and the listeners', () => {
        $('a1').focus();
        polyfill.uninstall();
        expect(marked()).toEqual([]);
        $('b1').focus();
        expect(marked()).toEqual([]);
        polyfill = install(window, { force: true });
    });
});
