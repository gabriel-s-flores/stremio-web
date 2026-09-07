(async function () {
    'use strict';
    var previous = window.__t22BackdropProbe;
    if (previous) previous.cleanup();
    var originalFocus = document.activeElement;
    var rules = [];
    var inaccessible = [];
    function walk(list, conditions) {
        Array.from(list).forEach(function (rule) {
            if (rule.selectorText && rule.style) rules.push({ selector: rule.selectorText, css: rule.style.cssText, conditions: conditions, style: rule.style });
            if (rule.cssRules) walk(rule.cssRules, conditions.concat(rule.conditionText || ''));
        });
    }
    Array.from(document.styleSheets).forEach(function (sheet) {
        try { walk(sheet.cssRules, []); } catch (error) { inaccessible.push(sheet.href || 'inline'); }
    });
    var definitions = [
        ['EventModal + Modal', 'event-modal-'], ['Control group', 'group-container-'],
        ['ActionButton', 'action-button-container-'], ['MetaLinks', 'link-container-'],
        ['Toast', 'toast-item-container-'], ['Streams / Videos', 'streams-list-'],
        ['SideDrawer', 'side-drawer-'], ['Player menu', 'menu-layer-']
    ];
    var enhanced = definitions.map(function (definition) {
        var found = rules.find(function (rule) {
            return rule.selector.indexOf('.' + definition[1]) !== -1 && rule.conditions.some(function (condition) { return condition.indexOf('backdrop-filter:') !== -1; }) && rule.selector.indexOf(':') === -1;
        });
        if (!found) throw new Error('Missing CSSOM surface: ' + definition[0]);
        return found;
    });
    var modalRule = rules.find(function (rule) { return /^\.modal-container-[\w-]+$/.test(rule.selector) && rule.style.backgroundColor && rule.style.display === 'flex'; });
    if (!modalRule) throw new Error('Missing base Modal class');
    var root = document.createElement('section');
    root.id = 't22-backdrop-fixture';
    root.style.cssText = 'position:fixed;left:16px;right:16px;top:16px;bottom:16px;z-index:2147483647;overflow:auto;display:block;padding:16px;background:#222638;color:white;font:14px monospace;';
    var heading = document.createElement('h2');
    heading.textContent = 'T2.2 | CSS fixtures, NOT React components | native backdrop support: ' + CSS.supports('backdrop-filter', 'blur(1px)');
    root.appendChild(heading);
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-gap:18px;';
    root.appendChild(grid);
    document.body.appendChild(root);
    var samples = [];
    function layout(element) {
        // Geometry only: tested backgrounds, filters, borders and transitions stay in compiled CSS.
        element.style.cssText = 'position:relative;left:auto;right:auto;top:auto;bottom:auto;width:100%;height:74px;min-width:0;min-height:0;max-width:none;max-height:none;margin:0;flex:0 0 auto;';
    }
    enhanced.forEach(function (rule, index) {
        rule.selector.split(',').forEach(function (selector) {
            selector = selector.trim();
            var card = document.createElement('article');
            card.style.cssText = 'position:relative;min-width:0;padding:12px;background:repeating-linear-gradient(120deg,#414969 0px,#414969 16px,#282e49 16px,#282e49 32px);';
            var title = document.createElement('div');
            title.textContent = definitions[index][0] + (selector.indexOf('.videos-list-') !== -1 ? ' (videos)' : '');
            card.appendChild(title);
            var parent = card;
            selector.split(/\s+/).forEach(function (part) {
                if (!/^(\.[\w-]+)+$/.test(part)) throw new Error('Unsupported fixture selector: ' + selector);
                var node = document.createElement('div');
                node.className = part.split('.').filter(Boolean).join(' ');
                layout(node);
                if (parent !== card) parent.style.padding = '0';
                parent.appendChild(node);
                parent = node;
            });
            if (index === 0) parent.classList.add(modalRule.selector.slice(1));
            parent.textContent = 'Compiled CSS surface';
            parent.tabIndex = 0;
            var details = document.createElement('pre');
            details.style.cssText = 'position:relative;white-space:pre-wrap;margin:8px 0 0;font:12px monospace;';
            card.appendChild(details);
            grid.appendChild(card);
            samples.push({ name: title.textContent, selector: selector, node: parent, details: details, rule: rule, index: index });
        });
    });
    function computed(node) {
        var style = getComputedStyle(node);
        return { background: style.backgroundColor, backdrop: style.getPropertyValue('backdrop-filter') || '(unsupported)', outline: style.outline, border: style.borderTop, transition: style.transition, focused: document.activeElement === node, hovered: node.matches(':hover') };
    }
    function settle(node) {
        var style = getComputedStyle(node);
        function times(value) { return value.split(',').map(function (part) { return parseFloat(part) * (/ms/.test(part) ? 1 : 1000); }); }
        var duration = times(style.transitionDuration);
        var delay = times(style.transitionDelay);
        var wait = Math.max.apply(null, duration.map(function (time, index) { return time + delay[index % delay.length]; }).concat([0])) + 120;
        return new Promise(function (resolve) { setTimeout(function () { resolve(wait); }, wait); });
    }
    var report = { url: location.href, userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], support: CSS.supports('backdrop-filter', 'blur(1px)'), prefixedSupport: CSS.supports('-webkit-backdrop-filter', 'blur(1px)'), inaccessibleSheets: inaccessible, surfaceRules: enhanced.length, fixtureCount: samples.length, kind: 'Native CSS fixture; not React integration; no forced supports simulation', results: [] };
    window.__t22BackdropProbe = { root: root, report: report, cleanup: function () { root.remove(); if (originalFocus && document.contains(originalFocus)) originalFocus.focus(); delete window.__t22BackdropProbe; } };
    for (var sample of samples) {
        await settle(sample.node);
        var result = { name: sample.name, selector: sample.selector, classes: sample.node.className, matches: sample.node.matches(sample.selector), baseRules: rules.filter(function (rule) { return rule.selector === sample.rule.selector && !rule.conditions.length; }).map(function (rule) { return rule.css; }), supportsRules: rules.filter(function (rule) { return rule.selector === sample.rule.selector && rule.conditions.length; }).map(function (rule) { return { conditions: rule.conditions, css: rule.css }; }), normal: computed(sample.node) };
        if (sample.index === 2 || sample.index === 3) {
            sample.node.focus();
            result.focusWaitMs = await settle(sample.node);
            result.focus = computed(sample.node);
            sample.node.blur();
            await settle(sample.node);
            result.afterBlur = computed(sample.node);
        }
        sample.details.textContent = 'normal: ' + result.normal.background + '\nfilter: ' + result.normal.backdrop + (result.focus ? '\nfocus: ' + result.focus.background + '\noutline: ' + result.focus.outline + '\nborder: ' + result.focus.border + '\nsettled: ' + result.focusWaitMs + 'ms' : '') + '\nselector matched: ' + result.matches;
        report.results.push(result);
    }
    if (originalFocus && document.contains(originalFocus)) originalFocus.focus();
    return report;
}());
