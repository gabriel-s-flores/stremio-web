// Runs in the page after the polyfills. Writes the result to window.__probe and to the screen.
/* global APP_LOCALES */

var report = { userAgent: navigator.userAgent, apis: {}, checks: {}, worker: null, done: false };
window.__probe = report;

var isNative = function (fn) {
    return typeof fn === 'function' && /\[native code\]/.test(Function.prototype.toString.call(fn));
};
var api = function (name, value) {
    report.apis[name] = value === undefined ? 'missing' : (isNative(value) ? 'native' : 'polyfill');
};

api('queueMicrotask', window.queueMicrotask);
api('AbortController', window.AbortController);
api('AbortSignal', window.AbortSignal);
api('Intl.PluralRules', window.Intl && Intl.PluralRules);
api('ResizeObserver', window.ResizeObserver);
api('Element.prototype.append', Element.prototype.append);
api('Element.prototype.prepend', Element.prototype.prepend);
api('Document.prototype.append', Document.prototype.append);
api('DocumentFragment.prototype.append', DocumentFragment.prototype.append);
api('Element.prototype.scrollTo', Element.prototype.scrollTo);
api('Element.prototype.scrollBy', Element.prototype.scrollBy);
api('Element.prototype.scroll', Element.prototype.scroll);
api('Node.prototype.getRootNode', Node.prototype.getRootNode);
api('DOMRect', window.DOMRect);
api('DOMRectReadOnly', window.DOMRectReadOnly);

var pending = [];
var check = function (name, run) {
    pending.push(new Promise(function (resolve) {
        var finish = function (ok, detail) {
            report.checks[name] = { ok: ok, detail: detail };
            resolve();
        };
        try {
            Promise.resolve(run()).then(function (detail) {
                finish(true, detail);
            }, function (error) {
                finish(false, String(error && error.stack || error));
            });
        } catch (error) {
            finish(false, String(error && error.stack || error));
        }
    }));
};
var assert = function (condition, message) {
    if (!condition) {
        throw new Error('assertion failed: ' + message);
    }
};

check('queueMicrotask order', function () {
    return new Promise(function (resolve) {
        var order = [];
        setTimeout(function () {
            order.push('timer');
            resolve(order.join(','));
        }, 0);
        Promise.resolve().then(function () {
            order.push('promise');
        });
        queueMicrotask(function () {
            order.push('microtask');
        });
        order.push('sync');
    }).then(function (detail) {
        assert(detail === 'sync,promise,microtask,timer', detail);
        return detail;
    });
});

check('AbortController abort event', function () {
    var controller = new AbortController();
    var calls = 0;
    controller.signal.addEventListener('abort', function () {
        calls++;
    });
    assert(controller.signal.aborted === false, 'not aborted at start');
    controller.abort();
    assert(controller.signal.aborted === true && calls === 1, 'aborted=' + controller.signal.aborted + ' calls=' + calls);
    return 'aborted, 1 event';
});

// data: URLs because Chromium rejects file:// fetches on the spot, before any abort can happen.
check('fetch honours an aborted signal', function () {
    var controller = new AbortController();
    var request = fetch('data:text/plain,hello', { signal: controller.signal });
    controller.abort();
    return request.then(function () {
        throw new Error('fetch resolved after abort');
    }, function (error) {
        assert(error && error.name === 'AbortError', 'error.name=' + (error && error.name));
        return 'rejected with ' + error.name;
    });
});

check('fetch with a live signal still works', function () {
    var controller = new AbortController();
    return fetch('data:text/plain,hello', { signal: controller.signal }).then(function (response) {
        return response.text();
    }).then(function (text) {
        assert(text === 'hello', 'body=' + text);
        return 'body ' + text;
    });
});

check('Intl.PluralRules selects', function () {
    var cases = [
        ['en-US', 'cardinal', [[1, 'one'], [2, 'other']]],
        ['ru-RU', 'cardinal', [[1, 'one'], [2, 'few'], [5, 'many'], [21, 'one'], [1.5, 'other']]],
        ['pt-BR', 'cardinal', [[0, 'one'], [1, 'one'], [2, 'other']]],
        ['pt-PT', 'cardinal', [[0, 'other'], [1, 'one']]],
        ['pl-PL', 'cardinal', [[1, 'one'], [2, 'few'], [5, 'many']]],
        ['ar-AR', 'cardinal', [[0, 'zero'], [1, 'one'], [2, 'two'], [3, 'few'], [11, 'many'], [100, 'other']]],
        ['ja-JP', 'cardinal', [[1, 'other']]],
        ['en-US', 'ordinal', [[1, 'one'], [2, 'two'], [3, 'few'], [4, 'other']]],
    ];
    cases.forEach(function (item) {
        var rules = new Intl.PluralRules(item[0], { type: item[1] });
        item[2].forEach(function (pair) {
            assert(rules.select(pair[0]) === pair[1], item[0] + ' ' + item[1] + ' ' + pair[0] + ' -> ' + rules.select(pair[0]) + ', expected ' + pair[1]);
        });
    });
    return cases.length + ' locale/type groups';
});

check('Intl.PluralRules for every app locale', function () {
    var categories = {};
    APP_LOCALES.forEach(function (locale) {
        var rules = new Intl.PluralRules(locale);
        var resolved = rules.resolvedOptions();
        assert(resolved.pluralCategories.indexOf('other') !== -1, locale + ' has no "other"');
        assert(Intl.PluralRules.supportedLocalesOf(locale).length === 1, locale + ' not supported');
        assert(typeof rules.select(3) === 'string', locale);
        categories[locale] = resolved.pluralCategories.join('/');
    });
    return APP_LOCALES.length + ' locales: ' + JSON.stringify(categories);
});

check('ResizeObserver notifies on resize', function () {
    return new Promise(function (resolve, reject) {
        var box = document.createElement('div');
        box.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:50px';
        document.body.appendChild(box);
        var sizes = [];
        var observer = new ResizeObserver(function (entries) {
            entries.forEach(function (entry) {
                sizes.push(Math.round(entry.contentRect.width) + 'x' + Math.round(entry.contentRect.height));
            });
            if (sizes.length === 1) {
                box.style.width = '240px';
            } else {
                observer.disconnect();
                document.body.removeChild(box);
                resolve(sizes.join(' then '));
            }
        });
        observer.observe(box);
        setTimeout(function () {
            reject(new Error('no notification, sizes=' + sizes.join()));
        }, 4000);
    }).then(function (detail) {
        assert(detail === '100x50 then 240x50', detail);
        return detail;
    });
});

check('DOMRect from a bounding box, scaled like getInterfaceRect', function () {
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:100px;top:50px;width:250px;height:125px';
    document.body.appendChild(box);
    // The same read as getInterfaceRect: x and y, which Chromium 53's ClientRect only has through the polyfill.
    var b = box.getBoundingClientRect();
    var x = b.x, y = b.y, width = b.width, height = b.height;
    document.body.removeChild(box);
    var rect = new DOMRect(x / 1.25, y / 1.25, width / 1.25, height / 1.25);
    var detail = (b.constructor && b.constructor.name) + ' ' + JSON.stringify(rect.toJSON());
    assert(rect instanceof DOMRectReadOnly && rect.left === 80 && rect.top === 40 && rect.right === 280 && rect.bottom === 140, detail);
    return detail;
});

check('getRootNode', function () {
    var box = document.createElement('div');
    var inner = document.createElement('span');
    box.appendChild(inner);
    assert(inner.getRootNode() === box, 'detached subtree');
    document.body.appendChild(box);
    var root = inner.getRootNode();
    document.body.removeChild(box);
    assert(root === document, 'attached: ' + root);
    return 'document';
});

check('append and prepend', function () {
    var parent = document.createElement('div');
    parent.innerHTML = '<i>mid</i>';
    var a = document.createElement('b');
    a.textContent = 'a';
    parent.append(a, 'text', 7);
    parent.prepend('first', document.createElement('u'));
    assert(parent.innerHTML === 'first<u></u><i>mid</i><b>a</b>text7', parent.innerHTML);
    var fragment = document.createDocumentFragment();
    fragment.append('x', document.createElement('s'));
    assert(fragment.childNodes.length === 2, 'fragment children ' + fragment.childNodes.length);
    return parent.innerHTML;
});

check('scrollTo, scrollBy and scroll', function () {
    var scroller = document.createElement('div');
    scroller.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:100px;overflow:auto';
    scroller.innerHTML = '<div style="width:1000px;height:1000px"></div>';
    document.body.appendChild(scroller);
    var at = function () {
        return scroller.scrollLeft + ',' + scroller.scrollTop;
    };
    scroller.scrollTo({ top: 300, left: 50, behavior: 'smooth' });
    assert(at() === '50,300', 'scrollTo options: ' + at());
    scroller.scrollTo({ top: 10 });
    assert(at() === '50,10', 'keeps left: ' + at());
    scroller.scrollTo(7, 8);
    assert(at() === '7,8', 'scrollTo(x, y): ' + at());
    scroller.scrollBy({ top: 20, behavior: 'smooth' });
    scroller.scrollBy(3, 2);
    assert(at() === '10,30', 'scrollBy: ' + at());
    scroller.scroll({ top: 0, left: 0 });
    assert(at() === '0,0', 'scroll: ' + at());
    document.body.removeChild(scroller);
    return 'ok';
});

var worker = new Worker('worker.js');
var workerDone = new Promise(function (resolve) {
    worker.onmessage = function (event) {
        report.worker = event.data;
        resolve();
    };
    worker.onerror = function (event) {
        report.worker = { error: String(event.message) };
        resolve();
    };
    setTimeout(resolve, 8000);
});

Promise.all(pending.concat([workerDone])).then(function () {
    report.done = true;
    var failed = Object.keys(report.checks).filter(function (name) {
        return !report.checks[name].ok;
    });
    var lines = ['userAgent: ' + report.userAgent, '', 'APIs (page):'];
    Object.keys(report.apis).forEach(function (name) {
        lines.push('  ' + name + ': ' + report.apis[name]);
    });
    lines.push('', 'APIs (worker): ' + JSON.stringify(report.worker && report.worker.apis));
    lines.push('', 'checks: ' + (Object.keys(report.checks).length - failed.length) + ' ok, ' + failed.length + ' failed');
    Object.keys(report.checks).forEach(function (name) {
        lines.push('  ' + (report.checks[name].ok ? 'OK  ' : 'FAIL') + ' ' + name);
    });
    var pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;padding:24px;font:22px/1.35 monospace;color:#fff;background:#1b1a2e;white-space:pre-wrap';
    pre.textContent = lines.join('\n');
    document.body.appendChild(pre);
});
