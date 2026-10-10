// Stubs and aliases of the webOS bundle trimming (webos/webpack/trim.js).

const fs = require('fs');
const trim = require('../webpack/trim');

const aliases = trim({ resolve: { alias: { stremio: 'src' } } }).resolve.alias;
const stub = (request) => require(aliases[request]);

describe('webos trim', () => {
    test('keeps the existing aliases and points every stub at an existing file', () => {
        expect(aliases.stremio).toBe('src');
        ['hls.js$', '@stremio/libass-wasm$', '@stremio/libass-wasm/dist/js/subtitles-octopus-assets$', '@sentry/browser$', 'workbox-window$']
            .forEach((request) => expect(fs.existsSync(aliases[request])).toBe(true));
    });

    test('hls.js stub reports HLS as unsupported without throwing on import', () => {
        const Hls = stub('hls.js$');
        expect(Hls.isSupported()).toBe(false);
        expect(Hls.Events).toEqual({});
        expect(() => new Hls()).toThrow();
    });

    test('libass stub fails on construction so assRenderer falls back to plain subtitles', () => {
        const SubtitlesOctopus = stub('@stremio/libass-wasm$');
        expect(() => new SubtitlesOctopus({})).toThrow(/libass/);
        const assets = stub('@stremio/libass-wasm/dist/js/subtitles-octopus-assets$');
        expect(assets).toEqual(expect.objectContaining({ workerSource: '', legacyWorkerSource: '', defaultFont: '' }));
    });

    test('sentry stub init is a no-op', () => {
        expect(stub('@sentry/browser$').init({ dsn: 'https://example.invalid/1' })).toBeUndefined();
    });
});
