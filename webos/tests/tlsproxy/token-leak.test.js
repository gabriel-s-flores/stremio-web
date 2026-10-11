/**
 * @jest-environment node
 */
/* global describe, it, expect, jest, beforeEach, afterEach */
// F3.7b: the token of the certificate proxy never shows up in a log, in the Player's error
// handling or in the diagnostics report. The scenario is the one of the review of F3.4: an add-on
// subtitle on a Let's Encrypt host goes through the proxy (F5.5), fails, and the Player logs the
// error, whose track holds the proxy URL with the token. Everything between the service answering
// {port, token} and what the user or a log reader can see is the real code; only the browser
// (console, fetch) and the upstream hook are doubles.

const path = require('path');
const fs = require('fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const ROOT = path.join(__dirname, '..', '..', '..');
const TOKEN = '8f14e45fceea167a5a36dedd4bea2543';
const PORT = 47443;
const SUBTITLE = 'https://debrid-link.com/subtitles/pt-BR.srt';

jest.mock('../../../src/routes/Player/useVideo.js', () => {
    const MockEmitter = require('eventemitter3');
    const upstream = {
        events: new MockEmitter(),
        state: { playbackSpeed: 1 },
        load: jest.fn(),
        addExtraSubtitlesTracks: jest.fn(),
        setPlaybackSpeed: jest.fn(),
    };
    const useVideo = () => upstream;
    useVideo.upstream = upstream;
    return useVideo;
});

// The page's tlsproxy: the real client over a Luna double that starts the service with TOKEN, and
// the real registration of the token for the redaction (what webos/tlsproxy/page.js does).
jest.mock('../../tlsproxy/page', () => {
    const { createTlsProxy } = require('../../tlsproxy/client');
    const { addSecret } = require('../../lib/redact');
    const store = { mode: JSON.stringify({ mode: 'proxy', firmware: 'fw' }) };
    const tlsProxy = createTlsProxy({
        storage: { getItem: (key) => (key === 'webos.tlsProxy.mode' ? store.mode : null), setItem: () => null },
        fetch: () => new Promise(() => null),
        getWebOS: () => ({
            service: {
                request: (uri, params) => {
                    // Like Luna: the answer comes after request() returned.
                    Promise.resolve().then(() => params.onSuccess({ returnValue: true, port: 47443, token: '8f14e45fceea167a5a36dedd4bea2543' }));
                    return { cancel() {} };
                },
            },
        }),
        firmware: 'fw',
        onToken: addSecret,
    });
    tlsProxy.start();
    return { __esModule: true, default: tlsProxy };
});

const { installConsoleFilter, redactString } = require('../../lib/redact');
const upstreamVideo = require(path.join(ROOT, 'src/routes/Player/useVideo.js')).upstream;
const useVideo = require(path.join(ROOT, 'src/routes/Player/useVideo.webos.js'));
const diagnostics = require('../../lib/diagnostics');
const diagnosticsRegistry = require('../../lib/diagnostics/registry');
const ERROR = jest.requireActual(path.join(ROOT, 'node_modules/@stremio/stremio-video/src/error.js'));

const renderHook = () => {
    let result = null;
    const Probe = () => {
        result = useVideo();
        return null;
    };
    renderToStaticMarkup(React.createElement(Probe));
    return result;
};

// What a console or a screen reader of the app could show, as one string.
const everything = (calls) => JSON.stringify(calls, (key, value) => (value instanceof Error ? { message: value.message, stack: value.stack } : value));

describe('the proxy token does not leak (F3.7b)', () => {
    let browserConsole = null;
    let received = null;
    let video = null;
    let proxyUrl = null;
    let failedTrack = null;

    beforeEach(async () => {
        await Promise.resolve();
        const calls = [];
        browserConsole = { calls };
        ['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
            browserConsole[method] = (...args) => calls.push({ method, args });
        });
        installConsoleFilter(browserConsole);
        video = renderHook();
        received = [];
        // The Player of the upstream: logs the error, shows its message in a toast (Player.js onError).
        video.events.on('error', (error) => {
            browserConsole.error('Player', error);
            received.push({ message: error.message, error });
        });
        // Add-on subtitles of a Let's Encrypt host: the page asks the tlsproxy for them.
        video.addExtraSubtitlesTracks([{ id: 'addon-por', url: SUBTITLE, fallbackUrl: SUBTITLE, lang: 'por' }]);
        failedTrack = upstreamVideo.addExtraSubtitlesTracks.mock.calls[0][0][0];
        proxyUrl = failedTrack.url;
    });

    afterEach(() => {
        upstreamVideo.events.removeAllListeners();
        upstreamVideo.addExtraSubtitlesTracks.mockClear();
        diagnosticsRegistry.reset();
    });

    it('the page registers the token the service answers, so even the bare token is masked', () => {
        expect(redactString(`token ${TOKEN}`)).toBe('token ***');
    });

    it('the subtitle really goes through the proxy with the token (the scenario is the leaky one)', () => {
        expect(proxyUrl).toBe(`http://127.0.0.1:${PORT}/proxy?t=${TOKEN}&url=${encodeURIComponent(SUBTITLE)}`);
    });

    it('the failed subtitle error reaches the Player masked, and so does the console.error of the Player', () => {
        // stremio-video withHTMLSubtitles: reportSubtitleError()
        upstreamVideo.events.emit('error', Object.assign({}, ERROR.WITH_HTML_SUBTITLES.LOAD_FAILED, {
            error: new Error('404 (Not Found)'),
            track: failedTrack,
            critical: false,
        }));
        expect(received).toHaveLength(1);
        expect(received[0].message).toBe('Failed to load external subtitles');
        expect(everything(received)).not.toContain(TOKEN);
        expect(everything(browserConsole.calls)).not.toContain(TOKEN);
        // still tells which subtitle failed
        expect(browserConsole.calls[0].args[1].track.url).toContain(encodeURIComponent(SUBTITLE));
        expect(browserConsole.calls[0].args[1].track.lang).toBe('por');
    });

    it('a critical error and a message with the URL are masked too', () => {
        upstreamVideo.events.emit('error', { code: 2, message: `Fetch failed: ${proxyUrl}`, critical: true, error: new TypeError(`Failed to fetch ${proxyUrl}`) });
        expect(everything(received)).not.toContain(TOKEN);
        expect(everything(browserConsole.calls)).not.toContain(TOKEN);
    });

    it('the console masks it when the log does not go through the Player (any module, any argument shape)', () => {
        browserConsole.error('Video:', new Error(`boom ${proxyUrl}`));
        browserConsole.warn(`[subtitles] ${proxyUrl}`);
        browserConsole.log({ tracks: [failedTrack] }, [proxyUrl]);
        browserConsole.info('%s', JSON.stringify(failedTrack));
        browserConsole.debug(encodeURIComponent(proxyUrl));
        expect(browserConsole.calls).toHaveLength(5);
        expect(everything(browserConsole.calls)).not.toContain(TOKEN);
    });

    it('the diagnostics report, shown, copied and saved, has no token whatever a section puts in it', async () => {
        diagnosticsRegistry.registerSection('certificateProxy', 'Certificate proxy', () => ({
            mode: 'proxy', lastUrl: proxyUrl, bare: TOKEN, nested: { track: failedTrack },
        }));
        diagnosticsRegistry.registerSection('subtitles', 'Subtitles', () => ({ error: `failed ${proxyUrl}` }));
        const report = await diagnostics.collectDiagnostics({
            window: { navigator: {}, localStorage: { getItem: () => null }, screen: {}, innerWidth: 1, innerHeight: 1, core: undefined },
            request: () => undefined,
            timeoutMs: 5,
            readCapabilities: () => Promise.resolve({ available: false }),
        });
        const text = diagnostics.formatReport(report);
        expect(JSON.stringify(report)).not.toContain(TOKEN);
        expect(text).not.toContain(TOKEN);
        // the report still says the proxy section ran
        expect(text).toContain('[Certificate proxy]');
        expect(text).toContain('/proxy?t=***&url=');
    });

    it('the formatted text is masked even if a row comes from somewhere unexpected', () => {
        const text = diagnostics.formatReport({
            generatedAt: 'now',
            sections: [{ title: 'X', rows: [['url', proxyUrl], ['bare', `token ${TOKEN}`]] }],
        });
        expect(text).not.toContain(TOKEN);
    });
});

describe('the installation is in place (a guard against someone removing it)', () => {
    const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

    it('the console filter is the first import of the page entry and of the worker entry', () => {
        expect(read('webos/tlsproxy/page.js')).toMatch(/import '\.\.\/lib\/redact\/install';\s*import \{ addSecret \} from '\.\.\/lib\/redact';\s*import \{ createTlsProxy \} from '\.\/client';/);
        expect(read('webos/tlsproxy/worker-entry.js')).toMatch(/import '\.\.\/lib\/redact\/install';\s*import \{ install \} from '\.\/worker';/);
        expect(read('webos/tlsproxy/page.js')).toContain('onToken: addSecret');
        expect(read('webos/tlsproxy/worker.js')).toContain('addSecret(value.token);');
        expect(read('webos/lib/redact/install.js')).toContain('installConsoleFilter(console)');
    });

    it('the upstream Player still logs the error object it receives (the leak this masks)', () => {
        expect(read('src/routes/Player/Player.js')).toMatch(/console\.error\('Player', error\);/);
        expect(read('src/routes/Player/Player.js')).toMatch(/video\.events\.on\('error', onError\);/);
    });

    it('the stremio-video subtitle error carries the track', () => {
        const source = read('node_modules/@stremio/stremio-video/src/withHTMLSubtitles/withHTMLSubtitles.js');
        expect(source).toMatch(/function reportSubtitleError\(error, track\) \{\s*onError\(Object\.assign\(\{\}, ERROR\.WITH_HTML_SUBTITLES\.LOAD_FAILED, \{\s*error: error,\s*track: track,/);
    });
});
