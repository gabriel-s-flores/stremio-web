// The remote in the Player (F5.7). The hook is in usePlayerRemote.js (it needs the app's window and
// webos/back); this entry only has what the control bar override needs to render.

// Returns `element` with the descendants that have tabIndex -1 made focusable (tabIndex 0), cloning
// only the elements on the way to a changed one. The upstream control bar takes its buttons out of
// the tab order; the remote has to reach them. `React` is injected for the tests.
const makeFocusable = (React, element) => {
    const visit = (node) => {
        if (!React.isValidElement(node)) return node;
        let props;
        if (node.props.tabIndex === -1) props = { tabIndex: 0 };
        const children = node.props.children;
        let next = children;
        if (children !== undefined && typeof children !== 'function') {
            let changed = false;
            next = React.Children.map(children, (child) => {
                const result = visit(child);
                if (result !== child) changed = true;
                return result;
            });
            if (!changed) next = children;
        }
        if (props === undefined && next === children) return node;
        return next === children ? React.cloneElement(node, props) : React.cloneElement(node, props, next);
    };
    return visit(element);
};

module.exports = {
    makeFocusable,
};
