// ES2018 browser probe, usable through cdp.mjs eval-file or the T2.9 runner.
(async function () {
    var failures = [];
    var root = document.querySelector('[data-webos-fonts-icons-fixture]');
    if (!root) throw new Error('T2.9 debug fixture missing');
    function check(ok, message) { if (!ok) failures.push(message); }
    function raster(family, value) {
        var canvas = document.createElement('canvas');
        canvas.width = 1000; canvas.height = 100;
        var ctx = canvas.getContext('2d');
        ctx.font = '48px ' + family;
        ctx.fillText(value, 4, 70);
        var data = ctx.getImageData(0, 0, 1000, 100).data;
        var visible = 0, colored = 0;
        for (var i = 0; i < data.length; i += 4) {
            if (data[i + 3]) visible++;
            if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 40) colored++;
        }
        return { visible: visible, colored: colored, pixels: canvas.toDataURL() };
    }
    var fonts = [];
    for (var spec of [
        { family: 'PlusJakartaSans', text: 'Ação televisão 0123456789', selector: '[data-t29-text]' },
        { family: 'TwemojiFlags', text: '🇧🇷', selector: '[data-t29-flag]' }
    ]) {
        try {
            var faces = await document.fonts.load('48px "' + spec.family + '"', spec.text);
            var sample = root.querySelector(spec.selector);
            var family = getComputedStyle(sample).fontFamily;
            var actual = raster('"' + spec.family + '", monospace', spec.text);
            var fallback = raster('monospace', spec.text);
            var result = { family: spec.family, computed: family, loadedFaces: faces.length,
                loaded: faces.length > 0 && faces.every(function (f) { return f.status === 'loaded'; }),
                visiblePixels: actual.visible, coloredPixels: actual.colored, differsFromFallback: actual.pixels !== fallback.pixels };
            fonts.push(result);
            check(result.loaded, spec.family + ': font not loaded');
            check(family.split(',')[0].replace(/["']/g, '') === spec.family, spec.family + ': not primary family');
            check(actual.visible > 0 && result.differsFromFallback, spec.family + ': missing or fallback glyphs');
            if (spec.family === 'TwemojiFlags') check(actual.colored > 100, 'flag has no colored glyph');
        } catch (e) { failures.push(spec.family + ': ' + String(e)); }
    }
    var icons = [];
    var controls = Array.from(root.querySelectorAll('[data-t29-icon]'));
    check(controls.length === 24, 'expected 24 icon samples');
    var previousFocus = document.activeElement;
    for (var button of controls) {
        for (var focused of [false, true]) {
            if (focused) button.focus(); else button.blur();
            var svg = button.querySelector('svg');
            var box = svg.getBoundingClientRect();
            var color = getComputedStyle(button).color;
            var paints = Array.from(svg.querySelectorAll('path,circle,rect,polygon,line,polyline,ellipse')).map(function (shape) {
                var style = getComputedStyle(shape), bounds = shape.getBBox();
                return { fill: style.fill, stroke: style.stroke, color: style.color, width: bounds.width, height: bounds.height,
                    visible: style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0 };
            });
            var ok = box.width === 40 && box.height === 40 && paints.length > 0 && paints.every(function (p) {
                return p.visible && p.width > 0 && p.height > 0 && p.color === color &&
                    (p.fill === color || p.stroke === color) &&
                    (p.fill === 'none' || p.fill === color) && (p.stroke === 'none' || p.stroke === color);
            });
            var focusVisible = !focused || (document.activeElement === button && getComputedStyle(button).outlineStyle !== 'none');
            check(ok && focusVisible, button.getAttribute('data-t29-icon') + ': dimensions/currentColor/focus failed');
            icons.push({ name: button.getAttribute('data-t29-icon'), focused: focused, color: color,
                background: getComputedStyle(button.parentElement.parentElement).backgroundColor,
                width: box.width, height: box.height, paints: paints, focusVisible: focusVisible, pass: ok && focusVisible });
        }
    }
    if (previousFocus && previousFocus.focus) previousFocus.focus();
    return { timestamp: new Date().toISOString(), userAgent: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight }, fonts: fonts, icons: icons, failures: failures };
})()
