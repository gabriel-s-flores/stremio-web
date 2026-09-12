const fs = require('fs');
const vm = require('vm');
const { createObservability, sanitize } = require('../src/webos/diagnostics/observability');
const config = { dsn: 'http://synthetic@localhost:8197/37', version: '1.2.3', commit: 'a'.repeat(40), protocol: 'http:' };
const mockSdk = () => ({ init: jest.fn(), globalHandlersIntegration: jest.fn(() => ({})), captureException: jest.fn(), flush: jest.fn(() => Promise.resolve(true)), makeFetchTransport: jest.fn() });

test.each([undefined, null, '', ' ', 'invalid', 'https://key:password@host/1'])('absent/invalid DSN case %# never loads SDK', async dsn => {
    const adapter = createObservability(), load = jest.fn();
    adapter.initialize({ ...config, dsn }, load);
    adapter.capture(new Error('secret'));
    expect(await adapter.flush()).toBe(false);
    expect(load).not.toHaveBeenCalled();
});
test('initialization is idempotent and identity is set before capture', () => {
    const adapter = createObservability(), sdk = mockSdk();
    adapter.initialize(config, () => sdk);
    adapter.initialize(config, () => sdk);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init.mock.calls[0][0]).toMatchObject({ release: 'webos-1.2.3', dist: config.commit, sendDefaultPii: false, autoSessionTracking: false, sendClientReports: false, defaultIntegrations: false, initialScope: { tags: { platform: 'webos', mode: 'hosted' } } });
    expect(JSON.stringify(adapter.getSnapshot())).not.toContain('synthetic');
});
test('allowlist drops arbitrary account text, URLs, cookies, authorization and content', () => {
    const secret = 'account Alice private token=secret https://addon.example/path?login=secret#cookie';
    const event = { event_id: 'b'.repeat(32), message: secret, user: { id: secret }, request: { url: secret, cookies: secret, headers: { Authorization: secret } }, extra: { secret }, contexts: { secret }, breadcrumbs: [{ message: secret }], tags: { secret }, exception: { values: [{ type: secret, value: secret, stacktrace: { frames: [{ filename: secret, function: secret, vars: { secret }, lineno: 42, colno: 9 }] } }] } };
    const clean = sanitize(event, { platform: 'webos', release: 'webos-1', dist: config.commit });
    expect(JSON.stringify(clean)).not.toContain('secret');
    expect(clean.exception.values[0]).toMatchObject({ type: 'Error', stacktrace: { frames: [{ filename: '<redacted>', lineno: 42, colno: 9 }] } });
    expect(sanitize({ message: secret }, {})).toBeNull();
});
test('SDK load/init failures let the real entrypoint continue', () => {
    const entry = fs.readFileSync(require.resolve('../src/index.js'), 'utf8').split('const Bowser')[0];
    for (const load of [() => { throw Error('secret'); }, () => ({ init: () => { throw Error('secret'); }, globalHandlersIntegration: () => ({}) })]) {
        const adapter = createObservability();
        const boot = { continued: false };
        vm.runInNewContext(entry + '\nboot.continued = true;', {
            boot, process: { env: { WEBOS: true } },
            require: () => ({ initialize: () => adapter.initialize(config, load) }),
        });
        expect(boot.continued).toBe(true);
        expect(adapter.getSnapshot()).toMatchObject({ sentryEnabled: false, initState: 'sdk-runtime-failed', failureKind: 'sdk-init' });
    }
});
test.each(['reject', 'throw', 'http'])('transport %s is isolated and distinguished', async kind => {
    const adapter = createObservability(), sdk = mockSdk();
    sdk.makeFetchTransport.mockReturnValue({ send: () => { if (kind === 'throw') throw Error('secret'); return kind === 'reject' ? Promise.reject(Error('secret')) : Promise.resolve({ statusCode: 503 }); }, flush: () => true });
    adapter.initialize(config, () => sdk);
    const transport = sdk.init.mock.calls[0][0].transport({});
    await expect(transport.send([{}, [[{ type: 'event' }, { exception: { values: [{ type: 'Error' }] } }]]])).resolves.toBeDefined();
    expect(adapter.getSnapshot()).toMatchObject({ initState: 'initialized', failureKind: 'transport', transportState: 'transport-blocked' });
    expect(sdk.makeFetchTransport.mock.calls[0][0].fetchOptions).toEqual({ credentials: 'omit', referrerPolicy: 'no-referrer' });
});
test('capture and flush failures are contained', async () => {
    const adapter = createObservability(), sdk = mockSdk();
    sdk.captureException.mockImplementation(() => { throw Error('secret'); });
    sdk.flush.mockRejectedValue(Error('secret'));
    adapter.initialize(config, () => sdk);
    expect(() => adapter.capture(Error('secret'))).not.toThrow();
    expect(adapter.getSnapshot().failureKind).toBe('sdk-capture');
    expect(await adapter.flush()).toBe(false);
    expect(adapter.getSnapshot().failureKind).toBe('flush');
});
test('transport removes envelope trace, attachments and SDK-added account context', async () => {
    const adapter = createObservability(), sdk = mockSdk(), send = jest.fn(() => Promise.resolve({ statusCode: 200 }));
    sdk.makeFetchTransport.mockReturnValue({ send });
    adapter.initialize(config, () => sdk);
    const transport = sdk.init.mock.calls[0][0].transport({});
    await transport.send([{ trace: { user: 'secret' }, dsn: 'secret' }, [
        [{ type: 'event', secret: 'secret' }, { event_id: 'a'.repeat(32), user: { id: 'secret' }, exception: { values: [{ type: 'TypeError', value: 'secret' }] } }],
        [{ type: 'attachment' }, 'secret'], [{ type: 'session' }, { secret: 'secret' }],
    ]]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0][1]).toHaveLength(1);
    expect(JSON.stringify(send.mock.calls[0][0])).not.toContain('secret');
    expect(adapter.getSnapshot().transportState).toBe('accepted');
});
test('desktop entrypoint preserves exact Sentry configuration without loading webOS', () => {
    const source = fs.readFileSync(require.resolve('../src/index.js'), 'utf8').split("const Bowser")[0];
    const sdk = mockSdk(), requireMock = jest.fn(() => sdk);
    vm.runInNewContext(source, { process: { env: { SENTRY_DSN: config.dsn, WEBOS: false } }, require: requireMock });
    expect(requireMock).toHaveBeenCalledWith('@sentry/browser');
    expect(requireMock).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith({ dsn: config.dsn });
});
