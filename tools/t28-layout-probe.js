// Paste in the target console or run with t28-layout-runner.mjs. No product API.
// ES2018 syntax for the actual Chromium 68 runtime.
(async function () {
    var wait = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    var style = getComputedStyle(document.documentElement);
    var inset = {};
    ['top', 'right', 'bottom', 'left'].forEach(function (side) {
        inset[side] = parseFloat(style.getPropertyValue('--safe-area-inset-' + side));
    });
    var safe = { left: inset.left, top: inset.top, right: 1920 - inset.right, bottom: 1080 - inset.bottom };
    function rect(el) { var r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }
    function visible(el) {
        var r = rect(el);
        if (!r.width || !r.height) return false;
        for (var p = el; p; p = p.parentElement) {
            var s = getComputedStyle(p);
            if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
        }
        return true;
    }
    function inside(r, frame) { return r.left >= frame.left - 1 && r.top >= frame.top - 1 && r.right <= frame.right + 1 && r.bottom <= frame.bottom + 1; }
    function surface(el) {
        if (el.matches('input[type="checkbox"],input[type="radio"]')) return el.parentElement;
        if (String(el.className).indexOf('meta-item-link-') !== -1) return el.querySelector('[class*="poster-container-"]') || el;
        var search = el.closest('label[class*="search-bar-container-"]');
        if (search) return search;
        if (el.matches('a') && el.closest('[class*="warning-container-"]')) return el.querySelector('[tabindex]') || el;
        return el;
    }
    function clipping(el) {
        var r = rect(el), result = [];
        for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
            var s = getComputedStyle(p), pr = rect(p);
            if ((/hidden|auto|scroll|clip/.test(s.overflowX) && (r.left < pr.left - 1 || r.right > pr.right + 1)) ||
                (/hidden|auto|scroll|clip/.test(s.overflowY) && (r.top < pr.top - 1 || r.bottom > pr.bottom + 1))) {
                result.push({ ancestor: p.className, rect: pr });
            }
        }
        return result;
    }
    var old = document.getElementById('t28-safe-frame');
    if (old) old.remove();
    var overlay = document.createElement('div'); overlay.id = 't28-safe-frame';
    overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px dashed #00ffad;box-sizing:border-box;left:' + inset.left + 'px;top:' + inset.top + 'px;right:' + inset.right + 'px;bottom:' + inset.bottom + 'px';
    document.body.appendChild(overlay);
    var controls = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(function (el) {
        return !el.disabled && !el.closest('[data-focus-guard]') && (visible(surface(el)) ||
            (String(el.className).indexOf('menu-label-container-') !== -1 && visible(el.parentElement)));
    });
    var samples = [], original = document.activeElement;
    for (var el of controls) {
        el.focus(); await wait(90);
        if (document.activeElement !== el) continue;
        // Smooth native scroll may still be running at the first sample.
        await wait(180);
        var r = rect(el), target = surface(el), s = getComputedStyle(target);
        samples.push({ tag: el.tagName, classes: el.className, text: (el.innerText || el.placeholder || el.getAttribute('aria-label') || '').slice(0, 160),
            rect: r, insideSafeFrame: inside(r, safe), clipping: clipping(el), fontSize: parseFloat(getComputedStyle(el).fontSize), focusSurface: target.className,
            focus: { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, boxShadow: s.boxShadow } });
    }
    if (original && original.focus) original.focus();
    // Inventory only direct text nodes; containers do not inherit typography through the universal reset.
    var typography = Array.from(document.body.querySelectorAll('*')).filter(function (el) {
        return visible(el) && Array.from(el.childNodes).some(function (n) { return n.nodeType === 3 && n.textContent.trim(); });
    }).map(function (el) {
        var s = getComputedStyle(el);
        var ancestors = [], p = el.parentElement;
        for (var i = 0; p && i < 5; i++, p = p.parentElement) ancestors.push(p.className);
        return { classes: el.className, ancestors: ancestors, text: el.textContent.trim().slice(0, 120), fontSize: parseFloat(s.fontSize), lineHeight: s.lineHeight, rect: rect(el) };
    });
    var report = { url: location.href, userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight,
        visualWidth: window.visualViewport ? visualViewport.width : null, visualHeight: window.visualViewport ? visualViewport.height : null,
        scale: window.visualViewport ? visualViewport.scale : null, devicePixelRatio: devicePixelRatio, root: rect(document.documentElement) },
        insets: inset, safeFrame: safe, documentOverflowX: document.documentElement.scrollWidth > innerWidth,
        samples: samples, typography: typography, failures: [] };
    if (innerWidth !== 1920 || innerHeight !== 1080) report.failures.push('viewport');
    if (!window.visualViewport || visualViewport.scale !== 1) report.failures.push('scale unverified or not 1');
    if (report.documentOverflowX) report.failures.push('document overflow');
    if (!samples.length) report.failures.push('no focusable controls measured');
    samples.forEach(function (s, i) {
        if (!s.insideSafeFrame || s.clipping.length) report.failures.push('control geometry ' + i);
        if (s.focus.outlineStyle === 'none' && s.focus.boxShadow === 'none') report.failures.push('focus requires visual review ' + i);
    });
    return report;
})()
