// Core worker side of the tlsproxy (webOS build only; webos/tlsproxy/README.md). worker-entry.js
// installs it before the vendored stremio-core-web worker.js, whose glue calls `self.fetch` for
// every addon and API request.
//
// - Passed through untouched: everything that is not https (relative URLs, file:, the core files
//   next to worker.js), and 127.0.0.1/localhost.
// - In 'proxy' mode, hosts known to have Let's Encrypt certificates go through the proxy, with
//   method, headers and body.
// - Another https host that fails with a TypeError is tried once through the proxy; its response
//   is used, and the host learned, only if the proxy reports a Let's Encrypt/ISRG issuer. A
//   TypeError may also be CORS, and the proxy must not become a way around it.
// - If the proxy itself does not answer, the page restarts the service and the request is tried
//   once more.
// The configuration comes from the page (window.__webosTlsProxy, webos/tlsproxy/page.js) through
// the Bridge protocol; requests made before it is decided wait for it up to 3 s, then go direct.

import { hostOf, isLetsEncrypt, proxyUrlFor, ISSUER_HEADER } from './client';

const PAGE_OBJECT = '__webosTlsProxy';
export const CALL_TIMEOUT = 5000;

const noop = () => undefined;

export const install = (scope) => {
    const originalFetch = scope.fetch;
    if (typeof originalFetch !== 'function' || scope.__webosTlsProxyInstalled) return;
    scope.__webosTlsProxyInstalled = true;
    const RequestCtor = scope.Request;
    const direct = (input, init) => originalFetch.call(scope, input, init);
    const hosts = new Set();
    let config = null;
    let pending = null;
    let nextId = 0;

    // The Bridge protocol (stremio-core-web bridge.js): {request: {id, path, args}} to the page,
    // which answers {response: {id, result: {data} | {error}}}. The worker's own Bridge ignores
    // responses, and its calls only take their own ids.
    const callPage = (method, args) => new Promise((resolve, reject) => {
        nextId += 1;
        const id = `tlsproxy-${nextId}-${Math.random().toString(32).slice(2)}`;
        let timer = null;
        const onMessage = (event) => {
            const response = event.data && event.data.response;
            if (!response || response.id !== id) return;
            done();
            if ('error' in response.result) reject(response.result.error);
            else resolve(response.result.data);
        };
        function done() {
            scope.clearTimeout(timer);
            scope.removeEventListener('message', onMessage);
        }
        timer = scope.setTimeout(() => {
            done();
            reject(new Error(`tlsproxy: no answer from the page to ${method}`));
        }, CALL_TIMEOUT);
        scope.addEventListener('message', onMessage);
        scope.postMessage({ request: { id, path: [PAGE_OBJECT, method], args } });
    });

    const isFinal = (value) => !!value && (value.mode === 'direct' || (value.mode === 'proxy' && value.ready));
    const setConfig = (value) => {
        if (value && typeof value === 'object') {
            config = value;
            (value.hosts || []).forEach((host) => hosts.add(host));
        }
        return config;
    };
    // Asked once, and again while the page has not decided (or the service is down).
    const currentConfig = () => {
        if (isFinal(config)) return Promise.resolve(config);
        if (!pending) {
            pending = callPage('config', [])
                .then(setConfig, () => config)
                .then((value) => {
                    pending = null;
                    return value;
                });
        }
        return pending;
    };

    // A new Request to the proxy with the method, headers and body of `request` (unused).
    const toProxy = (value, request) => {
        const bodyless = request.method === 'GET' || request.method === 'HEAD';
        return (bodyless ? Promise.resolve(undefined) : request.arrayBuffer()).then((body) => new RequestCtor(
            proxyUrlFor(value.port, value.token, request.url),
            { method: request.method, headers: request.headers, body, mode: 'cors', credentials: 'omit', redirect: 'follow' }
        ));
    };

    // Through the proxy; if the proxy does not answer, restart it (page) and try once more.
    const viaProxy = (value, request) => {
        const spare = request.clone();
        return toProxy(value, request).then(direct).catch((error) => {
            if (!(error instanceof TypeError)) throw error;
            return callPage('restart', [value.port, value.token]).then(setConfig).then((fresh) => {
                if (!fresh || fresh.mode !== 'proxy' || !fresh.ready) throw error;
                return toProxy(fresh, spare).then(direct);
            });
        });
    };

    scope.fetch = function fetch(input, init) {
        const url = typeof input === 'string' ? input : input && input.url;
        const host = hostOf(url);
        if (!host || typeof RequestCtor !== 'function') return direct(input, init);
        let request;
        try {
            request = new RequestCtor(input, init);
        } catch {
            return direct(input, init);
        }
        return currentConfig().then((value) => {
            if (!value || value.mode !== 'proxy' || !value.ready) {
                return direct(request).catch((error) => {
                    if (value && value.mode === 'direct' && hosts.has(host)) callPage('noteDirectFailure', [url]).catch(noop);
                    throw error;
                });
            }
            if (hosts.has(host)) return viaProxy(value, request);
            const spare = request.clone();
            return direct(request).catch((error) => {
                if (!(error instanceof TypeError)) throw error;
                return toProxy(value, spare).then(direct).then((response) => {
                    if (!isLetsEncrypt(response.headers.get(ISSUER_HEADER))) throw error;
                    hosts.add(host);
                    callPage('learn', [host]).catch(noop);
                    return response;
                }, () => {
                    throw error;
                });
            });
        });
    };
};
