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
//
// `hostname` comes from `new URL`, which in Chromium 53 (measured on the emulator) already writes the
// numeric forms the canonical way: 2130706433, 0x7f000001, 0177.0.0.1, 127.1 → 127.0.0.1; 0 → 0.0.0.0;
// [0:0:0:0:0:0:0:1] → [::1]; [::ffff:127.0.0.1] → [::ffff:7f00:1]; user@127.0.0.1 → 127.0.0.1. What it
// leaves as written is a trailing dot (`localhost.`, `a.localhost.`) and the IPv6 forms that carry an IPv4
// address ([::ffff:7f00:1], [::7f00:1]). The parsing below does not rely on that canonical form (it reads
// the WHATWG numeric forms itself), so a platform that does not rewrite them is covered too. Only a host
// made entirely of numbers is read as an address: 127.example.com and 0x7f.example.com are public names.

// WHATWG "IPv4 number parser": decimal, 0x hex or 0 octal; null when it is not a number.
const parseIPv4Part = (part) => {
    let digits = part;
    let radix = 10;
    if (/^0x/i.test(digits)) {
        digits = digits.slice(2);
        radix = 16;
    } else if (digits.length > 1 && digits.charAt(0) === '0') {
        digits = digits.slice(1);
        radix = 8;
    }
    if (digits === '') {
        return radix === 16 ? 0 : null;
    }
    const valid = radix === 16 ? /^[0-9a-f]+$/i : radix === 8 ? /^[0-7]+$/ : /^[0-9]+$/;
    return valid.test(digits) ? parseInt(digits, radix) : null;
};

// The address (a number from 0 to 2^32 - 1) of a host written as 1 to 4 numbers, or null.
const parseIPv4 = (host) => {
    const parts = host.split('.');
    if (parts.length > 1 && parts[parts.length - 1] === '') {
        parts.pop();
    }
    if (parts.length > 4) {
        return null;
    }
    const numbers = parts.map(parseIPv4Part);
    if (numbers.some((number) => number === null)) {
        return null;
    }
    const last = numbers.pop();
    if (numbers.some((number) => number > 255) || last >= Math.pow(256, 5 - parts.length)) {
        return null;
    }
    return numbers.reduce((address, number, index) => address + number * Math.pow(256, 3 - index), last);
};

const isLoopbackIPv4 = (address) => address === 0 || Math.floor(address / 16777216) === 127;

// The eight 16-bit groups of an IPv6 address (without the brackets), or null.
const parseIPv6 = (text) => {
    let address = text.toLowerCase();
    const dotted = address.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) {
        const v4 = parseIPv4(dotted[2]);
        if (v4 === null) {
            return null;
        }
        address = dotted[1] + Math.floor(v4 / 65536).toString(16) + ':' + (v4 % 65536).toString(16);
    }
    const halves = address.split('::');
    if (halves.length > 2) {
        return null;
    }
    const groups = (half) => (half === '' ? [] : half.split(':'));
    const head = groups(halves[0]);
    const tail = halves.length === 2 ? groups(halves[1]) : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) {
        return null;
    }
    const all = head.concat(new Array(halves.length === 2 ? missing : 0).fill('0'), tail);
    const numbers = all.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
    return numbers.some(isNaN) ? null : numbers;
};

const isLoopbackIPv6 = (groups) => {
    const high = groups.slice(0, 6);
    const v4 = groups[6] * 65536 + groups[7];
    const zeros = (list) => list.every((group) => group === 0);
    if (zeros(groups) || (zeros(groups.slice(0, 7)) && groups[7] === 1)) {
        return true;
    }
    // ::ffff:127.0.0.1 (mapped) and ::127.0.0.1 (compatible): the IPv4 address inside.
    return (zeros(high.slice(0, 5)) && high[5] === 0xffff && isLoopbackIPv4(v4)) || (zeros(high) && isLoopbackIPv4(v4));
};

const isLoopbackHost = (hostname) => {
    const host = String(hostname).toLowerCase();
    if (host.charAt(0) === '[' && host.charAt(host.length - 1) === ']') {
        const groups = parseIPv6(host.slice(1, -1));
        return groups !== null && isLoopbackIPv6(groups);
    }
    // A trailing dot is the same name.
    const name = host.replace(/\.+$/, '');
    if (name === 'localhost' || /\.localhost$/.test(name)) {
        return true;
    }
    const address = parseIPv4(host);
    return address !== null && isLoopbackIPv4(address);
};

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
    isLoopbackHost,
    absoluteUrl,
    createStore,
    install,
};
