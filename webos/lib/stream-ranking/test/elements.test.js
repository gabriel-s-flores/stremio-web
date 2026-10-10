/* global describe, it, expect, jest */
// Element helpers of the overrides: the items array is found in a tree shaped like the upstream
// StreamsList render (fragments, conditionals, an install button after the items).

const React = require('react');
const { replaceItems, insertAfter, chain } = require('../elements');

const h = React.createElement;
const Item = () => null;
const Other = () => null;

// The shape of StreamsList's render: header, then a fragment with the scrolling container
// (items + install button) and the loading bar.
const listTree = (names, withInstall) => h('div', { className: 'streams-list-container' },
    h('div', { className: 'select-choices-wrapper' }, null, h(Other, { label: 'menu' })),
    h(React.Fragment, null,
        h('div', { className: 'streams-container' },
            names.map((name, index) => h(Item, { key: index, name })),
            withInstall ? h(Other, { label: 'install' }) : null),
        null));

const findByClass = (element, className) => {
    if (!React.isValidElement(element)) return null;
    if (element.props.className === className) return element;
    let found = null;
    React.Children.forEach(element.props.children, (child) => {
        if (found === null) found = findByClass(child, className);
    });
    return found;
};

describe('replaceItems', () => {
    it('replaces the items array and adds props to its container', () => {
        const tree = listTree(['a', 'b', 'c'], true);
        const onKeyDown = jest.fn();
        const result = replaceItems(React, tree, (child) => child.type === Item, (items) => items.slice().reverse(), () => ({ onKeyDown }));
        const container = findByClass(result, 'streams-container');
        const [items, install] = container.props.children;
        expect(items.map((item) => item.props.name)).toEqual(['c', 'b', 'a']);
        expect(install.props.label).toBe('install');
        expect(container.props.onKeyDown).toBe(onKeyDown);
        // Untouched branches keep their identity.
        expect(result.props.children[0]).toBe(tree.props.children[0]);
    });

    it('works when the items are the only child', () => {
        const tree = h('div', null, [h(Item, { key: 1, name: 'a' }), h(Item, { key: 2, name: 'b' })]);
        const result = replaceItems(React, tree, (child) => child.type === Item, (items) => items.slice(1));
        expect(result.props.children.map((item) => item.props.name)).toEqual(['b']);
    });

    it('returns the same element when there are no items (placeholders, empty list)', () => {
        const placeholders = h('div', { className: 'streams-container' }, h(Other), h(Other));
        const replace = jest.fn();
        expect(replaceItems(React, placeholders, (child) => child.type === Item, replace)).toBe(placeholders);
        const empty = listTree([], true);
        expect(replaceItems(React, empty, (child) => child.type === Item, replace)).toBe(empty);
        expect(replace).not.toHaveBeenCalled();
    });

    it('ignores mixed arrays (not a list of items)', () => {
        const tree = h('div', null, [h(Item, { key: 1 }), h(Other, { key: 2 })]);
        expect(replaceItems(React, tree, (child) => child.type === Item, () => [])).toBe(tree);
    });
});

describe('insertAfter', () => {
    it('inserts after the anchor and merges props', () => {
        const label = h('div', { className: 'stream', title: 'x' }, h('div', { className: 'info' }), h('div', { className: 'description' }), h('span', { className: 'icon' }), null);
        const result = insertAfter(React, label, (child) => child.props.className === 'description', h('div', { key: 'extra', className: 'extra' }), { 'data-x': 1 });
        expect(result.props.children.map((child) => (child ? child.props.className : child))).toEqual(['info', 'description', 'extra', 'icon', null]);
        expect(result.props).toMatchObject({ className: 'stream', title: 'x', 'data-x': 1 });
    });

    it('appends when there is no anchor', () => {
        const result = insertAfter(React, h('div', null, 'text'), () => false, 'extra');
        expect(result.props.children).toEqual(['text', 'extra']);
    });
});

describe('chain', () => {
    it('calls both handlers in order, or the one that exists', () => {
        const calls = [];
        const first = (value) => calls.push(`first ${value}`);
        const second = (value) => calls.push(`second ${value}`);
        chain(first, second)(1);
        expect(calls).toEqual(['first 1', 'second 1']);
        expect(chain(undefined, second)).toBe(second);
        expect(chain(first, null)).toBe(first);
    });
});
