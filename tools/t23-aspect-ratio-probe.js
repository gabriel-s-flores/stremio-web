// T2.3 aspect-ratio probe: measures Calendar Cell geometry in the live page.
// Pure read-only diagnostics; run on the Calendar table or the #/debug/calendar fixture.
(function () {
    'use strict';

    function byClass(part) {
        return Array.prototype.slice.call(document.querySelectorAll('[class*="' + part + '-"]'));
    }

    function rectOf(element) {
        var rect = element.getBoundingClientRect();
        return {
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100
        };
    }

    var supports = false;
    var supportsError = null;
    try {
        supports = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
            && CSS.supports('aspect-ratio', '2 / 3');
    } catch (error) {
        supportsError = String(error);
    }

    var RATIO = 2 / 3;
    var failures = [];
    var cells = byClass('cell');
    var samples = [];

    cells.forEach(function (cell, cellIndex) {
        var items = Array.prototype.slice.call(cell.querySelectorAll('[class*="item-"]'));
        items.forEach(function (item, itemIndex) {
            var poster = item.querySelector('[class*="poster-"]');
            var icon = item.querySelector('[class*="icon-"]');
            var itemBox = rectOf(item);
            var posterBox = poster ? rectOf(poster) : null;
            var iconWithin = null;

            if (icon) {
                var iconRect = icon.getBoundingClientRect();
                var itemRect = item.getBoundingClientRect();
                iconWithin = iconRect.left >= itemRect.left - 1
                    && iconRect.top >= itemRect.top - 1
                    && iconRect.right <= itemRect.right + 1
                    && iconRect.bottom <= itemRect.bottom + 1;
            }

            var ratio = itemBox.height > 0 ? itemBox.width / itemBox.height : null;
            if (ratio === null || Math.abs(ratio - RATIO) > 0.03) {
                failures.push('cell ' + cellIndex + ' item ' + itemIndex + ': ratio ' + ratio);
            }
            if (!supports) {
                if (!posterBox || Math.abs(posterBox.width - itemBox.width) > 1 || Math.abs(posterBox.height - itemBox.height) > 1) {
                    failures.push('cell ' + cellIndex + ' item ' + itemIndex + ': poster does not fill the item');
                }
                if (iconWithin === false) {
                    failures.push('cell ' + cellIndex + ' item ' + itemIndex + ': icon escapes the item box');
                }
            }

            samples.push({
                cell: cellIndex,
                item: itemIndex,
                itemBox: itemBox,
                inlineWidth: item.style ? item.style.width || null : null,
                posterBox: posterBox,
                iconWithinItem: iconWithin,
                ratio: ratio === null ? null : Math.round(ratio * 1000) / 1000
            });
        });
    });

    var result = {
        supportsAspectRatio: supports,
        supportsError: supportsError,
        expectedMode: supports ? 'native' : 'fallback (measured width)',
        origin: window.location.origin,
        route: window.location.hash,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        cells: cells.length,
        measuredItems: samples.length,
        failures: failures,
        samples: samples
    };
    window.__t23AspectRatioProbe = result;
    return result;
})();
