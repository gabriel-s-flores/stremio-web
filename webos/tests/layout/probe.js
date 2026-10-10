// Layout probe, evaluated in the page by `run` through CDP (Chromium 53: ES5, one expression).
// Returns JSON text: the scene, the error of the page, and the boxes that tell a broken layout from
// a good one (columns and rows, the heights of the lines, children side by side or stacked).
(function () {
    var round = function (value) { return Math.round(value); };
    var box = function (element) {
        var rect = element.getBoundingClientRect();
        return [round(rect.left), round(rect.top), round(rect.width), round(rect.height)];
    };
    var token = function (name) { return new RegExp('(^|\\s)' + name + '-[A-Za-z0-9_-]{5}(\\s|$)'); };
    var byClass = function (name, root) {
        var pattern = token(name);
        return Array.prototype.filter.call((root || document).querySelectorAll('*'), function (element) {
            return typeof element.className === 'string' && pattern.test(element.className);
        });
    };
    var unique = function (values) {
        return values.filter(function (value, index) { return values.indexOf(value) === index; });
    };
    var layout = window.__layout || {};
    var out = {
        scene: layout.scene,
        error: layout.error || null,
        viewport: [window.innerWidth, window.innerHeight],
        scrollsSideways: document.documentElement.scrollWidth > window.innerWidth
    };
    var children = function (element) { return Array.prototype.map.call(element.children, box); };

    if (layout.scene === 'calendar') {
        var cells = byClass('cell');
        var boxes = cells.map(box);
        out.cells = cells.length;
        out.columns = unique(boxes.map(function (b) { return b[0]; })).length;
        out.rowTops = unique(boxes.map(function (b) { return b[1]; }));
        out.rowHeights = unique(boxes.map(function (b) { return b[3]; }));
        out.cellWidths = unique(boxes.map(function (b) { return b[2]; }));
        out.firstRow = boxes.slice(0, 7);
        out.lastBottom = Math.max.apply(null, boxes.map(function (b) { return b[1] + b[3]; }));
        out.week = byClass('week').map(children)[0];
        out.grid = byClass('grid').map(box)[0];
        out.posters = byClass('poster').length;
        out.postersWithSize = byClass('poster').filter(function (poster) { return poster.getBoundingClientRect().width > 0; }).length;
    }
    if (layout.scene === 'livetv') {
        ['channel-page', 'hero', 'guide-layout', 'schedule', 'streams-panel', 'stream-options'].forEach(function (name) {
            var element = byClass(name)[0];
            out[name] = element ? box(element) : null;
        });
        var scheduleTitle = byClass('title', byClass('schedule')[0] || document)[0];
        out.scheduleTitle = scheduleTitle ? box(scheduleTitle) : null;
        out.programs = byClass('program').slice(0, 3).map(function (row) { return children(row); });
        out.streamOptions = byClass('stream-option').map(function (row) {
            return { box: box(row), children: children(row) };
        });
    }
    if (layout.scene === 'stats') {
        var stats = byClass('stats')[0];
        out.stats = stats ? box(stats) : null;
        out.stat = byClass('stat').map(box);
        var menu = byClass('statistics-menu-container')[0];
        out.menu = menu ? box(menu) : null;
    }
    if (layout.scene === 'scale') {
        var ticks = byClass('ticks')[0];
        out.ticks = ticks ? box(ticks) : null;
        out.labels = byClass('label').map(box);
    }
    if (layout.scene === 'gamepad') {
        out.mappings = byClass('mapping').slice(0, 3).map(function (row) {
            return { box: box(row), children: children(row) };
        });
        out.mappingCount = byClass('mapping').length;
    }
    return JSON.stringify(out);
})()
