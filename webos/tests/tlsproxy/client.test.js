/**
 * @jest-environment node
 */
// webos/tlsproxy/client.js: mode detection and its cache, the service subscription with backoff,
// proxify and the hosts learned.

import {
    createTlsProxy, hostOf, isLetsEncrypt, MODE_KEY, HOSTS_KEY, SERVICE_URI, PROBE_URL, MAX_LEARNED, proxyUrlFor, unproxyUrl,
} from '../../tlsproxy/client';

const POSTER = 'https://images.metahub.space/poster/medium/tt0111161/img';

const memoryStorage = (initial = {}) => {
    const data = { ...initial };
    return {
        data,
        getItem: (key) => (key in data ? data[key] : null),
        setItem: (key, value) => {
            data[key] = String(value);
        },
    };
};

const fakeWebOS = () => {
    const requests = [];
    return {
        requests,
        last: () => requests[requests.length - 1],
        service: {
            request: (uri, params) => {
                const request = { uri, params, cancelled: false, cancel() { this.cancelled = true; } };
                requests.push(request);
                return request;
            },
        },
    };
};

const setup = ({ storage = memoryStorage(), probe = 'fail', webOS = fakeWebOS(), firmware = 'fw1', online = true, fetchImpl } = {}) => {
    const fetch = jest.fn(fetchImpl || ((url) => {
        if (url === PROBE_URL) return probe === 'ok' ? Promise.resolve({}) : probe === 'hang' ? new Promise(() => undefined) : Promise.reject(new TypeError('Failed to fetch'));
        return Promise.reject(new TypeError('unexpected fetch ' + url));
    }));
    const tlsProxy = createTlsProxy({
        storage, fetch, getWebOS: () => webOS, firmware, online: () => online,
        setTimeout, clearTimeout,
    });
    return { tlsProxy, storage, fetch, webOS };
};

const ready = (webOS, port = 47443, token = 'tok') => webOS.last().params.onSuccess({ returnValue: true, port, token });
const tick = (ms = 0) => jest.advanceTimersByTimeAsync(ms);

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('hostOf', () => {
    test.each([
        [POSTER, 'images.metahub.space'],
        ['https://Debrid-Link.com/api', 'debrid-link.com'],
        ['https://example.com:8443/x', 'example.com:8443'],
        ['https://user:pw@example.com/x', 'example.com'],
        ['https://httpbin.org@postman-echo.com/x', 'postman-echo.com'],
        ['http://images.metahub.space/x', null],
        ['/relative/path', null],
        ['file:///media/developer/apps/x.wasm', null],
        ['https://127.0.0.1:47443/x', null],
        ['https://localhost/x', null],
        ['https://[::1]/x', null],
        ['https://bad_host.com/x', null],
        ['https://-bad.com/x', null],
        [undefined, null],
    ])('%s → %s', (url, host) => {
        expect(hostOf(url)).toBe(host);
    });

    test('isLetsEncrypt', () => {
        expect(isLetsEncrypt("Let's Encrypt")).toBe(true);
        expect(isLetsEncrypt('ISRG')).toBe(true);
        expect(isLetsEncrypt('Google Trust Services')).toBe(false);
        expect(isLetsEncrypt(null)).toBe(false);
    });
});

describe('mode detection', () => {
    test('direct when the TV trusts ISRG: kept per firmware, the service never starts', async () => {
        const { tlsProxy, storage, fetch, webOS } = setup({ probe: 'ok' });
        tlsProxy.start();
        await tick();
        expect(fetch).toHaveBeenCalledWith(PROBE_URL, expect.objectContaining({ mode: 'no-cors', method: 'HEAD' }));
        expect(tlsProxy.status().mode).toBe('direct');
        expect(JSON.parse(storage.data[MODE_KEY])).toEqual({ mode: 'direct', firmware: 'fw1' });
        expect(webOS.requests).toHaveLength(0);
        expect(tlsProxy.proxify(POSTER)).toBe(POSTER);
        expect(tlsProxy.canRetry(POSTER)).toBe(false);
    });

    test('proxy when the certificate is refused: the service starts with a subscription', async () => {
        const { tlsProxy, storage, webOS } = setup();
        tlsProxy.start();
        await tick();
        expect(tlsProxy.status().mode).toBe('proxy');
        expect(JSON.parse(storage.data[MODE_KEY])).toEqual({ mode: 'proxy', firmware: 'fw1' });
        expect(webOS.requests).toHaveLength(1);
        expect(webOS.last().uri).toBe(SERVICE_URI);
        expect(webOS.last().params).toEqual(expect.objectContaining({ method: 'start', subscribe: true, parameters: { subscribe: true } }));
    });

    test('the stored decision is used for the same firmware, without a probe', async () => {
        const storage = memoryStorage({ [MODE_KEY]: JSON.stringify({ mode: 'proxy', firmware: 'fw1' }) });
        const { tlsProxy, fetch, webOS } = setup({ storage, probe: 'ok' });
        tlsProxy.start();
        expect(fetch).not.toHaveBeenCalled();
        expect(tlsProxy.status().mode).toBe('proxy');
        expect(webOS.requests).toHaveLength(1);
    });

    test('another firmware (or a bogus stored value) runs the probe again', async () => {
        for (const stored of [{ mode: 'proxy', firmware: 'fw0' }, { mode: 'evil', firmware: 'fw1' }, 'not json']) {
            const storage = memoryStorage({ [MODE_KEY]: typeof stored === 'string' ? stored : JSON.stringify(stored) });
            const { tlsProxy, fetch } = setup({ storage, probe: 'ok' });
            tlsProxy.start();
            await tick();
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(tlsProxy.status().mode).toBe('direct');
        }
    });

    test('offline or without an answer: proxy for this session only', async () => {
        const offline = setup({ online: false });
        offline.tlsProxy.start();
        await tick();
        expect(offline.tlsProxy.status().mode).toBe('proxy');
        expect(offline.storage.data[MODE_KEY]).toBeUndefined();

        const hanging = setup({ probe: 'hang' });
        hanging.tlsProxy.start();
        await tick(7999);
        expect(hanging.tlsProxy.status().mode).toBe('unknown');
        await tick(1);
        expect(hanging.tlsProxy.status().mode).toBe('proxy');
        expect(hanging.storage.data[MODE_KEY]).toBeUndefined();
    });

    test('a stored "direct" is tested again when a known Let\'s Encrypt host fails', async () => {
        const storage = memoryStorage({ [MODE_KEY]: JSON.stringify({ mode: 'direct', firmware: 'fw1' }) });
        const { tlsProxy, fetch, webOS } = setup({ storage });
        tlsProxy.start();
        tlsProxy.noteDirectFailure('https://unknown-host.com/x.jpg');
        expect(fetch).not.toHaveBeenCalled();
        tlsProxy.noteDirectFailure(POSTER);
        tlsProxy.noteDirectFailure(POSTER);
        await tick();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(tlsProxy.status().mode).toBe('proxy');
        expect(webOS.requests).toHaveLength(1);
        expect(JSON.parse(storage.data[MODE_KEY]).mode).toBe('proxy');
    });
});

describe('service and proxify', () => {
    test('proxify rewrites only known hosts, once the service is ready', async () => {
        const { tlsProxy, webOS } = setup();
        tlsProxy.start();
        expect(tlsProxy.proxify(POSTER)).toBeNull();
        await tick();
        expect(tlsProxy.proxify(POSTER)).toBeNull();
        expect(tlsProxy.proxify('https://api.strem.io/x')).toBe('https://api.strem.io/x');
        const listener = jest.fn();
        tlsProxy.subscribe(listener);
        ready(webOS, 47444, 'abc');
        expect(listener).toHaveBeenCalled();
        expect(tlsProxy.proxify(POSTER)).toBe(`http://127.0.0.1:47444/proxy?t=abc&url=${encodeURIComponent(POSTER)}`);
        expect(tlsProxy.proxify('https://api.strem.io/x')).toBe('https://api.strem.io/x');
        expect(tlsProxy.proxify('http://images.metahub.space/x')).toBe('http://images.metahub.space/x');
        expect(tlsProxy.canRetry('https://other.example.com/x.jpg')).toBe(true);
        expect(tlsProxy.canRetry('http://other.example.com/x.jpg')).toBe(false);
        expect(tlsProxy.status()).not.toHaveProperty('token');
    });

    test('start failures retry with backoff 1 s, 5 s, 30 s, 30 s; success resets it', async () => {
        const { tlsProxy, webOS } = setup();
        tlsProxy.start();
        await tick();
        const fail = () => webOS.last().params.onFailure({ returnValue: false, errorText: 'Service does not exist' });
        fail();
        expect(tlsProxy.status().error).toBe('Service does not exist');
        for (const delay of [1000, 5000, 30000, 30000]) {
            const before = webOS.requests.length;
            await tick(delay - 1);
            expect(webOS.requests).toHaveLength(before);
            await tick(1);
            expect(webOS.requests).toHaveLength(before + 1);
            fail();
        }
        await tick(30000);
        ready(webOS);
        expect(tlsProxy.status()).toEqual(expect.objectContaining({ ready: true, failures: 0, error: null }));
    });

    test('known hosts wait while the service starts, and go direct once the short retries (1 s, 5 s) ran out', async () => {
        const { tlsProxy, webOS } = setup();
        tlsProxy.start();
        await tick();
        const fail = () => webOS.last().params.onFailure({ errorText: 'Service does not exist' });
        for (const delay of [1000, 5000]) {
            fail();
            expect(tlsProxy.proxify(POSTER)).toBeNull();
            await tick(delay);
        }
        fail();
        expect(tlsProxy.proxify(POSTER)).toBe(POSTER);
        await tick(30000);
        ready(webOS);
        expect(tlsProxy.proxify(POSTER)).toMatch(/^http:\/\/127\.0\.0\.1:47443\/proxy/);
    });

    test('without webOS.service known hosts go direct (no endless wait)', async () => {
        const { tlsProxy } = setup({ webOS: null });
        tlsProxy.start();
        await tick();
        expect(tlsProxy.proxify(POSTER)).toBe(POSTER);
    });

    test('a start answer without port or token counts as a failure', async () => {
        const { tlsProxy, webOS } = setup();
        tlsProxy.start();
        await tick();
        webOS.last().params.onSuccess({ returnValue: false, errorText: 'listen failed: EADDRINUSE' });
        expect(tlsProxy.status()).toEqual(expect.objectContaining({ ready: false, error: 'listen failed: EADDRINUSE' }));
        expect(webOS.last().cancelled).toBe(true);
    });

    test('restart: the subscription is dropped and started again; config waits for the new port', async () => {
        const { tlsProxy, webOS } = setup();
        tlsProxy.start();
        await tick();
        ready(webOS, 47443, 'old');
        const first = webOS.last();
        const pending = tlsProxy.restart(47443, 'old');
        expect(first.cancelled).toBe(true);
        expect(tlsProxy.proxify(POSTER)).toBeNull();
        await tick(1000);
        expect(webOS.requests).toHaveLength(2);
        ready(webOS, 47445, 'new');
        const config = await pending;
        expect(config).toEqual(expect.objectContaining({ mode: 'proxy', ready: true, port: 47445, token: 'new' }));
        // callbacks of the dropped request are ignored
        first.params.onFailure({ errorText: 'late' });
        expect(tlsProxy.status().ready).toBe(true);
    });

    test('restart for a stale port/token (already restarted) keeps the current service', async () => {
        const { tlsProxy, webOS } = setup();
        tlsProxy.start();
        await tick();
        ready(webOS, 47446, 'current');
        const config = await tlsProxy.restart(47443, 'old');
        expect(config).toEqual(expect.objectContaining({ ready: true, port: 47446, token: 'current' }));
        expect(webOS.requests).toHaveLength(1);
        expect(webOS.last().cancelled).toBe(false);
    });

    test('checkProxy: a proxy that does not answer (or lost the token) is started again; a healthy one is left alone', async () => {
        let healthy = true;
        const fetchImpl = (url) => {
            if (url === PROBE_URL) return Promise.reject(new TypeError('Failed to fetch'));
            expect(url).toBe('http://127.0.0.1:47443/status?t=tok');
            return healthy ? Promise.resolve({ ok: true }) : Promise.reject(new TypeError('Failed to fetch'));
        };
        const { tlsProxy, webOS, fetch } = setup({ fetchImpl });
        tlsProxy.start();
        await tick();
        ready(webOS);
        tlsProxy.checkProxy();
        tlsProxy.checkProxy();
        await tick();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(tlsProxy.status().ready).toBe(true);
        healthy = false;
        tlsProxy.checkProxy();
        await tick();
        expect(fetch).toHaveBeenCalledTimes(2);
        await tick(5000);
        tlsProxy.checkProxy();
        await tick();
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(tlsProxy.status()).toEqual(expect.objectContaining({ ready: false, error: 'proxy unreachable' }));
        expect(webOS.last().cancelled).toBe(true);
        await tick(1000);
        expect(webOS.requests).toHaveLength(2);
        ready(webOS, 47447, 'tok2');
        expect(tlsProxy.proxify(POSTER)).toMatch(/^http:\/\/127\.0\.0\.1:47447\/proxy\?t=tok2&/);
    });

    test('config waits up to 3 s for an undecided mode', async () => {
        const { tlsProxy } = setup({ probe: 'hang' });
        tlsProxy.start();
        let config = null;
        tlsProxy.config().then((value) => {
            config = value;
        });
        await tick(2999);
        expect(config).toBeNull();
        await tick(1);
        expect(config).toEqual(expect.objectContaining({ mode: 'unknown', ready: false }));
    });

    test('without webOS.service the proxy mode settles with an error (requests go direct)', async () => {
        const { tlsProxy } = setup({ webOS: null });
        tlsProxy.start();
        await tick();
        const config = await tlsProxy.config();
        expect(config).toEqual(expect.objectContaining({ mode: 'proxy', ready: false }));
        expect(tlsProxy.status().error).toBe('webOS.service unavailable');
    });
});

describe('learned hosts', () => {
    test('learn validates and persists; stored hosts are validated on start', async () => {
        const storage = memoryStorage({
            [HOSTS_KEY]: JSON.stringify(['good.example.com', 'BAD..host', 42, 'evil.com/path', '127.0.0.1', 'x.y:8443']),
        });
        const { tlsProxy, webOS } = setup({ storage });
        tlsProxy.start();
        await tick();
        ready(webOS);
        expect(tlsProxy.status().learned).toEqual(['good.example.com', 'x.y:8443']);
        expect(tlsProxy.proxify('https://good.example.com/a.jpg')).toMatch(/^http:\/\/127\.0\.0\.1:47443\/proxy/);
        expect(tlsProxy.learn('new.example.org')).toBe(true);
        expect(tlsProxy.learn('new.example.org')).toBe(false);
        expect(tlsProxy.learn('not a host')).toBe(false);
        expect(JSON.parse(storage.data[HOSTS_KEY])).toEqual(['good.example.com', 'x.y:8443', 'new.example.org']);
    });

    test(`at most ${MAX_LEARNED} learned hosts are kept (the newest)`, async () => {
        const { tlsProxy, storage } = setup();
        tlsProxy.start();
        for (let i = 0; i <= MAX_LEARNED; i++) tlsProxy.learn(`h${i}.example.com`);
        const stored = JSON.parse(storage.data[HOSTS_KEY]);
        expect(stored).toHaveLength(MAX_LEARNED);
        expect(stored[0]).toBe('h1.example.com');
    });

    test('learnFromImage: one HEAD per host through the proxy; learned only for a Let\'s Encrypt issuer', async () => {
        const issuers = { 'le.example.com': "Let's Encrypt", 'gts.example.com': 'Google Trust Services' };
        const fetchImpl = (url, init) => {
            if (url === PROBE_URL) return Promise.reject(new TypeError('Failed to fetch'));
            const target = decodeURIComponent(url.split('&url=')[1]);
            expect(init.method).toBe('HEAD');
            return Promise.resolve({ headers: { get: (name) => (name === 'X-Proxy-Issuer-O' ? issuers[hostOf(target)] : null) } });
        };
        const { tlsProxy, fetch, webOS } = setup({ fetchImpl });
        tlsProxy.start();
        await tick();
        ready(webOS);
        tlsProxy.learnFromImage('https://le.example.com/a.jpg');
        tlsProxy.learnFromImage('https://le.example.com/b.jpg');
        tlsProxy.learnFromImage('https://gts.example.com/a.jpg');
        tlsProxy.learnFromImage('https://gts.example.com/b.jpg');
        await tick();
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(tlsProxy.status().learned).toEqual(['le.example.com']);
    });
});

describe('unproxyUrl (F8.6)', () => {
    it('gives back the URL a proxy URL stands for, and leaves other URLs alone', () => {
        expect(unproxyUrl(proxyUrlFor(47443, 'tok3n', POSTER))).toBe(POSTER);
        expect(unproxyUrl(proxyUrlFor(47443, 'tok3n', 'https://x.example/a?b=1&c=%2F'))).toBe('https://x.example/a?b=1&c=%2F');
        expect(unproxyUrl(POSTER)).toBe(POSTER);
        expect(unproxyUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
        expect(unproxyUrl(null)).toBeNull();
    });

    it('keeps nothing of a loopback URL that is not a proxy URL', () => {
        expect(unproxyUrl('http://127.0.0.1:47443/proxy?t=tok3n')).toBeNull();
        expect(unproxyUrl('http://127.0.0.1:47443/other?t=tok3n&url=x')).toBeNull();
        expect(unproxyUrl('http://127.0.0.1:47443/proxy?t=tok3n&url=%E0%A4%A')).toBeNull();
    });
});
