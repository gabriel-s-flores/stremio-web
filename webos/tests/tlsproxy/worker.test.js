/**
 * @jest-environment node
 */
// webos/tlsproxy/worker.js: the core worker fetch wrapper, with a fake worker scope whose
// postMessage reaches a fake page Bridge (window.__webosTlsProxy) and real Request/Response.

import { install } from '../../tlsproxy/worker';

const PROXY = 'http://127.0.0.1:';
const SEED = ['images.metahub.space', 'debrid-link.com'];

const proxyConfig = (port = 47443, token = 'tok', hosts = SEED) => ({ mode: 'proxy', ready: true, port, token, hosts });

// page: the object the worker reaches as window.__webosTlsProxy (null: missing).
const makeScope = (page, upstream) => {
    const listeners = new Set();
    const messages = [];
    const original = jest.fn((input, init) => upstream(typeof input === 'string' ? input : input.url, input, init));
    const scope = {
        Request,
        setTimeout,
        clearTimeout,
        fetch: original,
        addEventListener: (type, listener) => listeners.add(listener),
        removeEventListener: (type, listener) => listeners.delete(listener),
        postMessage: (message) => {
            messages.push(message);
            const { id, path, args } = message.request;
            Promise.resolve().then(async () => {
                let result;
                try {
                    if (!page) throw new TypeError(`Cannot read property '${path[1]}' of undefined`);
                    result = { data: await page[path[1]](...args) };
                } catch (error) {
                    result = { error };
                }
                listeners.forEach((listener) => listener({ data: { response: { id, result } } }));
            });
        },
    };
    install(scope);
    return { scope, original, messages };
};

const fakePage = (config) => ({
    config: jest.fn(() => Promise.resolve(typeof config === 'function' ? config() : config)),
    learn: jest.fn(),
    restart: jest.fn(),
    noteDirectFailure: jest.fn(),
});

// Upstream: direct requests to `failing` hosts reject with a TypeError (certificate), the others
// answer; the proxy answers with the issuer of `issuers` and echoes method, headers and body.
const network = ({ failing = [], issuers = {}, deadPorts = [] } = {}) => async (url, raw, init) => {
    if (url.startsWith(PROXY)) {
        const input = typeof raw === 'string' ? new Request(url, init) : raw;
        const port = Number(url.slice(PROXY.length).split('/')[0]);
        if (deadPorts.includes(port)) throw new TypeError('Failed to fetch');
        const target = decodeURIComponent(url.split('&url=')[1]);
        const host = new URL(target).host;
        const body = input.method === 'GET' || input.method === 'HEAD' ? '' : await input.text();
        return new Response(JSON.stringify({ via: 'proxy', port, target, method: input.method, auth: input.headers.get('authorization'), body }), {
            headers: issuers[host] ? { 'X-Proxy-Issuer-O': issuers[host] } : {},
        });
    }
    if (failing.some((host) => url.includes(`//${host}/`))) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ via: 'direct', url }));
};

describe('passed through untouched', () => {
    test.each([
        ['relative URL (core files next to worker.js)', 'stremio_core_web_bg.wasm'],
        ['file: URL', 'file:///media/developer/apps/usr/palm/applications/x/worker.js'],
        ['http', 'http://images.metahub.space/poster.jpg'],
        ['the proxy itself', `http://127.0.0.1:47443/proxy?t=tok&url=${encodeURIComponent('https://images.metahub.space/a')}`],
        ['https loopback', 'https://127.0.0.1:8443/x'],
    ])('%s', async (_, url) => {
        const page = fakePage(proxyConfig());
        const { scope, original, messages } = makeScope(page, network());
        const init = { method: 'GET' };
        await scope.fetch(url, init);
        expect(original).toHaveBeenCalledTimes(1);
        expect(original.mock.calls[0][0]).toBe(url);
        expect(original.mock.calls[0][1]).toBe(init);
        expect(messages).toHaveLength(0);
    });
});

describe('proxy mode', () => {
    test('a known host goes through the proxy with method, headers and body (Request input)', async () => {
        const { scope, original } = makeScope(fakePage(proxyConfig()), network());
        const request = new Request('https://debrid-link.com/api/v2/x', {
            method: 'POST', headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' }, body: '{"a":1}',
        });
        const json = await (await scope.fetch(request)).json();
        expect(json).toEqual({
            via: 'proxy', port: 47443, target: 'https://debrid-link.com/api/v2/x', method: 'POST', auth: 'Bearer abc', body: '{"a":1}',
        });
        expect(original).toHaveBeenCalledTimes(1);
        expect(original.mock.calls[0][0].url).toBe(`http://127.0.0.1:47443/proxy?t=tok&url=${encodeURIComponent('https://debrid-link.com/api/v2/x')}`);
    });

    test('the configuration is asked once when decided', async () => {
        const page = fakePage(proxyConfig());
        const { scope } = makeScope(page, network());
        await scope.fetch('https://images.metahub.space/a');
        await scope.fetch('https://images.metahub.space/b');
        await scope.fetch('https://api.strem.io/c');
        expect(page.config).toHaveBeenCalledTimes(1);
    });

    test('another https host that works directly stays direct', async () => {
        const { scope, original } = makeScope(fakePage(proxyConfig()), network());
        const json = await (await scope.fetch('https://api.strem.io/api/x', { method: 'POST', body: '{}' })).json();
        expect(json.via).toBe('direct');
        expect(original).toHaveBeenCalledTimes(1);
    });

    test('TypeError on an unknown Let\'s Encrypt host: retried through the proxy and learned', async () => {
        const page = fakePage(proxyConfig());
        const { scope, original } = makeScope(page, network({ failing: ['addon.example.com'], issuers: { 'addon.example.com': "Let's Encrypt" } }));
        const json = await (await scope.fetch(new Request('https://addon.example.com/manifest.json'))).json();
        expect(json).toEqual(expect.objectContaining({ via: 'proxy', target: 'https://addon.example.com/manifest.json' }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(page.learn).toHaveBeenCalledWith('addon.example.com');
        original.mockClear();
        await scope.fetch('https://addon.example.com/catalog/movie/top.json');
        expect(original).toHaveBeenCalledTimes(1);
        expect(original.mock.calls[0][0].url).toMatch(/^http:\/\/127\.0\.0\.1:47443\/proxy/);
    });

    test('TypeError on a host whose issuer is not Let\'s Encrypt (e.g. CORS): the original error, nothing learned', async () => {
        const page = fakePage(proxyConfig());
        const { scope } = makeScope(page, network({ failing: ['cors.example.com'], issuers: { 'cors.example.com': 'Google Trust Services' } }));
        await expect(scope.fetch('https://cors.example.com/x')).rejects.toThrow('Failed to fetch');
        expect(page.learn).not.toHaveBeenCalled();
    });

    test('the body of a POST that failed directly is still sent through the proxy', async () => {
        const { scope } = makeScope(fakePage(proxyConfig()), network({ failing: ['le.example.com'], issuers: { 'le.example.com': 'ISRG' } }));
        const json = await (await scope.fetch('https://le.example.com/api', { method: 'POST', body: 'payload' })).json();
        expect(json).toEqual(expect.objectContaining({ via: 'proxy', method: 'POST', body: 'payload' }));
    });

    test('errors other than TypeError are not retried', async () => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        const { scope, original } = makeScope(fakePage(proxyConfig()), async () => {
            throw abort;
        });
        await expect(scope.fetch('https://x.example.com/a')).rejects.toBe(abort);
        expect(original).toHaveBeenCalledTimes(1);
    });

    test('proxy down: the page restarts the service and the request is tried once more, with its body', async () => {
        const page = fakePage(proxyConfig(47443, 'old'));
        page.restart.mockImplementation(() => Promise.resolve(proxyConfig(47450, 'new')));
        const { scope } = makeScope(page, network({ deadPorts: [47443] }));
        const json = await (await scope.fetch('https://debrid-link.com/api', { method: 'POST', body: 'again' })).json();
        expect(page.restart).toHaveBeenCalledWith(47443, 'old');
        expect(json).toEqual(expect.objectContaining({ via: 'proxy', port: 47450, body: 'again' }));
    });

    test('proxy down and not back: the request fails', async () => {
        const page = fakePage(proxyConfig());
        page.restart.mockImplementation(() => Promise.resolve({ mode: 'proxy', ready: false, hosts: SEED }));
        const { scope } = makeScope(page, network({ deadPorts: [47443] }));
        await expect(scope.fetch('https://images.metahub.space/a')).rejects.toThrow(TypeError);
    });
});

describe('direct mode and fallbacks', () => {
    test('direct mode: requests go direct; a failure on a known host asks the page to test again', async () => {
        const page = fakePage({ mode: 'direct', ready: false, hosts: SEED });
        const { scope } = makeScope(page, network({ failing: ['images.metahub.space'] }));
        expect((await (await scope.fetch('https://api.strem.io/x')).json()).via).toBe('direct');
        await expect(scope.fetch('https://images.metahub.space/a')).rejects.toThrow(TypeError);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(page.noteDirectFailure).toHaveBeenCalledWith('https://images.metahub.space/a');
    });

    test('proxy mode with the service down: direct, and the configuration is asked again next time', async () => {
        let up = false;
        const page = fakePage(() => (up ? proxyConfig() : { mode: 'proxy', ready: false, hosts: SEED }));
        const { scope } = makeScope(page, network());
        expect((await (await scope.fetch('https://images.metahub.space/a')).json()).via).toBe('direct');
        up = true;
        expect((await (await scope.fetch('https://images.metahub.space/a')).json()).via).toBe('proxy');
        expect(page.config).toHaveBeenCalledTimes(2);
    });

    test('a page without window.__webosTlsProxy: direct', async () => {
        const { scope } = makeScope(null, network());
        expect((await (await scope.fetch('https://images.metahub.space/a')).json()).via).toBe('direct');
    });

    test('installs once', () => {
        const page = fakePage(proxyConfig());
        const { scope } = makeScope(page, network());
        const wrapped = scope.fetch;
        install(scope);
        expect(scope.fetch).toBe(wrapped);
    });
});
