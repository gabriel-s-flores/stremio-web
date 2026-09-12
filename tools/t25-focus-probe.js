(async function () {
    'use strict';
    var mode = window.__t25FocusExpectedBuild;
    var failures = [];
    var samples = [];
    var skipped = [];
    var original = document.activeElement;
    var selector = 'a[href],button,input,textarea,select,[tabindex]';
    var wait = function () { return new Promise(function (resolve) { setTimeout(resolve, 140); }); };
    function label(node) {
        return node.tagName.toLowerCase() + '.' + String(node.className).trim().replace(/\s+/g, '.');
    }
    function visible(node) {
        if (!node || node.closest('[data-focus-guard]')) return false;
        var rect = node.getBoundingClientRect();
        var style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (rect.width === 0 || rect.height === 0) return false;
        for (var p = node.parentElement; p; p = p.parentElement) {
            var ps = getComputedStyle(p);
            if (ps.display === 'none' || ps.visibility === 'hidden' || ps.opacity === '0') return false;
        }
        return true;
    }
    function delegated(node) {
        if (node.matches('input[type="checkbox"],input[type="radio"]')) return node.parentElement;
        var search = node.closest('label[class*="search-bar-container-"]');
        if (search && search.querySelectorAll(selector).length === 1) return search;
        if (String(node.className).indexOf('meta-item-link-') !== -1) return node.querySelector('[class*="poster-container-"]');
        if (node.matches('a') && node.parentElement && node.parentElement.closest('[class*="warning-container-"]')) {
            return node.querySelector('[tabindex]') || node;
        }
        return node;
    }
    function geometry(node) {
        var r = node.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    }
    function ring(node) {
        var s = getComputedStyle(node);
        return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, offset: s.outlineOffset };
    }
    function hasRing(node) {
        var s = ring(node);
        return s.style !== 'none' && s.style !== 'hidden' && parseFloat(s.width) > 0;
    }
    // A modal/popup must be measured in isolation from its background route.
    var root = document.querySelector('[data-t25-probe-root]') || document.body;
    var nodes = Array.from(root.querySelectorAll(selector)).filter(function (node) {
        var secondary = String(node.className).indexOf('menu-label-container-') !== -1 && visible(node.parentElement);
        return !node.disabled && !node.closest('[data-focus-guard]') && (visible(delegated(node)) || secondary);
    });
    async function inspect(node, index) {
        var surface = delegated(node);
        // Center the control to isolate CSS from the 68 engine's nearest-edge
        // scroll rounding (which can leave 1-3px outside the viewport; Fase 4).
        node.scrollIntoView({ block: 'center', inline: 'nearest' });
        node.blur();
        await wait();
        var before = geometry(node);
        node.focus({ preventScroll: true });
        var immediateRing = ring(surface);
        await wait();
        var after = geometry(node);
        var focused = document.activeElement === node;
        var indicator = ring(surface);
        var errors = [];
        if (!focused) errors.push('focus() did not reach the control');
        if (mode === 'webos' && focused) {
            if (!visible(surface)) errors.push('Focused surface is invisible');
            if (indicator.style !== 'solid' || indicator.width !== '4px' || indicator.color !== 'rgb(255, 255, 255)' || indicator.offset !== '-4px') errors.push('Missing TV ring');
            if (immediateRing.width !== '4px' || immediateRing.offset !== '-4px') errors.push('TV ring is delayed by a transition');
            if (surface !== node && hasRing(node)) errors.push('Duplicate ring on delegated control');
            if (Math.abs(before.width - after.width) > 0.5 || Math.abs(before.height - after.height) > 0.5) errors.push('Focus resized the control');
        }
        var rect = geometry(surface);
        var clipping = [];
        if (rect.x < -1 || rect.y < -1 || rect.x + rect.width > innerWidth + 1 || rect.y + rect.height > innerHeight + 1) clipping.push('viewport');
        var escapesStatic = /absolute|fixed/.test(getComputedStyle(surface).position);
        for (var p = surface.parentElement; p && p !== document.body; p = p.parentElement) {
            var ps = getComputedStyle(p), pr = p.getBoundingClientRect();
            // Out-of-flow descendants escape overflow on static ancestors between
            // them and their containing block (e.g. the router's modal portal).
            if (escapesStatic && ps.position === 'static' && ps.transform === 'none' && ps.filter === 'none') continue;
            if (/hidden|auto|scroll/.test(ps.overflowX) && (rect.x < pr.left - 1 || rect.x + rect.width > pr.right + 1)) clipping.push(label(p) + ':x');
            if (/hidden|auto|scroll/.test(ps.overflowY) && (rect.y < pr.top - 1 || rect.y + rect.height > pr.bottom + 1)) clipping.push(label(p) + ':y');
            escapesStatic = /absolute|fixed/.test(ps.position);
        }
        if (mode === 'webos' && focused && clipping.length) errors.push('Focus ring is clipped');
        var item = { index: index, control: label(node), surface: label(surface), text: (node.textContent || node.getAttribute('title') || node.type || '').trim().slice(0, 90),
            fixtureCase: (node.closest('[data-focus-case]') || {}).dataset && node.closest('[data-focus-case]').dataset.focusCase,
            focused: focused, immediateRing: immediateRing, ring: indicator, before: before, after: after, surfaceGeometry: rect, clipping: clipping, failures: errors };
        node.blur();
        await wait();
        item.ringAfterBlur = ring(surface);
        if (mode === 'webos' && focused && hasRing(surface) && item.ringAfterBlur.width === '4px' && item.ringAfterBlur.color === 'rgb(255, 255, 255)') errors.push('TV ring remains after blur');
        return item;
    }
    for (var i = 0; i < nodes.length; i++) {
        if (!document.contains(nodes[i])) {
            skipped.push({ index: i, control: label(nodes[i]), reason: 'Unmounted during dynamic route update' });
            continue;
        }
        var sample = await inspect(nodes[i], i);
        if (!document.contains(nodes[i])) {
            skipped.push({ index: i, control: label(nodes[i]), reason: 'Unmounted while measuring focus' });
            continue;
        }
        samples.push(sample);
        if (sample.failures.length) failures.push({ index: i, control: sample.control, errors: sample.failures });
    }
    if (!mode || !['webos', 'desktop'].includes(mode)) failures.push('Expected build must be provided');
    if (innerWidth !== 1920 || innerHeight !== 1080) failures.push('Viewport must be 1920x1080');
    if (mode === 'webos' && !/Chrome\/68\./.test(navigator.userAgent)) failures.push('webOS acceptance requires Chromium 68');
    if (!samples.length) failures.push('No visible controls found');
    if (original && document.contains(original)) original.focus();
    window.__t25FocusProbe = {
        active: function () {
            var node = document.activeElement;
            var surface = delegated(node);
            return { control: label(node), surface: label(surface), text: (node.textContent || node.type || '').trim().slice(0, 90), ring: ring(surface) };
        },
        select: function (index) {
            if (!nodes[index] || !document.contains(nodes[index])) return null;
            nodes[index].scrollIntoView({ block: 'center', inline: 'nearest' });
            nodes[index].focus();
            return label(nodes[index]);
        },
        cleanup: function () { if (original && document.contains(original)) original.focus(); delete window.__t25FocusProbe; }
    };
    return { mode: mode, scrollAlignment: 'center', url: location.href, userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, samples: samples, skipped: skipped, failures: failures };
}());
