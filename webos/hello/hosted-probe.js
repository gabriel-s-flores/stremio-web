(async function () {
    'use strict';

    var ADDON_URL = 'https://v3-cinemeta.strem.io/manifest.json';
    var token = 't04_' + String(new Date().getTime());
    var result = {
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

    try {
        document.cookie = 'stremio_t04=' + token + '; path=/';
        result.cookie = {
            writeAttempted: true,
            readable: document.cookie.indexOf('stremio_t04=' + token) !== -1
        };
    } catch (error) {
        result.cookie = { writeAttempted: true, error: { name: error.name, message: error.message } };
    }

    try {
        localStorage.setItem('stremio_t04', token);
        result.localStorage = {
            writeAttempted: true,
            readable: localStorage.getItem('stremio_t04') === token
        };
    } catch (error) {
        result.localStorage = { writeAttempted: true, error: { name: error.name, message: error.message } };
    }

    try {
        var response = await fetch(ADDON_URL, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store'
        });
        var body = await response.text();
        var manifest = null;
        try { manifest = JSON.parse(body); } catch (_) { /* response details are enough */ }
        result.fetchCors = {
            ok: response.ok,
            status: response.status,
            type: response.type,
            url: response.url,
            contentType: response.headers.get('content-type'),
            bodyLength: body.length,
            manifestId: manifest && manifest.id ? manifest.id : null
        };
    } catch (error) {
        result.fetchCors = { ok: false, error: { name: error.name, message: error.message } };
    }

    if (!result.serviceWorker.propertyPresent) {
        result.serviceWorker.result = 'unsupported';
    } else {
        try {
            var registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
            result.serviceWorker.result = 'registered';
            result.serviceWorker.scope = registration.scope;
            result.serviceWorker.active = Boolean(registration.active);
            result.serviceWorker.activeScriptURL = registration.active ? registration.active.scriptURL : null;
            var ready = await navigator.serviceWorker.ready;
            result.serviceWorker.ready = true;
            result.serviceWorker.activeAfterReady = Boolean(ready.active);
            result.serviceWorker.controllerAfter = Boolean(navigator.serviceWorker.controller);
        } catch (error) {
            result.serviceWorker.result = 'rejected';
            result.serviceWorker.error = { name: error.name, message: error.message };
        }
    }

    console.log('T0.4 hosted probe', JSON.stringify(result));
    return result;
}())
