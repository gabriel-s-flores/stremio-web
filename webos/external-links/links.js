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
// and is disabled: the click is cancelled and nothing happens. So are links to the TV itself
// (127.0.0.1, localhost…, such as the tlsproxy URL with its token), also behind the stremio.com/warning
// page: a QR code of them would not open on the phone, and the URL is never shown, stored or logged. Links inside the app (`#/…`, `file:`)
// and local blobs and data URLs are left alone.
//
// Nothing here runs at boot but two listeners; the QR code is only built when a link is opened.

// What the app itself uses: hash routes, the packaged page and local URLs.
const LOCAL_PROTOCOLS = ['file:', 'blob:', 'data:', 'about:', 'javascript:'];
const WEB_PROTOCOLS = ['http:', 'https:'];

// Loopback addresses: the TV itself. The tlsproxy of the app (F3.7, http://127.0.0.1:<port>/proxy?t=<token>…)
// and anything else listening there mean nothing to a phone, and the proxy URL carries its token.
const isLoopbackHost = (hostname) => (
    /^127\.\d+\.\d+\.\d+$/.test(hostname) ||
    hostname === '0.0.0.0' ||
    hostname === 'localhost' ||
    /\.localhost$/.test(hostname) ||
    hostname === '[::1]' ||
    hostname === '[::]'
);

// The upstream Platform.openExternal sends hosts outside its list through stremio.com/warning#<url>.
const WARNING_PATH = '/warning';

// 'web' (show it as a QR code), 'blocked' (disable it) or 'local' (not external: let it be).
const classify = (url, win, depth = 0) => {
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
        // Served from the web (the desktop build, tests), a URL of the page's own origin is the app's own.
        if (parsed.origin === win.location.origin) {
            return 'local';
        }
        if (isLoopbackHost(parsed.hostname)) {
            return 'blocked';
        }
        // The link behind the warning page counts too: it is what the phone ends up opening.
        if (depth === 0 && parsed.pathname === WARNING_PATH && parsed.hash.length > 1) {
            let inner = null;
            try {
                // Absolute only: a relative text after the # is not a link.
                inner = new URL(decodeURIComponent(parsed.hash.slice(1))).href;
            } catch (error) {
                inner = null;
            }
            if (inner !== null && classify(inner, win, depth + 1) === 'blocked') {
                return 'blocked';
            }
        }
        // The packaged app runs from file://: any web URL leaves it.
        return 'web';
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
// action, the navigation, is still ahead of us. Download links are also caught in the capture phase
// (see onCaptureClick); whichever comes first handles the click and the other sees it prevented. The Back/Enter keys of a focused link end here too:
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
        handle(event, anchor);
    };

    // The context menu of the upstream (the "Download subtitle" of the Player's subtitles menu)
    // stops the propagation of the clicks inside it, so they never reach `window` in the bubble
    // phase. A download link has no handler of its own to wait for: it is caught on the way down.
    // On `document`, not `window`: the capture listener of the long press of the Magic Remote
    // (F4.3, webos/lib/navigation/contextMenu.js) is on `window` and runs first, and its
    // stopImmediatePropagation on the release that follows a long press also stops this one.
    const onCaptureClick = (event) => {
        if (event.defaultPrevented) {
            return;
        }
        const anchor = findAnchor(event.target);
        if (anchor !== null && anchor.hasAttribute('download')) {
            handle(event, anchor);
        }
    };

    const handle = (event, anchor) => {
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
    win.document.addEventListener('click', onCaptureClick, true);
    return () => {
        win.removeEventListener('click', onClick);
        win.document.removeEventListener('click', onCaptureClick, true);
        win.open = originalOpen;
    };
};

module.exports = {
    classify,
    absoluteUrl,
    createStore,
    install,
};
