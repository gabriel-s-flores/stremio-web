// In-page helpers for webos/tests/streams/emulator.sh (F6.2). Evaluated through cdp.mjs in the
// packaged app (and in the desktop build for the comparison); ES5 only (Chromium 53). Everything
// lands on window.__f62.
/* eslint-disable no-console, @stylistic/semi -- an expression for cdp.mjs eval, which wraps it */

(function() {
    if (window.__f62) return 'already installed';
    var state = { console: [], errors: [] };
    window.__f62 = state;

    var describe = function(value) {
        if (value instanceof Error) return String(value.stack || value);
        if (typeof value === 'object') {
            try { return JSON.stringify(value); } catch (_e) { return String(value); }
        }
        return String(value);
    };
    ['log', 'info', 'warn', 'error'].forEach(function(level) {
        var original = console[level];
        console[level] = function() {
            var args = Array.prototype.slice.call(arguments);
            state.console.push({ t: Date.now(), level: level, text: args.map(describe).join(' ').slice(0, 2000) });
            return original.apply(console, arguments);
        };
    });
    window.addEventListener('error', function(event) {
        state.errors.push({ t: Date.now(), message: String(event.message), source: String(event.filename) + ':' + event.lineno });
    });

    // Installs an addon in the guest profile, as the Addons screen does.
    state.install = function(manifestUrl) {
        state.installed = null;
        return fetch(manifestUrl).then(function(response) { return response.json(); }).then(function(manifest) {
            window.core.dispatch({
                action: 'Ctx',
                args: { action: 'InstallAddon', args: { transportUrl: manifestUrl, manifest: manifest, flags: { official: false, protected: false } } },
            });
            state.installed = manifest.id;
            return manifest.id;
        });
    };

    // Audio languages of the profile (the rules give +20 to a stream whose initial track has one).
    state.readSettings = function() {
        return window.core.getState('ctx').then(function(ctx) {
            var settings = ctx.profile.settings;
            state.settings = { audioLanguage: settings.audioLanguage, secondaryAudioLanguage: settings.secondaryAudioLanguage };
            return JSON.stringify(state.settings);
        });
    };

    // The streams list as shown: file name (1st line of the description), the C8 data and labels.
    state.list = function() {
        var items = document.querySelectorAll('[class*="streams-container"] [class*="stream-container"]');
        return Array.prototype.map.call(items, function(item) {
            var description = item.querySelector('[class*="description-container"]');
            var chips = item.querySelectorAll('[class*="c8-labels"] span');
            return {
                file: description ? description.textContent.split('\n')[0] : null,
                name: (item.querySelector('[class*="addon-name"]') || {}).textContent || null,
                tier: item.getAttribute('data-c8-tier'),
                score: item.getAttribute('data-c8-score'),
                source: item.getAttribute('data-c8-source'),
                labels: Array.prototype.map.call(chips, function(chip) { return chip.textContent; }),
                focused: item === document.activeElement,
            };
        });
    };

    // Focuses the item at `index` (the first one, before the remote keys take over).
    state.focus = function(index) {
        var items = document.querySelectorAll('[class*="streams-container"] [class*="stream-container"]');
        if (!items[index]) return false;
        items[index].focus();
        return document.activeElement === items[index];
    };

    // Timeline of the list (started by emulator.sh right after navigating to the streams).
    state.timeline = [];
    state.track = function(ms) {
        var started = Date.now();
        var last = '';
        var timer = setInterval(function() {
            var list = state.list();
            var key = JSON.stringify(list);
            if (key !== last) {
                last = key;
                state.timeline.push({ t: Date.now() - started, list: list });
            }
        }, 100);
        setTimeout(function() { clearInterval(timer); }, ms);
        return started;
    };
    return 'installed';
})()
