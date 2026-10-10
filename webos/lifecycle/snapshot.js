// Where the user was when the app left the foreground (F3.3): route, focused element and the
// scroll position of the focused element's ancestors. The page is not reloaded on HOME or on a
// relaunch (handlesRelaunch), so everything is normally still in place; the snapshot is only used
// to put back what the system took away while the app was behind, namely the focus.
//
// Taking a snapshot walks the ancestors of one element, nothing else: it runs on the way to the
// background, never at boot.

const isConnected = (doc, element) => !!element && doc.documentElement.contains(element);

const hasFocusedElement = (doc) => {
    const active = doc.activeElement;
    return !!active && active !== doc.body && active !== doc.documentElement;
};

const describeElement = (element) => {
    if (!element || !element.tagName) {
        return null;
    }
    const className = typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return element.tagName.toLowerCase() + (element.id ? `#${element.id}` : '') + (className ? `.${className}` : '');
};

const collectScroll = (doc, from) => {
    const scrolls = [];
    for (let element = from; element && element !== doc.documentElement; element = element.parentElement) {
        if (element.scrollTop > 0 || element.scrollLeft > 0) {
            scrolls.push({ element, top: element.scrollTop, left: element.scrollLeft });
        }
    }
    return scrolls;
};

const capture = (win) => {
    const doc = win.document;
    const focus = hasFocusedElement(doc) ? doc.activeElement : null;
    return {
        hash: win.location.hash,
        focus,
        scrolls: collectScroll(doc, focus),
    };
};

// Puts back the focus if it was lost, then the scroll positions that moved in the process.
// Returns what it did, for the log.
const restore = (win, snapshot) => {
    const doc = win.document;
    const result = {
        routeChanged: snapshot.hash !== win.location.hash,
        focus: 'kept',
        scroll: 0,
    };
    if (snapshot.focus === null) {
        result.focus = 'none';
    } else if (!hasFocusedElement(doc)) {
        if (isConnected(doc, snapshot.focus) && typeof snapshot.focus.focus === 'function') {
            snapshot.focus.focus();
            result.focus = 'restored';
        } else {
            result.focus = 'gone';
        }
    }
    if (!result.routeChanged) {
        snapshot.scrolls.forEach(({ element, top, left }) => {
            if (isConnected(doc, element) && (element.scrollTop !== top || element.scrollLeft !== left)) {
                element.scrollTop = top;
                element.scrollLeft = left;
                result.scroll += 1;
            }
        });
    }
    return result;
};

module.exports = {
    capture,
    restore,
    describeElement,
};
