// In-page helpers of the end-to-end run (webos/tests/e2e/run.mjs, F6.4). Evaluated through cdp.mjs
// in the packaged app, next to webos/tests/streams/page.js (__f62: the streams list, the addon
// install), webos/tests/player/page.js (__f51: console, Luna calls) and
// webos/tests/navigation/metadetails/page.js (__f41c: focus on the details page). ES5 only
// (Chromium 53). Observation only: the run drives the app with the remote. Everything lands on
// window.__e2e.
/* eslint-disable @stylistic/semi -- an expression for cdp.mjs eval, which wraps it */

(function() {
    if (window.__e2e) return 'already installed';
    var state = { installedAt: Date.now() };
    window.__e2e = state;

    var round = function(value) { return Math.round(value); };
    var text = function(element) { return element ? element.textContent.replace(/\s+/g, ' ').trim() : null; };
    var selected = function(element) { return /(^| )selected( |$)/.test(String(element.className)); };
    var zoom = function() { return parseFloat(getComputedStyle(document.documentElement).zoom) || 1; };
    var box = function(element) {
        var rect = element.getBoundingClientRect();
        return [round(rect.left), round(rect.top), round(rect.width), round(rect.height)];
    };

    // The focused element anywhere (the Board, the Player, menus).
    state.active = function() {
        var active = document.activeElement;
        if (!active || active === document.body) return JSON.stringify({ hash: location.hash, kind: 'body' });
        var row = active.closest('[class*="meta-row-container"]');
        var header = row && row.querySelector('[class*="header-container"], [class*="title-container"]');
        return JSON.stringify({
            hash: location.hash,
            tag: active.tagName,
            cls: String(active.className).replace(/-[A-Za-z0-9_-]{5}\b/g, '').slice(0, 80),
            text: (active.getAttribute('title') || active.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
            href: active.getAttribute('href'),
            row: header ? text(header).slice(0, 60) : null,
            focusVisible: active.hasAttribute('data-focus-visible-added'),
            inPlayer: !!active.closest('[class*="player-container"]'),
            inMenu: !!active.closest('[class*="audio-menu"], [class*="subtitles-menu"], [class*="menu-layer"]'),
        });
    };

    // The Player as shown: the video element, its tracks, the menus, the add-on subtitles overlay
    // (the centered div of withHTMLSubtitles next to the <video>) and the error layer (F6.3).
    state.player = function() {
        var video = document.querySelector('video');
        var tracks = [];
        var list = video && video.audioTracks;
        for (var i = 0; list && i < list.length; i++) tracks.push({ language: list[i].language, label: list[i].label, enabled: list[i].enabled });
        var overlay = null;
        if (video && video.parentElement) {
            Array.prototype.forEach.call(video.parentElement.children, function(child) {
                if (child.tagName === 'DIV' && child.style.textAlign === 'center') overlay = child;
            });
        }
        var audioMenu = document.querySelector('[class*="audio-menu"]');
        var subtitlesMenu = document.querySelector('[class*="subtitles-menu-container"]');
        var layer = document.querySelector('[class*="error-layer"]');
        var bar = document.querySelector('[class*="control-bar-container"]');
        return JSON.stringify({
            t: Date.now(),
            hash: location.hash.slice(0, 40),
            video: video ? {
                currentTime: video.currentTime, duration: video.duration, paused: video.paused, ended: video.ended,
                readyState: video.readyState, error: video.error ? video.error.code : null, mediaId: video.mediaId || null,
                src: String(video.currentSrc || video.src || '').replace(/^https?:\/\/[^/]+/, ''),
            } : null,
            audioTracks: tracks,
            audioMenu: audioMenu ? Array.prototype.map.call(audioMenu.querySelectorAll('[data-id]'), function(b) {
                return { id: b.getAttribute('data-id'), text: text(b), selected: selected(b), focused: b === document.activeElement };
            }) : null,
            subtitlesMenu: subtitlesMenu ? {
                languages: Array.prototype.map.call(subtitlesMenu.querySelectorAll('[class*="language-option"]'), function(b) {
                    return { lang: b.getAttribute('data-lang'), title: b.getAttribute('title'), selected: selected(b), focused: b === document.activeElement };
                }),
                variants: Array.prototype.map.call(subtitlesMenu.querySelectorAll('[class*="variant-option"]'), function(b) {
                    return { title: b.getAttribute('title'), origin: text(b.querySelector('[class*="variant-origin"]')), selected: selected(b), focused: b === document.activeElement };
                }),
            } : null,
            overlay: overlay ? { text: overlay.textContent, display: overlay.style.display } : null,
            errorLayer: layer ? {
                label: text(layer.querySelector('[class*="error-label"]')),
                hint: text(layer.querySelector('[class*="error-sub"]')),
                kind: layer.getAttribute('data-link-problem'),
            } : null,
            controlBar: bar ? { shown: !/(^| )hidden/.test(String(bar.parentElement && bar.parentElement.className)) && getComputedStyle(bar).opacity !== '0' } : null,
        });
    };

    // The control bar button whose icon path is `d` (the icons have no name in the DOM).
    var buttonOf = function(d) {
        var path = Array.prototype.filter.call(document.querySelectorAll('[class*="control-bar-container"] svg path'), function(p) { return p.getAttribute('d') === d; })[0];
        return path ? path.closest('[class*="control-bar-button"]') : null;
    };
    state.showControls = function() {
        var container = document.querySelector('[class*="player-container"]');
        if (container) container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 960, clientY: 900 }));
        return !!container;
    };
    // Fallback of the run when the remote cannot reach a Player control (recorded as such). Only a
    // click on the button: a mouse move would turn the Magic Remote pointer mode on (F4.2), which
    // changes how the focus comes back later.
    state.clickControl = function(d) {
        var button = buttonOf(d);
        if (button) button.click();
        return !!button;
    };
    state.clickSelector = function(selector) {
        var element = document.querySelector(selector);
        if (element) element.click();
        return !!element;
    };
    state.clickVariant = function(pattern) {
        var option = Array.prototype.filter.call(document.querySelectorAll('[class*="subtitles-menu-container"] [class*="variant-option"]'), function(o) {
            return new RegExp(pattern).test(text(o.querySelector('[class*="variant-origin"]')) || '');
        })[0];
        if (option) option.click();
        return option ? option.getAttribute('title') : null;
    };

    // Boxes and font sizes of what is on screen, for the check of the streams list and the track
    // menus at the TV scale (F2.6). Screen pixels whatever the engine does with zoom in
    // getBoundingClientRect (as webos/tests/screens/page.js): the html box is the whole screen, so its
    // rect width tells the factor; the font size times the html zoom.
    state.layout = function(selector) {
        var factor = window.innerWidth / document.documentElement.getBoundingClientRect().width;
        var fontFactor = zoom();
        return JSON.stringify(Array.prototype.map.call(document.querySelectorAll(selector), function(element) {
            var rect = element.getBoundingClientRect();
            var style = getComputedStyle(element);
            var screen = [rect.left, rect.top, rect.width, rect.height].map(function(v) { return round(v * factor); });
            return {
                cls: String(element.className).replace(/-[A-Za-z0-9_-]{5}\b/g, '').slice(0, 60),
                box: screen,
                inScreen: screen[0] >= 0 && screen[1] >= 0 && screen[0] + screen[2] <= 1920 + 1 && screen[1] + screen[3] <= 1080 + 1,
                fontPx: round(parseFloat(style.fontSize) * fontFactor * 10) / 10,
                text: text(element).slice(0, 60),
                clipped: element.scrollWidth > element.clientWidth + 1 && style.overflow !== 'visible',
            };
        }));
    };

    state.memory = function() {
        return JSON.stringify(window.performance && performance.memory ? { usedMB: round(performance.memory.usedJSHeapSize / 1048576), totalMB: round(performance.memory.totalJSHeapSize / 1048576) } : null);
    };
    state.box = function(selector) {
        var element = document.querySelector(selector);
        return element ? JSON.stringify(box(element)) : 'null';
    };
    return 'installed';
})()
