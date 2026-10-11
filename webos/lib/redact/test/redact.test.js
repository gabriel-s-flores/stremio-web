const EventEmitter = require('eventemitter3');
const {
    MASK, addSecret, clearSecrets, redactString, redactValue, redactArgs, installConsoleFilter, withRedactedErrors,
} = require('..');

const TOKEN = '0123456789abcdef0123456789abcdef';
const OTHER_TOKEN = 'fedcba9876543210fedcba9876543210';
const SUBTITLE = 'https://debrid-link.com/subs/pt-BR.srt';
const PROXY_URL = `http://127.0.0.1:47443/proxy?t=${TOKEN}&url=${encodeURIComponent(SUBTITLE)}`;

afterEach(() => clearSecrets());

describe('redactString', () => {
    it('masks the token of a proxy URL and keeps the rest', () => {
        expect(redactString(PROXY_URL)).toBe(`http://127.0.0.1:47443/proxy?t=${MASK}&url=${encodeURIComponent(SUBTITLE)}`);
        expect(redactString(`GET http://127.0.0.1:47444/status?t=${TOKEN} failed`)).toBe(`GET http://127.0.0.1:47444/status?t=${MASK} failed`);
    });

    it('masks a token of any shape in the proxy path, also one that no one registered', () => {
        expect(redactString('http://127.0.0.1:1/proxy?t=Abc_def-123&url=x')).toBe(`http://127.0.0.1:1/proxy?t=${MASK}&url=x`);
    });

    it('masks every proxy URL of a text, and a proxy URL encoded as a query value', () => {
        const text = `${PROXY_URL} then ${PROXY_URL.replace(TOKEN, OTHER_TOKEN)}`;
        expect(redactString(text)).not.toMatch(/[0-9a-f]{32}/);
        const encoded = `#/x/${encodeURIComponent(PROXY_URL)}`;
        expect(redactString(encoded)).not.toContain(TOKEN);
        expect(decodeURIComponent(redactString(encoded))).toContain(`/proxy?t=${MASK}&url=`);
        expect(redactString(JSON.stringify({ track: { url: PROXY_URL } }))).not.toContain(TOKEN);
    });

    it('masks a t=<32 hex> parameter whatever the order of the parameters', () => {
        expect(redactString(`http://127.0.0.1:1/proxy?url=x&t=${TOKEN}`)).toBe(`http://127.0.0.1:1/proxy?url=x&t=${MASK}`);
    });

    it('masks a registered token wherever it appears, and forgets none until cleared', () => {
        addSecret('hunter2-secret');
        expect(redactString('token=hunter2-secret;hunter2-secret')).toBe(`token=${MASK};${MASK}`);
        expect(redactString('nothing here')).toBe('nothing here');
    });

    it('ignores secrets too short to be a token, and keeps only the latest ones', () => {
        addSecret('abc');
        expect(redactString('abc')).toBe('abc');
        for (let i = 0; i < 20; i++) addSecret(`secret-number-${i}`);
        expect(redactString('secret-number-0 secret-number-19')).toBe(`secret-number-0 ${MASK}`);
    });

    it('leaves ordinary text and URLs alone', () => {
        const texts = [
            '',
            'Player',
            'https://images.metahub.space/poster/medium/tt0111161/img',
            'https://example.com/?t=1234&url=/proxy',
            'https://example.com/proxy?t=notmine',
            `https://example.com/page?id=${TOKEN}`,
        ];
        texts.forEach((text) => expect(redactString(text)).toBe(text === 'https://example.com/proxy?t=notmine' ? `https://example.com/proxy?t=${MASK}` : text));
        expect(redactString(42)).toBe(42);
        expect(redactString(undefined)).toBe(undefined);
    });
});

describe('redactValue', () => {
    it('returns the very same reference when there is nothing to mask', () => {
        const value = { code: 70, message: 'Failed', nested: [{ a: 1 }, 'text'], error: new Error('boom') };
        expect(redactValue(value)).toBe(value);
        const list = [1, 'two', { three: 3 }];
        expect(redactValue(list)).toBe(list);
        expect(redactValue(null)).toBe(null);
        expect(redactValue(7)).toBe(7);
    });

    it('masks the failed subtitle track of an error and copies only that branch', () => {
        const stream = { name: 'x' };
        const error = {
            code: 70,
            message: 'Failed to load external subtitles',
            critical: false,
            error: new Error('404 (Not Found)'),
            track: { id: 'addon-por', url: PROXY_URL, fallbackUrl: PROXY_URL, lang: 'por' },
            stream,
        };
        const clean = redactValue(error);
        expect(clean).not.toBe(error);
        expect(JSON.stringify(clean)).not.toContain(TOKEN);
        expect(clean.track.url).toBe(`http://127.0.0.1:47443/proxy?t=${MASK}&url=${encodeURIComponent(SUBTITLE)}`);
        expect(clean.track.lang).toBe('por');
        expect(clean.stream).toBe(stream);
        expect(clean.error).toBe(error.error);
        // the original object is not touched
        expect(error.track.url).toBe(PROXY_URL);
    });

    it('masks the message and the stack of an error, and keeps its name and extra properties', () => {
        const error = new TypeError(`Failed to fetch ${PROXY_URL}`);
        error.code = 'E_FETCH';
        error.url = PROXY_URL;
        const clean = redactValue(error);
        expect(clean).toBeInstanceOf(Error);
        expect(clean.name).toBe('TypeError');
        expect(clean.code).toBe('E_FETCH');
        expect(`${clean.message}\n${clean.stack}\n${clean.url}`).not.toContain(TOKEN);
        expect(clean.message).toContain(`/proxy?t=${MASK}&url=`);
        expect(error.message).toContain(TOKEN);
    });

    it('masks arrays and objects that hold the URL, in the middle of a longer text', () => {
        const clean = redactValue(['x', { list: [`failed: ${PROXY_URL} (404)`] }]);
        expect(JSON.stringify(clean)).not.toContain(TOKEN);
        expect(clean[1].list[0]).toMatch(/^failed: http:\/\/127\.0\.0\.1:47443\/proxy\?t=\*\*\*&url=.* \(404\)$/);
    });

    it('survives cycles, getters that throw and values it does not look into', () => {
        const cyclic = { url: PROXY_URL };
        cyclic.self = cyclic;
        expect(() => redactValue(cyclic)).not.toThrow();
        const hostile = {};
        Object.defineProperty(hostile, 'boom', { enumerable: true, get() { throw new Error('nope'); } });
        hostile.url = PROXY_URL;
        expect(redactValue(hostile).url).toContain(MASK);
        const buffer = new Uint8Array(4);
        const fn = () => PROXY_URL;
        const map = new Map([['u', PROXY_URL]]);
        expect(redactValue(buffer)).toBe(buffer);
        expect(redactValue(fn)).toBe(fn);
        expect(redactValue(map)).toBe(map);
    });

    it('is bounded: a huge object costs a bounded amount of work', () => {
        const big = {};
        for (let i = 0; i < 100000; i++) big[`k${i}`] = { v: i };
        const start = Date.now();
        redactValue(big);
        expect(Date.now() - start).toBeLessThan(250);
    });

    it('looks as deep as asked for (the diagnostics report)', () => {
        let deep = { url: PROXY_URL };
        for (let i = 0; i < 20; i++) deep = { child: deep };
        expect(JSON.stringify(redactValue(deep))).toContain(TOKEN);
        expect(JSON.stringify(redactValue(deep, { maxDepth: 40, maxNodes: 1000 }))).not.toContain(TOKEN);
    });
});

describe('console filter', () => {
    const fakeConsole = () => {
        const calls = [];
        const target = {};
        ['log', 'info', 'warn', 'error', 'debug', 'trace', 'assert', 'dir', 'table', 'group', 'groupCollapsed'].forEach((method) => {
            target[method] = function(...args) {
                calls.push({ method, self: this, args });
            };
        });
        return { target, calls };
    };

    it('masks the arguments of every console method before the browser sees them', () => {
        const { target, calls } = fakeConsole();
        expect(installConsoleFilter(target)).toBe(true);
        const error = { code: 70, track: { url: PROXY_URL } };
        target.error('Player', error);
        target.warn(PROXY_URL);
        target.log('%s failed', `GET ${PROXY_URL}`, new Error(PROXY_URL));
        target.info(...[PROXY_URL, PROXY_URL]);
        target.debug({ nested: [PROXY_URL] });
        target.assert(false, PROXY_URL);
        expect(calls.map((call) => call.method)).toEqual(['error', 'warn', 'log', 'info', 'debug', 'assert']);
        calls.forEach((call) => {
            expect(String(call.args.map((arg) => (arg instanceof Error ? `${arg.message}${arg.stack}` : typeof arg === 'string' ? arg : JSON.stringify(arg))))).not.toContain(TOKEN);
        });
        expect(calls[0].args[0]).toBe('Player');
        expect(calls[0].args[1].track.url).toContain(`t=${MASK}`);
        // the caller's object is not changed
        expect(error.track.url).toBe(PROXY_URL);
    });

    it('passes the same arguments, in the same console, when there is nothing to mask', () => {
        const { target, calls } = fakeConsole();
        installConsoleFilter(target);
        const object = { a: 1 };
        target.log('hello', object, 3);
        expect(calls[0].self).toBe(target);
        expect(calls[0].args[1]).toBe(object);
        expect(calls[0].args).toHaveLength(3);
    });

    it('masks a registered token that is not in a proxy URL, and installs once', () => {
        const { target, calls } = fakeConsole();
        installConsoleFilter(target);
        expect(installConsoleFilter(target)).toBe(false);
        addSecret(OTHER_TOKEN);
        target.log({ port: 47443, token: OTHER_TOKEN });
        expect(JSON.stringify(calls[0].args)).not.toContain(OTHER_TOKEN);
        expect(calls).toHaveLength(1);
    });

    it('works when the method is called detached from the console', () => {
        const { target, calls } = fakeConsole();
        installConsoleFilter(target);
        const { error } = target;
        error(PROXY_URL);
        expect(calls[0].args[0]).not.toContain(TOKEN);
    });

    it('does nothing for a missing console', () => {
        expect(installConsoleFilter(undefined)).toBe(false);
    });
});

describe('withRedactedErrors', () => {
    it('gives the listeners of "error" a masked payload, and leaves the other events alone', () => {
        const emitter = new EventEmitter();
        const events = withRedactedErrors(emitter);
        const onError = jest.fn();
        const onEnded = jest.fn();
        events.on('error', onError);
        events.on('ended', onEnded);
        const payload = { message: 'Failed', track: { url: PROXY_URL } };
        emitter.emit('error', payload);
        emitter.emit('ended', payload);
        expect(JSON.stringify(onError.mock.calls)).not.toContain(TOKEN);
        expect(onEnded.mock.calls[0][0]).toBe(payload);
    });

    it('takes the right listener out with off()', () => {
        const emitter = new EventEmitter();
        const events = withRedactedErrors(emitter);
        const listener = jest.fn();
        events.on('error', listener);
        expect(emitter.listenerCount('error')).toBe(1);
        events.off('error', listener);
        expect(emitter.listenerCount('error')).toBe(0);
        emitter.emit('error', { message: 'x' });
        expect(listener).not.toHaveBeenCalled();
    });

    it('keeps the emit of the original emitter', () => {
        const emitter = new EventEmitter();
        const events = withRedactedErrors(emitter);
        const listener = jest.fn();
        emitter.on('error', listener);
        events.emit('error', 1);
        expect(listener).toHaveBeenCalledWith(1);
    });
});

describe('redactArgs', () => {
    it('returns the same arguments object when nothing changes', () => {
        const args = ['a', 1, { b: 2 }];
        expect(redactArgs(args)).toBe(args);
    });
});
