// Injected only by the debug runner. ES2018, including on the native C68 target.
(function () {
    if (window.__t41) return true;
    var ids = new WeakMap(), elements = {}, next = 0, events = [], armed = false;
    var selector = 'button,a[href],input,select,textarea,[tabindex],[role="button"],[role="checkbox"],[role="radio"],[role="slider"],[role="menuitem"]';
    function id(el) {
        if (!el || el === document.body || el === document.documentElement) return null;
        if (!ids.has(el)) { ids.set(el, String(++next)); elements[next] = el; }
        return ids.get(el);
    }
    function rendered(el, styles) {
        if (!el || !el.isConnected || !el.getClientRects().length) return false;
        var rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        for (var p = el; p; p = p.parentElement) {
            var s = styles && styles.get(p);
            if (!s) { s = getComputedStyle(p); if (styles) styles.set(p, s); }
            if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0 || p.hidden) return false;
        }
        return true;
    }
    function interactive(el) {
        if (el.id === 'app' && el.parentElement === document.body) return false;
        // React 18 delegates clicks to the root, so DOM onclick alone misses custom controls.
        var key = Object.keys(el).find(function (k) { return /^__react(Props|EventHandlers)\$/.test(k); });
        return el.matches(selector) || !!el.onclick || !!(key && el[key] && el[key].onClick);
    }
    function disabled(el) { return el.matches(':disabled,[aria-disabled="true"],.disabled') || !!el.closest('[inert]'); }
    function path(el) {
        var parts = [];
        while (el && el !== document.body) {
            var index = Array.prototype.indexOf.call(el.parentElement.children, el) + 1;
            parts.unshift(el.tagName.toLowerCase() + ':nth-child(' + index + ')'); el = el.parentElement;
        }
        return 'body > ' + parts.join(' > ');
    }
    function scope() {
        var roots = Array.from(document.querySelectorAll('[data-focus-lock-disabled="false"],[role="menu"],[aria-modal="true"]')).filter(function (el) { return rendered(el); });
        return roots.reverse().find(function (el) { return el.contains(document.activeElement); }) || roots[0] || null;
    }
    function sample(el, knownRoot, styles) {
        var r = el.getBoundingClientRect();
        var root = knownRoot === undefined ? scope() : knownRoot;
        var rule = (window.__t41Rules || []).find(function (rule) { return el.matches(rule.selector); });
        var guard = el.hasAttribute('data-focus-guard');
        return { id: id(el), selector: path(el), tag: el.tagName, role: el.getAttribute('role'), tabIndex: el.tabIndex,
            classification: guard ? 'guard' : !rendered(el, styles) ? 'hidden' : disabled(el) ? 'disabled' : rule && rule.kind === 'structure' ? 'structure' : root && !root.contains(el) ? 'background' : 'control',
            enter: rule ? rule.kind : 'unclassified', reason: rule && rule.reason,
            visible: rendered(el, styles), inViewport: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
            roving: el.matches('[role="menuitem"][tabindex="-1"]'),
            rect: { x: r.left, y: r.top, width: r.width, height: r.height } };
    }
    function inventory() {
        var root = scope(), styles = new Map();
        return Array.from(document.querySelectorAll('*')).filter(interactive).map(function (el) { return sample(el, root, styles); });
    }
    function scrolls() {
        return Array.from(document.querySelectorAll('*')).filter(function (el) { return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth; })
            .map(function (el) { return { id: id(el), x: el.scrollLeft, y: el.scrollTop }; }).filter(function (s) { return s.id; });
    }
    function focusReport() {
        var el = document.activeElement;
        if (!id(el)) return { id: null, failures: ['focus-lost'] };
        var info = sample(el), failures = [], rings = [], root = scope();
        if (!info.visible || !info.inViewport) failures.push('invisible-focus');
        if (info.classification === 'disabled' || info.classification === 'guard') failures.push('invalid-focus');
        if (root && !root.contains(el)) failures.push('overlay-escape');
        var route = el.closest('.route-container');
        if (route && route !== document.querySelector('.routes-container > .route-container:last-child')) failures.push('previous-route-focus');
        // Include delegated :focus-within rings and poster rings.
        var candidates = [el].concat(Array.from(el.querySelectorAll('*')));
        for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) candidates.push(p);
        candidates.forEach(function (node) {
            var css = getComputedStyle(node);
            if (css.outlineStyle === 'none' || parseFloat(css.outlineWidth) === 0) return;
            var rect = node.getBoundingClientRect(), offset = Math.max(0, parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset));
            var clipped = rect.left - offset < 0 || rect.top - offset < 0 || rect.right + offset > innerWidth || rect.bottom + offset > innerHeight;
            var clippedBy = clipped ? ['viewport'] : [];
            var escapesStatic = /absolute|fixed/.test(css.position);
            for (var parent = node.parentElement; parent; parent = parent.parentElement) {
                var style = getComputedStyle(parent), box = parent.getBoundingClientRect();
                // Same containing-block rule as T2.5: modal portals escape static zero-size hosts.
                if (escapesStatic && style.position === 'static' && style.transform === 'none' && style.filter === 'none') continue;
                if (/(hidden|auto|scroll)/.test(style.overflowX) && (rect.left - offset < box.left - 1 || rect.right + offset > box.right + 1)) { clipped = true; clippedBy.push(path(parent)); }
                if (/(hidden|auto|scroll)/.test(style.overflowY) && (rect.top - offset < box.top - 1 || rect.bottom + offset > box.bottom + 1)) { clipped = true; clippedBy.push(path(parent)); }
                escapesStatic = /absolute|fixed/.test(style.position);
            }
            rings.push({ width: css.outlineWidth, color: css.outlineColor, clipped: clipped, clippedBy: clippedBy,
                rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } });
        });
        if (rings.length !== 1 || rings.some(function (r) { return r.width !== '4px' || r.color !== 'rgb(255, 255, 255)'; })) failures.push('focus-ring');
        if (rings.some(function (r) { return r.clipped; })) failures.push('clipped-ring');
        return { id: info.id, failures: failures, rings: rings };
    }
    ['click', 'submit', 'focusin'].forEach(function (type) {
        document.addEventListener(type, function (e) { if (armed) events.push({ type: type, id: id(e.target), visible: rendered(e.target), inScope: !scope() || scope().contains(e.target) }); }, true);
    });
    window.__t41 = {
        inventory: inventory, focusReport: focusReport,
        snapshot: function () {
            var active = document.activeElement;
            var selection = typeof active.selectionStart === 'number'
                ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null;
            return { focus: focusReport(), scrolls: scrolls(), inventory: inventory(), selection: selection };
        },
        seed: function () {
            var first = inventory().find(function (s) { return s.classification === 'control' && s.inViewport && (s.tabIndex >= 0 || s.roving); });
            if (!first) return false;
            elements[first.id].focus(); return id(document.activeElement) === first.id;
        },
        restore: function (state) {
            var el = elements[state.focus.id];
            if (!el || !rendered(el)) return false;
            el.focus();
            if (state.selection && typeof el.setSelectionRange === 'function') {
                el.setSelectionRange(state.selection.start, state.selection.end, state.selection.direction);
            }
            state.scrolls.forEach(function (s) { if (elements[s.id]) { elements[s.id].scrollLeft = s.x; elements[s.id].scrollTop = s.y; } });
            return document.activeElement === el;
        },
        arm: function () { events = []; armed = true; },
        disarm: function () { armed = false; return events; },
        matches: function (target, selector) { return !!elements[target] && elements[target].matches(selector); }
    };
    return true;
})()
