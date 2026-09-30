(async function () {
    'use strict';
    // Run with cdp.mjs eval-file. CSS fixtures do not mount React components.
    if (window.__t24SafeAreasProbe) window.__t24SafeAreasProbe.cleanup();
    var mode = window.__t24SafeAreasExpectedBuild || (/Chrome\/68\./.test(navigator.userAgent) ? 'webos' : 'desktop');
    var rules = [];
    var sources = [];
    var failures = [];
    var inaccessible = [];
    var functionPattern = /\b(?:env|min|max|clamp)\s*\(/gi;
    function walk(list, conditions) {
        Array.from(list).forEach(function (rule) {
            if (rule.selectorText && rule.style) rules.push({ selector: rule.selectorText, style: rule.style, conditions: conditions });
            if (rule.cssRules) walk(rule.cssRules, conditions.concat(rule.conditionText || ''));
        });
    }
    // Inspect the response text too: Chrome 68 drops unsupported declarations from CSSOM.
    for (var sheet of Array.from(document.styleSheets)) {
        try {
            walk(sheet.cssRules, []);
            var css;
            if (sheet.href) {
                var response = await fetch(sheet.href, { cache: 'no-store' });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                css = await response.text();
            } else {
                css = sheet.ownerNode.textContent;
            }
            sources.push({ url: sheet.href || 'inline', bytes: new Blob([css]).size, functions: css.replace(/\/\*[\s\S]*?\*\//g, '').match(functionPattern) || [] });
        } catch (error) {
            inaccessible.push({ url: sheet.href || 'inline', error: String(error) });
        }
    }
    if (inaccessible.length || !sources.length) failures.push('Stylesheet scan incomplete');
    var count = sources.reduce(function (total, source) { return total + source.functions.length; }, 0);
    if (mode === 'webos' && count) failures.push('Unsupported functions remain in webOS stylesheet response');
    if (mode === 'desktop' && !count) failures.push('Desktop CSS lost its original functions');
    var rootStyle = getComputedStyle(document.documentElement);
    var insets = {};
    var rootDeclarations = {};
    ['top', 'right', 'bottom', 'left'].forEach(function (side) {
        var name = '--safe-area-inset-' + side;
        insets[side] = rootStyle.getPropertyValue(name).trim();
        rootDeclarations[side] = rules.filter(function (rule) { return rule.selector === ':root' && rule.style.getPropertyValue(name); })
            .map(function (rule) { return { value: rule.style.getPropertyValue(name).trim(), conditions: rule.conditions }; });
        if (mode === 'webos' && insets[side] !== '0rem') failures.push(name + ' is not 0rem');
        if (mode === 'desktop' && !rootDeclarations[side].some(function (item) { return !item.conditions.length && item.value.replace(/\s/g, '') === 'env(safe-area-inset-' + side + ',0rem)'; })) {
            failures.push('Desktop declaration changed: ' + name);
        }
    });
    function geometry(node) {
        var rect = node.getBoundingClientRect();
        var style = getComputedStyle(node);
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, computedWidth: style.width, computedHeight: style.height,
            marginLeft: style.marginLeft, paddingLeft: style.paddingLeft, maxWidth: style.maxWidth, maxHeight: style.maxHeight };
    }
    function visible(node) { return node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden'; }
    var routeNames = ['board-container', 'settings-container', 'library-container', 'discover-container', 'search-container', 'addons-container', 'calendar', 'metadetails-container'];
    var surfaces = [];
    routeNames.concat(['main-nav-bars-container']).forEach(function (name) {
        var rule = rules.find(function (candidate) { return new RegExp('^\\.' + name + '-[\\w-]+$').test(candidate.selector) && candidate.style.height && !candidate.conditions.length; });
        if (!rule) { failures.push('Missing compiled route selector: ' + name); return; }
        Array.from(document.querySelectorAll(rule.selector)).filter(visible).forEach(function (node) {
            var measured = geometry(node);
            surfaces.push({ name: name, selector: rule.selector, geometry: measured, declaredHeight: rule.style.height, declaredWidth: rule.style.width });
            if (Math.abs(measured.height - innerHeight) > 1) failures.push(name + ' height differs from viewport');
            if (name === 'main-nav-bars-container' && Math.abs(measured.width - innerWidth) > 1) failures.push(name + ' width differs from viewport');
        });
    });
    var routePath = location.hash.slice(1).split('?')[0] || '/';
    var expectedRoute = routePath === '/' ? 'board-container' : routePath.indexOf('/settings') === 0 ? 'settings-container'
        : routePath.indexOf('/library') === 0 ? 'library-container' : routePath.indexOf('/discover') === 0 ? 'discover-container'
            : routePath.indexOf('/search') === 0 ? 'search-container' : routePath.indexOf('/addons') === 0 ? 'addons-container'
                : routePath.indexOf('/calendar') === 0 ? 'calendar' : /^\/(detail|metadetails)(\/|$)/.test(routePath) ? 'metadetails-container' : null;
    if (expectedRoute && !surfaces.some(function (surface) { return surface.name === expectedRoute; })) failures.push('Expected route surface is not mounted: ' + expectedRoute);
    var fixture = document.createElement('section');
    fixture.id = 't24-safe-areas-fixture';
    fixture.style.cssText = 'position:fixed;right:30px;top:100px;width:480px;height:900px;z-index:2147483647;padding:20px;background:#222638;color:white;font:14px monospace;overflow:auto;';
    var title = document.createElement('h2');
    title.textContent = 'T2.4 | CSS fixtures (not React) | ' + mode;
    fixture.appendChild(title);
    document.body.appendChild(fixture);
    var definitions = [
        { name: 'HorizontalNavBar back button', match: /\.horizontal-nav-bar-container-[\w-]+ \.back-button-container-[\w-]+$/, property: 'margin-left', expected: '15px', layout: 'width:90px;height:45px;' },
        { name: 'MetaDetails preview', match: /\.metadetails-container-[\w-]+ \.metadetails-content-[\w-]+ \.meta-preview-[\w-]+$/, property: 'padding-left', expected: '60px', layout: 'width:360px;height:120px;' },
        { name: 'ActionMenu', match: /^\.menu-container-[\w-]+$/, property: 'max-width', expected: '210px', layout: 'position:relative;width:1000px;height:1000px;' }
    ];
    var samples = [];
    definitions.forEach(function (definition) {
        var rule = rules.find(function (candidate) { return definition.match.test(candidate.selector) && candidate.style.getPropertyValue(definition.property) && !candidate.conditions.length; });
        if (!rule) { failures.push('Missing CSS rule: ' + definition.name); return; }
        var actual = Array.from(document.querySelectorAll(rule.selector)).filter(visible).map(geometry);
        var card = document.createElement('article');
        card.style.cssText = 'position:relative;margin-top:16px;overflow:visible;';
        var label = document.createElement('div');
        label.textContent = definition.name + ' | ' + definition.property + ': ' + definition.expected;
        card.appendChild(label);
        var parent = card;
        rule.selector.split(/\s+/).forEach(function (part) {
            if (!/^(\.[\w-]+)+$/.test(part)) throw new Error('Unsupported fixture selector: ' + part);
            var node = document.createElement('div');
            node.className = part.slice(1).split('.').join(' ');
            node.style.cssText = 'position:relative;display:block;width:100%;height:auto;';
            parent.appendChild(node);
            parent = node;
        });
        // Set dimensions to exercise the limits; never override the tested property.
        parent.style.cssText = definition.layout;
        parent.textContent = definition.name === 'ActionMenu' ? 'Oversized content: CSS must constrain this menu to 210 x 315px.' : 'Compiled CSS spacing';
        card.appendChild(document.createElement('hr'));
        fixture.appendChild(card);
        var style = getComputedStyle(parent);
        var measured = geometry(parent);
        var result = { name: definition.name, selector: rule.selector, property: definition.property,
            expected: definition.expected, computed: style.getPropertyValue(definition.property), fixture: measured, actualElements: actual };
        if (result.computed !== definition.expected) failures.push(definition.name + ': ' + result.computed + ' instead of ' + definition.expected);
        actual.forEach(function (item) {
            var value = definition.property === 'margin-left' ? item.marginLeft : definition.property === 'padding-left' ? item.paddingLeft : item.maxWidth;
            if (value !== definition.expected) failures.push(definition.name + ': real element differs from fixture');
        });
        if (definition.name === 'ActionMenu' && (measured.maxHeight !== '315px' || measured.width !== 210 || measured.height !== 315)) failures.push('ActionMenu is not constrained to 210 x 315px');
        samples.push(result);
    });
    if (innerWidth !== 1920 || innerHeight !== 1080 || rootStyle.fontSize !== '15px') failures.push('Expected 1920x1080 viewport and 15px root');
    var report = { date: new Date().toISOString(), mode: mode, url: location.href, userAgent: navigator.userAgent,
        viewport: [innerWidth, innerHeight], rootFontSize: rootStyle.fontSize, standalone: matchMedia('(display-mode: standalone)').matches,
        support: { env: CSS.supports('padding', 'env(safe-area-inset-left, 0rem)'), min: CSS.supports('width', 'min(1px, 2px)'), max: CSS.supports('width', 'max(1px, 2px)'), clamp: CSS.supports('width', 'clamp(1px, 2px, 3px)') },
        insets: insets, rootDeclarations: rootDeclarations, stylesheetSources: sources, functionCount: count, inaccessibleSheets: inaccessible,
        routeSurfaces: surfaces, samples: samples, failures: failures,
        limits: 'Route surfaces and actualElements are real DOM; samples.fixture is a CSS fixture, not React integration. Overscan=0; no physical TV or cold packaged validation.' };
    window.__t24SafeAreasProbe = { report: report, cleanup: function () { fixture.remove(); delete window.__t24SafeAreasProbe; }, hideFixtures: function () { fixture.style.display = 'none'; } };
    return report;
}());
