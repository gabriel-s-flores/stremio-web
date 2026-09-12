// Copyright (C) 2017-2026 Smart code 203358507

const enabled = (value) => value === true || value === 'true' || value === '1';
const errorTypes = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError'];

// Free-form messages and frame names can contain account data. Never forward them.
const sanitize = (event, identity) => {
    const values = event.exception && event.exception.values;
    if (!Array.isArray(values) || !values.length) {
        return null;
    }
    return {
        event_id: /^[a-f0-9]{32}$/.test(event.event_id) ? event.event_id : undefined,
        platform: 'javascript',
        level: 'error',
        release: identity.release,
        dist: identity.dist,
        tags: { ...identity },
        exception: { values: values.slice(0, 5).map((value) => ({
            type: errorTypes.includes(value.type) ? value.type : 'Error',
            value: 'Application exception (details withheld)',
            stacktrace: { frames: ((value.stacktrace && value.stacktrace.frames) || []).slice(-40).map((frame) => ({
                // Coordinates remain useful with the release/dist build artifacts.
                filename: /(?:^|\/)scripts\/(main|vendor)\.js(?:[?#].*)?$/.test(frame.filename || '')
                    ? (frame.filename.match(/scripts\/(main|vendor)\.js/)[0]) : '<redacted>',
                lineno: Number.isInteger(frame.lineno) && frame.lineno > 0 ? frame.lineno : undefined,
                colno: Number.isInteger(frame.colno) && frame.colno > 0 ? frame.colno : undefined,
            })) },
        })) },
    };
};

const createObservability = () => {
    let attempted = false;
    let sdk;
    let identity = {};
    const state = { sentryEnabled: false, provider: 'sentry', release: null, dist: null,
        initState: 'not-configured', failureKind: null, transportState: 'idle' };
    const fail = (kind) => { state.failureKind = kind; };
    const initialize = (config = {}, loadSdk = () => require('@sentry/browser')) => {
        if (attempted) {
            return;
        }
        attempted = true;
        const dsn = config.dsn === undefined ? process.env.SENTRY_DSN : config.dsn;
        state.release = 'webos-' + (config.version || process.env.VERSION || 'unknown');
        state.dist = config.commit || process.env.COMMIT_HASH || 'unknown';
        identity = { platform: 'webos', release: state.release, dist: state.dist,
            webos_debug: enabled(process.env.WEBOS_DEBUG) };
        const protocol = config.protocol || (typeof window !== 'undefined' && window.location.protocol);
        if (protocol === 'file:') {
            identity.mode = 'packaged';
        } else if (protocol === 'http:' || protocol === 'https:') {
            identity.mode = 'hosted';
        }
        if (typeof dsn !== 'string' || !dsn.trim()) {
            return;
        }
        // No password, query, fragment or whitespace; final path segment is a project id.
        if (!/^https?:\/\/[a-zA-Z0-9]+@[a-zA-Z0-9.-]+(?::\d+)?\/(?:[a-zA-Z0-9_-]+\/)*\d+$/.test(dsn)) {
            state.initState = 'invalid-config';
            return;
        }
        try {
            sdk = loadSdk();
            sdk.init({
                dsn, release: state.release, dist: state.dist,
                sendDefaultPii: false, autoSessionTracking: false, sendClientReports: false,
                defaultIntegrations: false, integrations: [sdk.globalHandlersIntegration()],
                initialScope: { tags: identity },
                beforeBreadcrumb: () => null,
                beforeSend: (event) => sanitize(event, identity),
                transport: (options) => {
                    const transport = sdk.makeFetchTransport({ ...options,
                        fetchOptions: { credentials: 'omit', referrerPolicy: 'no-referrer' } });
                    return {
                        send: (envelope) => {
                            try {
                                // SDK envelope metadata and attachments are outside beforeSend.
                                const items = envelope[1].filter((item) => item[0].type === 'event')
                                    .map((item) => [{ type: 'event' }, sanitize(item[1], identity)])
                                    .filter((item) => item[1]);
                                if (!items.length) {
                                    return Promise.resolve({});
                                }
                                const safeEnvelope = [{ event_id: items[0][1].event_id }, items];
                                return Promise.resolve(transport.send(safeEnvelope)).then((response) => {
                                    state.transportState = response && response.statusCode >= 200 && response.statusCode < 300
                                        ? 'accepted' : 'transport-blocked';
                                    if (state.transportState === 'transport-blocked') {
                                        fail('transport');
                                    }
                                    return response;
                                }, () => {
                                    state.transportState = 'transport-blocked';
                                    fail('transport');
                                    return {};
                                });
                            } catch (_) {
                                state.transportState = 'transport-blocked';
                                fail('transport');
                                return Promise.resolve({});
                            }
                        },
                        flush: (timeout) => transport.flush(timeout),
                    };
                },
            });
            state.sentryEnabled = true;
            state.initState = 'initialized';
        } catch (_) {
            state.initState = 'sdk-runtime-failed';
            fail('sdk-init');
        }
    };
    const capture = (error) => {
        if (state.sentryEnabled) {
            try {
                sdk.captureException(error);
            } catch (_) {
                fail('sdk-capture');
            }
        }
    };
    const flush = (timeout = 2000) => {
        if (!state.sentryEnabled) {
            return Promise.resolve(false);
        }
        try {
            return Promise.resolve(sdk.flush(timeout)).then((result) => {
                if (!result) {
                    fail('flush');
                }
                return !!result;
            }, () => { fail('flush'); return false; });
        } catch (_) {
            fail('flush');
            return Promise.resolve(false);
        }
    };
    return { initialize, capture, flush, getSnapshot: () => ({ ...state }) };
};

module.exports = { ...createObservability(), createObservability, sanitize };
