// In-page helpers of webos/tests/screens/run (F2.6), evaluated once through cdp.mjs in the app.
// ES5 only (Chromium 53), one expression without a final semicolon (cdp.mjs wraps it in parentheses).
// Everything lands on window.__screens:
//   errors                  uncaught errors and console.error calls since install
//   wait(selectors)         the first element matching one of the comma separated selector lists
//   focus(selectors)        focuses that element with the keyboard modality, as a remote key would
//                           (the focus-visible polyfill marks it; :focus-within follows)
//   click(selectors)        clicks it
//   probe()                 JSON with the viewport, the interface scale and the focused element: box in
//                           screen pixels and the focus styles of it and of the descendant that draws them

(function() {
    if (window.__screens) return 'already installed';

    var errors = [];
    window.addEventListener('error', function(event) {
        errors.push(String(event.message) + ' @ ' + String(event.filename) + ':' + event.lineno);
    });
    var consoleError = console.error;
    console.error = function() {
        errors.push(Array.prototype.map.call(arguments, String).join(' ').slice(0, 500));
        return consoleError.apply(console, arguments);
    };

    var visible = function(element) {
        var rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    var find = function(selectors) {
        var lists = String(selectors).split('||');
        for (var i = 0; i < lists.length; i++) {
            var found = Array.prototype.filter.call(document.querySelectorAll(lists[i]), visible);
            if (found.length > 0) return found[0];
        }
        return null;
    };
    var zoom = function() {
        return parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    };
    // Box in screen pixels whatever the engine does with zoom in getBoundingClientRect: the html box is
    // 100vw x 100vh of the screen, so its rect width tells the factor.
    var screenBox = function(element) {
        var rect = element.getBoundingClientRect();
        var factor = window.innerWidth / document.documentElement.getBoundingClientRect().width;
        return [rect.left, rect.top, rect.width, rect.height].map(function(value) {
            return Math.round(value * factor * 10) / 10;
        });
    };
    var focusStyles = function(element) {
        var style = getComputedStyle(element);
        return {
            className: String(element.className && element.className.baseVal !== undefined ? element.className.baseVal : element.className).slice(0, 120),
            outline: style.outlineStyle === 'none' ? 'none' : style.outlineWidth + ' ' + style.outlineStyle + ' ' + style.outlineColor + ' offset ' + style.outlineOffset,
            boxShadow: style.boxShadow,
            transform: style.transform,
            fontSize: style.fontSize,
        };
    };

    // Font sizes in screen pixels (font-size times the html zoom) of the visible elements with their own
    // text on screen: smallest, 10th percentile, median and how many are under 24px (LG's minimum
    // for a TV seen from 3 m: 18pt).
    var textSizes = function() {
        var sizes = [];
        var factor = zoom();
        Array.prototype.forEach.call(document.body.querySelectorAll('*'), function(element) {
            var own = Array.prototype.some.call(element.childNodes, function(node) {
                return node.nodeType === 3 && node.textContent.trim().length > 0;
            });
            if (!own) return;
            var box = screenBox(element);
            if (box[2] <= 0 || box[3] <= 0 || box[0] >= window.innerWidth || box[1] >= window.innerHeight || box[0] + box[2] <= 0 || box[1] + box[3] <= 0) return;
            var style = getComputedStyle(element);
            if (style.visibility === 'hidden' || style.opacity === '0') return;
            sizes.push(Math.round(parseFloat(style.fontSize) * factor * 10) / 10);
        });
        sizes.sort(function(a, b) { return a - b; });
        var at = function(ratio) { return sizes.length ? sizes[Math.floor((sizes.length - 1) * ratio)] : null; };
        return {
            count: sizes.length,
            min: at(0),
            p10: at(0.1),
            median: at(0.5),
            under24: sizes.filter(function(size) { return size < 24; }).length,
        };
    };

    window.__screens = {
        errors: errors,
        wait: function(selectors) {
            return !!find(selectors);
        },
        focus: function(selectors) {
            var element = find(selectors);
            if (!element) return null;
            // A key press first: the focus-visible polyfill (webOS) and the browser keep the keyboard modality.
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true }));
            if (element.tabIndex < 0 && !element.hasAttribute('tabindex')) {
                var focusable = element.querySelector('[tabindex], a[href], button, input');
                if (focusable) element = focusable;
            }
            // Already focused (a dialog focuses its first button): again, now with the keyboard modality.
            if (document.activeElement === element) element.blur();
            element.focus();
            return document.activeElement === element;
        },
        click: function(selectors) {
            var element = find(selectors);
            if (!element) return false;
            element.click();
            return true;
        },
        probe: function() {
            var active = document.activeElement;
            var result = {
                hash: location.hash.slice(0, 80),
                viewport: [window.innerWidth, window.innerHeight],
                zoom: zoom(),
                rootFontSize: getComputedStyle(document.documentElement).fontSize,
                safeArea: ['top', 'right', 'bottom', 'left'].map(function(side) {
                    return getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-' + side).trim();
                }),
                text: textSizes(),
                focused: null,
                errors: errors.slice(),
            };
            if (active && active !== document.body) {
                var styles = [focusStyles(active)];
                // MetaItem draws the ring on its poster: report the descendants with a box-shadow too.
                Array.prototype.forEach.call(active.querySelectorAll('*'), function(child) {
                    var shadow = getComputedStyle(child).boxShadow;
                    if (shadow && shadow !== 'none' && styles.length < 4) styles.push(focusStyles(child));
                });
                result.focused = {
                    tag: active.tagName,
                    focusVisible: active.hasAttribute('data-focus-visible-added'),
                    box: screenBox(active),
                    text: (active.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
                    styles: styles,
                };
            }
            return JSON.stringify(result);
        },
    };
    return 'installed';
})()
