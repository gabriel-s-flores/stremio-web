// queueMicrotask for Chromium 53 (webOS TV 4.x; native since 71). Needed in the page and in the
// worker: the wasm-bindgen glue of stremio-core-web calls it.

export const install = (global) => {
    if (typeof global.queueMicrotask === 'function') {
        return;
    }
    const resolved = Promise.resolve();
    const rethrow = (error) => {
        setTimeout(() => {
            throw error;
        }, 0);
    };
    Object.defineProperty(global, 'queueMicrotask', {
        value: function queueMicrotask(callback) {
            if (typeof callback !== 'function') {
                throw new TypeError('Failed to execute \'queueMicrotask\': the callback provided as parameter 1 is not a function.');
            }
            // A throwing callback is reported like an uncaught error and must not reject the promise.
            resolved.then(() => callback()).catch(rethrow);
        },
        writable: true,
        configurable: true,
        enumerable: true
    });
};

