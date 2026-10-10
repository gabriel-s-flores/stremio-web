// React element helpers for the webOS overrides of the streams list (F6.2). The upstream
// StreamsList and Stream render as they are; these helpers only reorder and extend their output,
// so the overrides follow upstream changes. `React` is injected for the tests.

// Finds, in the output of a render, the first array of children made only of elements that match
// `isItem` (the list items: StreamsList renders `filteredStreams.map(…)` as one array) and replaces
// it with `replace(items)`. `containerProps(node)` (optional) adds props to the element that holds
// the array. Elements on the way are cloned; everything else keeps its identity. Returns the
// element unchanged when no such array exists (empty list, placeholders, an upstream change).
const replaceItems = (React, element, isItem, replace, containerProps) => {
    let done = false;
    const isItemArray = (value) => Array.isArray(value) && value.length > 0 && value.every((child) => React.isValidElement(child) && isItem(child));

    const visitChildren = (children) => {
        if (Array.isArray(children)) {
            let changed = false;
            const next = children.map((child) => {
                const result = visitChildren(child);
                if (result !== child) changed = true;
                return result;
            });
            return changed ? next : children;
        }
        return visit(children);
    };

    function visit(node) {
        if (done || !React.isValidElement(node)) return node;
        const children = node.props.children;
        if (children === undefined || children === null || typeof children === 'function') return node;
        // `<div>{items}</div>`: the items array is the children prop itself.
        if (isItemArray(children)) {
            done = true;
            return React.cloneElement(node, containerProps ? containerProps(node) : undefined, replace(children));
        }
        const list = Array.isArray(children) ? children : [children];
        const index = list.findIndex(isItemArray);
        if (index !== -1) {
            done = true;
            const next = list.slice();
            next[index] = replace(list[index]);
            const props = containerProps ? containerProps(node) : undefined;
            return Array.isArray(children) ?
                React.cloneElement.apply(null, [node, props].concat(next))
                :
                React.cloneElement(node, props, next[0]);
        }
        const nextChildren = visitChildren(children);
        if (nextChildren === children) return node;
        return Array.isArray(children) ?
            React.cloneElement.apply(null, [node, undefined].concat(nextChildren))
            :
            React.cloneElement(node, undefined, nextChildren);
    }

    return visit(element);
};

// Inserts `extra` among the children of `element`, right after the first child that matches
// `isAnchor` (appended when none does), and merges `props` into it.
const insertAfter = (React, element, isAnchor, extra, props) => {
    const children = element.props.children;
    const list = Array.isArray(children) ? children.slice() : (children === undefined || children === null ? [] : [children]);
    const index = list.findIndex((child) => React.isValidElement(child) && isAnchor(child));
    list.splice(index === -1 ? list.length : index + 1, 0, extra);
    return React.cloneElement.apply(null, [element, props].concat(list));
};

// Calls the handlers in order (props that may or may not be set upstream).
const chain = (first, second) => {
    if (typeof first !== 'function') return second;
    if (typeof second !== 'function') return first;
    return function chained() {
        first.apply(this, arguments);
        second.apply(this, arguments);
    };
};

module.exports = { replaceItems, insertAfter, chain };
