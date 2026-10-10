// Runs in a Worker after the worker polyfills; posts the result to the page.

var isNative = function (fn) {
    return typeof fn === 'function' && /\[native code\]/.test(Function.prototype.toString.call(fn));
};
var api = function (name, value) {
    return value === undefined ? 'missing' : (isNative(value) ? 'native' : 'polyfill');
};

var result = {
    apis: {
        queueMicrotask: api('queueMicrotask', self.queueMicrotask),
        AbortController: api('AbortController', self.AbortController),
        AbortSignal: api('AbortSignal', self.AbortSignal),
    },
    checks: {},
};

var order = [];
setTimeout(function () {
    order.push('timer');
    result.checks.queueMicrotask = order.join(',') === 'sync,promise,microtask,timer' ? 'ok: ' + order.join(',') : 'FAIL: ' + order.join(',');
    try {
        var controller = new AbortController();
        var calls = 0;
        controller.signal.addEventListener('abort', function () {
            calls++;
        });
        controller.abort();
        result.checks.AbortController = controller.signal.aborted && calls === 1 ? 'ok' : 'FAIL';
    } catch (error) {
        result.checks.AbortController = 'FAIL: ' + error;
    }
    var request;
    try {
        var abort = new AbortController();
        request = fetch('data:text/plain,hello', { signal: abort.signal });
        abort.abort();
    } catch (error) {
        result.checks.fetchAbort = 'FAIL: ' + error;
        self.postMessage(result);
        return;
    }
    request.then(function () {
        result.checks.fetchAbort = 'FAIL: resolved';
    }, function (error) {
        result.checks.fetchAbort = error && error.name === 'AbortError' ? 'ok: AbortError' : 'FAIL: ' + (error && error.name);
    }).then(function () {
        self.postMessage(result);
    });
}, 0);
Promise.resolve().then(function () {
    order.push('promise');
});
self.queueMicrotask(function () {
    order.push('microtask');
});
order.push('sync');
