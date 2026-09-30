(function () {
    'use strict';

    var ADDON_URL = 'https://v3-cinemeta.strem.io/manifest.json';
    var output = document.getElementById('output');
    var summary = document.getElementById('summary');
    var state = null;

    function errorDetails(error) {
        return {
            name: error && error.name ? String(error.name) : '',
            message: error && error.message ? String(error.message) : String(error)
        };
    }

    function timeout(promise, milliseconds) {
        return Promise.race([
            promise,
            new Promise(function (_, reject) {
                setTimeout(function () {
                    reject(new Error('timeout after ' + milliseconds + 'ms'));
                }, milliseconds);
            })
        ]);
    }

    function render() {
        output.textContent = JSON.stringify(state, null, 2);
        if (window.console && console.log) console.log('T0.4', JSON.stringify(state));
    }

    function makeState() {
        return {
            task: 'T0.4',
            timestamp: new Date().toISOString(),
            href: String(location.href),
            origin: String(location.origin),
            protocol: String(location.protocol),
            userAgent: String(navigator.userAgent),
            addonUrl: ADDON_URL,
            cookie: null,
            localStorage: null,
            fetchCors: null,
            serviceWorker: {
                propertyPresent: 'serviceWorker' in navigator,
                controllerBefore: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)
            }
        };
    }

    function testCookie() {
        var token = 't04_' + String(new Date().getTime());
        try {
            document.cookie = 'stremio_t04=' + token + '; path=/';
            state.cookie = {
                writeAttempted: true,
                readable: document.cookie.indexOf('stremio_t04=' + token) !== -1,
                cookieString: String(document.cookie)
            };
        } catch (error) {
            state.cookie = { writeAttempted: true, error: errorDetails(error) };
        }
    }

    function testLocalStorage() {
        var token = 't04_' + String(new Date().getTime());
        try {
            localStorage.setItem('stremio_t04', token);
            state.localStorage = {
                writeAttempted: true,
                readable: localStorage.getItem('stremio_t04') === token
            };
        } catch (error) {
            state.localStorage = { writeAttempted: true, error: errorDetails(error) };
        }
    }

    function testFetch() {
        return fetch(ADDON_URL, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store'
        }).then(function (response) {
            return response.text().then(function (body) {
                var manifest = null;
                try { manifest = JSON.parse(body); } catch (_) { /* response details are enough */ }
                state.fetchCors = {
                    ok: response.ok,
                    status: response.status,
                    type: response.type,
                    url: response.url,
                    contentType: response.headers.get('content-type'),
                    bodyLength: body.length,
                    manifestId: manifest && manifest.id ? manifest.id : null
                };
            });
        }).catch(function (error) {
            state.fetchCors = { ok: false, error: errorDetails(error) };
        });
    }

    function testServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            state.serviceWorker.result = 'unsupported';
            return Promise.resolve();
        }

        try {
            return timeout(navigator.serviceWorker.register('sw.js', { scope: './' }), 8000)
                .then(function (registration) {
                    state.serviceWorker.result = 'registered';
                    state.serviceWorker.scope = registration.scope;
                    state.serviceWorker.active = Boolean(registration.active);
                    state.serviceWorker.activeScriptURL = registration.active ? registration.active.scriptURL : null;
                    return timeout(navigator.serviceWorker.ready, 8000).then(function (ready) {
                        state.serviceWorker.ready = true;
                        state.serviceWorker.activeAfterReady = Boolean(ready.active);
                        state.serviceWorker.controllerAfter = Boolean(navigator.serviceWorker.controller);
                    });
                })
                .catch(function (error) {
                    state.serviceWorker.result = 'rejected';
                    state.serviceWorker.error = errorDetails(error);
                });
        } catch (error) {
            state.serviceWorker.result = 'threw';
            state.serviceWorker.error = errorDetails(error);
            return Promise.resolve();
        }
    }

    function run() {
        summary.textContent = 'Executando probes...';
        state = makeState();
        testCookie();
        testLocalStorage();
        render();
        return testFetch().then(testServiceWorker).then(function () {
            summary.textContent = 'Probes concluídos — veja o JSON e o console.';
            render();
            return state;
        });
    }

    function runNoCors() {
        return fetch(ADDON_URL, { method: 'GET', mode: 'no-cors', cache: 'no-store' })
            .then(function (response) {
                state.fetchNoCors = {
                    ok: response.ok,
                    status: response.status,
                    type: response.type,
                    readableBody: response.type !== 'opaque'
                };
                render();
                return state.fetchNoCors;
            })
            .catch(function (error) {
                state.fetchNoCors = { error: errorDetails(error) };
                render();
                return state.fetchNoCors;
            });
    }

    window.t04 = {
        run: run,
        runNoCors: runNoCors,
        getState: function () { return state; },
        addonUrl: ADDON_URL
    };
    document.getElementById('run').addEventListener('click', run);
    document.getElementById('no-cors').addEventListener('click', runNoCors);
    setTimeout(run, 250);
}());
