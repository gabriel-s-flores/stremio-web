// External links on webOS TV 4.x (owner: F3.4). The TV has no browser to hand a link to, and a page
// that navigates to https:// would take the app window away from the app. So every way the upstream
// has to leave the app is caught here:
//
// - `window.open(url)` (Platform.openExternal, the stream "open in browser" actions);
// - a click on an `<a href>` that points to the web (`target="_blank"` links such as Help, Terms,
//   Privacy, Share, the addon "configure" page);
//
// A web link (http/https) goes to the store, which the dialog shows as a QR code to scan with the
// phone. Any other external scheme (`magnet:`, `stremio:`, `mailto:`…) has nothing to open on the TV
// and is disabled: the click is cancelled and nothing happens. Links inside the app (`#/…`, `file:`)
// and local blobs and data URLs are left alone.
//
// Nothing here runs at boot but two listeners; the QR code is only built when a link is opened.

// What the app itself uses: hash routes, the packaged page and local URLs.
const LOCAL_PROTOCOLS = ['file:', 'blob:', 'data:', 'about:', 'javascript:'];
const WEB_PROTOCOLS = ['http:', 'https:'];

// 'web' (show it as a QR code), 'blocked' (disable it) or 'local' (not external: let it be).
const classify = (url, win) => {
    let parsed;
    try {
        parsed = new URL(String(url), win.location.href);
    } catch (error) {
        return 'local';
    }
    if (LOCAL_PROTOCOLS.indexOf(parsed.protocol) !== -1) {
        return 'local';
    }
    if (WEB_PROTOCOLS.indexOf(parsed.protocol) !== -1) {
        // The packaged app runs from file://: any web URL leaves it. Served from the web (the
        // desktop build, tests), a URL of the same origin is the app's own.
        return parsed.origin === win.location.origin ? 'local' : 'web';
    }
    return 'blocked';
};

// The link to show: the absolute form of what was asked for.
const absoluteUrl = (url, win) => new URL(String(url), win.location.href).href;

const createStore = () => {
    const listeners = [];
    let state = { url: null };
    const setState = (next) => {
        state = next;
        listeners.slice().forEach((listener) => listener(state));
    };
    return {
        getState: () => state,
        open: (url) => setState({ url }),
        close: () => {
            if (state.url !== null) {
                setState({ url: null });
            }
        },
        subscribe: (listener) => {
            listeners.push(listener);
            return () => {
                const index = listeners.indexOf(listener);
                if (index !== -1) {
                    listeners.splice(index, 1);
                }
            };
        },
    };
};

const findAnchor = (target) => {
    for (let node = target; node && node.nodeType === 1; node = node.parentNode) {
        if (node.tagName === 'A' && node.hasAttribute('href')) {
            return node;
        }
    }
    return null;
};

// `click` in the bubble phase on window: the React handlers of the link ran before (a handler that
// dealt with the click by itself calls preventDefault, and then it is not ours), and the default
// action, the navigation, is still ahead of us. The Back/Enter keys of a focused link end here too:
// Button turns Enter into a click.
const install = (win, store) => {
    const originalOpen = win.open;

    const onClick = (event) => {
        if (event.defaultPrevented) {
            return;
        }
        const anchor = findAnchor(event.target);
        if (anchor === null) {
            return;
        }
        const kind = classify(anchor.href, win);
        if (kind === 'local') {
            return;
        }
        event.preventDefault();
        if (kind === 'web') {
            store.open(absoluteUrl(anchor.href, win));
        }
    };

    win.open = function open(url) {
        if (typeof url === 'string' && url.length > 0) {
            const kind = classify(url, win);
            if (kind === 'web') {
                store.open(absoluteUrl(url, win));
                return null;
            }
            if (kind === 'blocked') {
                return null;
            }
        }
        return typeof originalOpen === 'function' ? originalOpen.apply(win, arguments) : null;
    };

    win.addEventListener('click', onClick);
    return () => {
        win.removeEventListener('click', onClick);
        win.open = originalOpen;
    };
};

module.exports = {
    classify,
    absoluteUrl,
    createStore,
    install,
};
