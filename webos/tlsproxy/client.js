// Page side of the tlsproxy (webOS build only; webos/tlsproxy/README.md).
//
// The Chromium 53 of webOS TV 4.x does not trust the ISRG roots, so hosts with Let's Encrypt
// certificates fail (net::ERR_INSECURE_RESPONSE). This module:
// - decides the mode once per firmware: a direct no-cors request to a Let's Encrypt host; if it
//   works the TV already trusts ISRG ('direct', the service is never started), else 'proxy';
// - in 'proxy' mode keeps the tlsproxy service started through a Luna subscription (which keeps
//   it alive), retrying with backoff (1 s, 5 s, 30 s) when it fails or dies;
// - rewrites https URLs of the known Let's Encrypt hosts to http://127.0.0.1:<port>/proxy (proxify),
//   and learns new hosts only when the proxy reports a Let's Encrypt/ISRG issuer.
// Stream URLs never come here: only images (Image.webos.tsx) and the core worker fetch
// (worker.js) use it.
// Everything is asynchronous: start() only reads two small localStorage keys before returning.

export const SERVICE_URI = 'luna://io.github.gabrielsflores.stremio.tlsproxy';
export const MODE_KEY = 'webos.tlsProxy.mode';
export const HOSTS_KEY = 'webos.tlsProxy.hosts';
// Known Let's Encrypt hosts: metahub posters, backgrounds and logos; metahub episode thumbnails
// (episodes.metahub.space redirects to image.tmdb.org, which is Let's Encrypt); TMDB images used
// directly by addons; the debrid-link API.
export const SEED_HOSTS = ['images.metahub.space', 'episodes.metahub.space', 'image.tmdb.org', 'debrid-link.com', 'debrid-link.fr'];
export const PROBE_URL = 'https://images.metahub.space/';
export const ISSUER_HEADER = 'X-Proxy-Issuer-O';
export const RETRY_DELAYS = [1000, 5000, 30000];
export const PROBE_TIMEOUT = 8000;
export const CONFIG_WAIT = 3000;
export const MAX_LEARNED = 64;
export const HEALTH_INTERVAL = 5000;

// host[:port], lower case; at least one dot (no "localhost"), labels of letters, digits and "-".
const HOST = /^(?=[^:]{1,253}(:|$))[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:[0-9]{1,5})?$/;
const LOCAL_HOST = /^(127\.|0\.0\.0\.0(:|$)|\[)/;
const LETS_ENCRYPT = /let'?s encrypt|\bisrg\b|internet security research group/i;

// The host (with the port, if any) of an https URL, or null: other schemes, relative URLs,
// loopback and malformed hosts are never proxied.
export const hostOf = (url) => {
    const match = typeof url === 'string' ? /^https:\/\/([^/?#\\]*)/i.exec(url) : null;
    if (!match) return null;
    const host = match[1].slice(match[1].lastIndexOf('@') + 1).toLowerCase();
    return HOST.test(host) && !LOCAL_HOST.test(host) ? host : null;
};

export const isLetsEncrypt = (issuer) => typeof issuer === 'string' && LETS_ENCRYPT.test(issuer);

export const proxyUrlFor = (port, token, url) => `http://127.0.0.1:${port}/proxy?t=${token}&url=${encodeURIComponent(url)}`;

export const isProxyUrl = (url) => typeof url === 'string' && url.indexOf('http://127.0.0.1:') === 0;

// The URL a proxy URL stands for (proxyUrlFor's inverse, F8.6): what may be kept or compared, without
// the port and the token of this service start. Other URLs come back as they are; a loopback URL that
// is not one of ours gives null (never kept).
export const unproxyUrl = (url) => {
    if (!isProxyUrl(url)) return url;
    const match = /^http:\/\/127\.0\.0\.1:\d+\/proxy\?(?:[^#]*&)?url=([^&#]*)/.exec(url);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch (_e) {
        return null;
    }
};

// deps: storage (localStorage), fetch, getWebOS () => window.webOS, firmware (string),
// online () => boolean, setTimeout, clearTimeout, onToken (token) => void (the token of every
// service start, for the log redaction of webos/lib/redact).
export const createTlsProxy = (deps) => {
    const { storage, fetch, getWebOS, firmware = '', online = () => true } = deps;
    const setTimer = deps.setTimeout || setTimeout;
    const clearTimer = deps.clearTimeout || clearTimeout;

    const state = { mode: 'unknown', ready: false, port: null, token: null, error: null, detectedAt: null };
    const hosts = new Set(SEED_HOSTS);
    let learned = [];
    const checked = new Set();
    const listeners = new Set();
    let version = 0;
    let started = false;
    let redetected = false;
    let request = null;
    let retryTimer = null;
    let failures = 0;
    let starts = 0;

    const emit = () => {
        version += 1;
        listeners.forEach((listener) => listener());
    };
    const subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };
    const getVersion = () => version;

    // localStorage of file:// apps may be shared with other apps: values are validated, and a
    // wrong value only costs availability (a failure re-runs the detection).
    const readJSON = (key) => {
        try {
            return JSON.parse(storage.getItem(key));
        } catch {
            return null;
        }
    };
    const writeJSON = (key, value) => {
        try {
            storage.setItem(key, JSON.stringify(value));
        } catch {
            // storage full or unavailable: the decision is only kept for this session
        }
    };

    const startService = () => {
        if (request || retryTimer || state.mode !== 'proxy') return;
        const webOS = getWebOS();
        if (!webOS || !webOS.service || typeof webOS.service.request !== 'function') {
            state.error = 'webOS.service unavailable';
            emit();
            return;
        }
        starts += 1;
        const current = webOS.service.request(SERVICE_URI, {
            method: 'start',
            parameters: { subscribe: true },
            subscribe: true,
            onSuccess: (response) => {
                if (request !== current) return;
                if (!response || response.returnValue === false || !response.port || !response.token) {
                    serviceDown((response && response.errorText) || 'bad start response');
                    return;
                }
                failures = 0;
                if (deps.onToken) deps.onToken(response.token);
                Object.assign(state, { ready: true, port: response.port, token: response.token, error: null });
                emit();
            },
            onFailure: (error) => {
                if (request !== current) return;
                serviceDown((error && error.errorText) || 'start failed');
            },
        });
        request = current;
    };

    const scheduleRetry = () => {
        if (retryTimer) return;
        const delay = RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length - 1)];
        failures += 1;
        retryTimer = setTimer(() => {
            retryTimer = null;
            startService();
        }, delay);
    };

    // The subscription failed or was dropped (the service died), or the proxy stopped answering.
    function serviceDown(reason) {
        const current = request;
        request = null;
        if (current && typeof current.cancel === 'function') {
            try {
                current.cancel();
            } catch {
                // already closed
            }
        }
        Object.assign(state, { ready: false, error: reason });
        scheduleRetry();
        emit();
    }

    const setMode = (mode) => {
        state.mode = mode;
        state.detectedAt = Date.now();
        if (mode === 'proxy') startService();
        emit();
    };

    // A direct no-cors request: it resolves (opaque) when the TLS handshake works and rejects with
    // a TypeError when the certificate is refused. Offline or slow, the answer is 'proxy' without
    // being kept, so the next start tests again.
    const detect = () => new Promise((resolve) => {
        let done = false;
        const finish = (mode, keep) => {
            if (done) return;
            done = true;
            clearTimer(timer);
            resolve({ mode, keep });
        };
        const timer = setTimer(() => finish('proxy', false), PROBE_TIMEOUT);
        fetch(PROBE_URL, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit' })
            .then(() => finish('direct', true), () => finish('proxy', online()));
    });

    const runDetection = () => detect().then(({ mode, keep }) => {
        if (keep) writeJSON(MODE_KEY, { mode, firmware });
        setMode(mode);
    });

    const start = () => {
        if (started) return;
        started = true;
        const stored = readJSON(HOSTS_KEY);
        learned = (Array.isArray(stored) ? stored : [])
            .filter((host) => typeof host === 'string' && hostOf(`https://${host}/`) === host)
            .slice(-MAX_LEARNED);
        learned.forEach((host) => hosts.add(host));
        const cached = readJSON(MODE_KEY);
        if (cached && cached.firmware === firmware && (cached.mode === 'direct' || cached.mode === 'proxy')) {
            setMode(cached.mode);
        } else {
            runDetection();
        }
    };

    // In 'direct' mode, a failure on a host known to have a Let's Encrypt certificate means the
    // stored decision may be wrong (another app wrote it, or the TV lost trust): test again, once.
    const noteDirectFailure = (url) => {
        if (state.mode !== 'direct' || redetected) return;
        const host = hostOf(url);
        if (!host || !hosts.has(host)) return;
        redetected = true;
        detect().then(({ mode, keep }) => {
            if (mode !== 'proxy') return;
            if (keep) writeJSON(MODE_KEY, { mode, firmware });
            setMode(mode);
        });
    };

    const learn = (host) => {
        if (typeof host !== 'string' || hostOf(`https://${host}/`) !== host || hosts.has(host)) return false;
        hosts.add(host);
        learned = learned.concat(host).slice(-MAX_LEARNED);
        writeJSON(HOSTS_KEY, learned);
        emit();
        return true;
    };

    const ready = () => state.mode === 'proxy' && state.ready;
    const proxyUrl = (url) => (ready() ? proxyUrlFor(state.port, state.token, url) : null);

    // Known hosts cannot load directly in 'proxy' mode: while the mode is being decided or the
    // service is (re)starting, their images wait instead of failing. Not when the service is
    // missing or the short retries (1 s, 5 s) failed too: then the request goes direct and fails
    // like upstream, until the service comes back.
    const waiting = () => state.mode === 'unknown' ||
        (state.mode === 'proxy' && !state.ready && state.error !== 'webOS.service unavailable' && failures < RETRY_DELAYS.length);

    // URL to use for an https resource: the proxy for known hosts in 'proxy' mode, null while the
    // proxy for a known host is pending (the caller shows its placeholder and re-renders on
    // subscribe), else unchanged.
    const proxify = (url) => {
        const host = hostOf(url);
        if (!host || !hosts.has(host)) return url;
        if (ready()) return proxyUrlFor(state.port, state.token, url);
        return waiting() ? null : url;
    };

    // An https URL that failed directly can be tried once through the proxy.
    const canRetry = (url) => ready() && hostOf(url) !== null;

    // After an image loaded through the proxy on retry: one HEAD per host through the proxy tells
    // the certificate issuer; the host is learned only for Let's Encrypt/ISRG (an <img> error
    // may have other causes).
    const learnFromImage = (url) => {
        const host = hostOf(url);
        if (!host || hosts.has(host) || checked.has(host) || !ready()) return;
        checked.add(host);
        fetch(proxyUrl(url), { method: 'HEAD', credentials: 'omit' })
            .then((response) => {
                if (isLetsEncrypt(response.headers.get(ISSUER_HEADER))) learn(host);
            })
            .catch(() => {
                // the image host stays out of the set
            });
    };

    // The worker could not reach the proxy at port/token: the service died (the Luna subscription
    // is not told when the service process exits) or was restarted. If that is still the current
    // service, start it again. Resolves with the configuration once the service is up (or after
    // CONFIG_WAIT).
    const restart = (port, token) => {
        if (ready() && state.port === port && state.token === token) serviceDown('proxy unreachable');
        return waitFor(() => state.mode !== 'proxy' || state.ready);
    };

    // An image through the proxy failed: maybe the image, maybe the service. One /status request
    // (at most every HEALTH_INTERVAL) tells; if the proxy does not answer or no longer knows the
    // token, the service is started again and the images re-render with the new address.
    let checking = false;
    let checkedAt = -Infinity;
    const checkProxy = () => {
        if (!ready() || checking || Date.now() - checkedAt < HEALTH_INTERVAL) return;
        checking = true;
        const { port, token } = state;
        const done = (healthy) => {
            checking = false;
            checkedAt = Date.now();
            if (!healthy && state.port === port && state.token === token && state.ready) serviceDown('proxy unreachable');
        };
        fetch(`http://127.0.0.1:${port}/status?t=${token}`, { credentials: 'omit', cache: 'no-store' })
            .then((response) => done(response.ok), () => done(false));
    };

    const snapshot = () => ({
        mode: state.mode,
        ready: state.ready,
        port: state.port,
        token: state.token,
        hosts: Array.from(hosts),
    });
    // Decided: 'direct', or 'proxy' with the service up or failed (requests then go direct).
    const settled = () => state.mode === 'direct' || (state.mode === 'proxy' && (state.ready || state.error !== null));
    function waitFor(condition) {
        if (condition()) return Promise.resolve(snapshot());
        return new Promise((resolve) => {
            let unsubscribe = null;
            const done = () => {
                clearTimer(timer);
                if (unsubscribe) unsubscribe();
                resolve(snapshot());
            };
            const timer = setTimer(done, CONFIG_WAIT);
            unsubscribe = subscribe(() => {
                if (condition()) done();
            });
        });
    }
    const config = () => waitFor(settled);

    // For diagnostics (F3.6) and the emulator tests: no token.
    const status = () => ({
        mode: state.mode,
        ready: state.ready,
        port: state.port,
        error: state.error,
        firmware,
        detectedAt: state.detectedAt,
        starts,
        failures,
        learned: learned.slice(),
        hosts: Array.from(hosts),
    });

    return {
        start,
        subscribe,
        getVersion,
        proxify,
        proxyUrl,
        canRetry,
        learnFromImage,
        checkProxy,
        noteDirectFailure,
        learn,
        restart,
        config,
        status,
        // What the core worker calls through the page Bridge (window.__webosTlsProxy).
        bridge: { config, learn, restart, noteDirectFailure, status },
    };
};
