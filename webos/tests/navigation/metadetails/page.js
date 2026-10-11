// In-page helpers for webos/tests/navigation/metadetails/emulator.sh (F4.1c). Evaluated through
// cdp.mjs in the packaged app; ES5 only (Chromium 53). Observation only: the navigation itself is
// done with the remote (remote.mjs). Everything lands on window.__f41c.
/* eslint-disable no-console, @stylistic/semi -- an expression for cdp.mjs eval, which wraps it */

(function() {
    if (window.__f41c) return 'already installed';
    var state = { errors: [], notarget: [] };
    window.__f41c = state;

    window.addEventListener('error', function(event) {
        state.errors.push({ t: Date.now(), message: String(event.message), source: String(event.filename) + ':' + event.lineno });
    });
    var originalError = console.error;
    console.error = function() {
        state.errors.push({ t: Date.now(), message: Array.prototype.slice.call(arguments).map(String).join(' ').slice(0, 500) });
        return originalError.apply(console, arguments);
    };

    var visibleRoute = function() {
        var routes = document.querySelectorAll('.route-container');
        return routes[routes.length - 1] || document.body;
    };
    var page = function() {
        return visibleRoute().querySelector('[class*="metadetails-container"]');
    };
    var items = function() {
        var root = page();
        return root ? Array.prototype.slice.call(root.querySelectorAll('[class*="stream-container"], [class*="video-container"]')) : [];
    };
    var round = function(value) { return Math.round(value); };

    // The focused element: where it is, what it is and its index among the list items.
    state.focus = function() {
        var active = document.activeElement;
        var root = page();
        var result = { hash: location.hash, tag: active ? active.tagName : null };
        if (!active || active === document.body) {
            result.kind = 'body';
            return JSON.stringify(result);
        }
        var className = String(active.className);
        var rect = active.getBoundingClientRect();
        result.cls = className.replace(/-[A-Za-z0-9_-]{5}\b/g, '').slice(0, 80);
        result.text = (active.getAttribute('title') || active.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        result.rect = [round(rect.left), round(rect.top), round(rect.width), round(rect.height)];
        result.index = items().indexOf(active);
        result.section = !root || !root.contains(active) ? 'outside' :
            active.closest('[class*="streams-list"], [class*="videos-list"]') ? 'list' :
            active.closest('[class*="meta-preview"]') ? 'meta' : 'page';
        result.kind = /streams-list/.test(className) ? 'list-panel' :
            /stream-container/.test(className) ? 'stream' :
            /video-container/.test(className) ? 'episode' :
            /description-container/.test(className) ? 'summary' :
            /action-button-container/.test(className) ? 'action' :
            /icon-container/.test(className) ? 'toggle' :
            /link-container/.test(className) ? 'link' :
            /season-button/.test(className) ? 'season-button' :
            /back-button-container/.test(className) ? 'list-back' :
            active.tagName === 'INPUT' ? 'input' : 'other';
        result.focusVisible = active.hasAttribute('data-focus-visible-added');
        // Inside the visible part of its scroll container (the column or the list)?
        var scroller = active.parentElement;
        while (scroller && scroller !== document.body) {
            var style = getComputedStyle(scroller);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && scroller.scrollHeight > scroller.clientHeight + 1) break;
            scroller = scroller.parentElement;
        }
        if (scroller && scroller !== document.body) {
            var box = scroller.getBoundingClientRect();
            result.inView = rect.bottom > box.top + 1 && rect.top < box.bottom - 1;
            result.scrollTop = round(scroller.scrollTop);
        } else {
            result.inView = rect.bottom > 0 && rect.top < window.innerHeight;
        }
        return JSON.stringify(result);
    };

    // The list as shown: the first lines of each item (to compare the order before and after).
    state.order = function() {
        return JSON.stringify(items().map(function(item) {
            var description = item.querySelector('[class*="description-container"]');
            return (description ? description.textContent : item.textContent).split('\n')[0].trim().slice(0, 60);
        }));
    };

    state.counts = function() {
        var root = page();
        return JSON.stringify({
            items: items().length,
            placeholders: root ? root.querySelectorAll('[class*="placeholder"]').length : -1,
            metaReady: !!(root && root.querySelector('[class*="action-buttons-container"]')),
        });
    };

    // The library toggle (first ActionsGroup item): the icon name tells the state.
    state.libraryIcon = function() {
        var root = page();
        var toggle = root && root.querySelector('[class*="group-container"] > [class*="icon-container"]');
        var svg = toggle && toggle.querySelector('svg');
        return svg ? svg.innerHTML : 'none';
    };

    state.pointer = function() {
        return String(document.documentElement.getAttribute('data-webos-pointer'));
    };
    return 'installed';
})()
