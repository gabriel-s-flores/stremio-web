// Stubs and aliases of the webOS bundle trimming (webos/webpack/trim.js).

const fs = require('fs');
const trim = require('../webpack/trim');

const aliases = trim({ resolve: { alias: { stremio: 'src' } } }).resolve.alias;
const stub = (request) => require(aliases[request]);

describe('webos trim', () => {
    test('keeps the existing aliases and points every stub at an existing file', () => {
        expect(aliases.stremio).toBe('src');
        ['hls.js$', '@stremio/libass-wasm$', '@stremio/libass-wasm/dist/js/subtitles-octopus-assets$', '@sentry/browser$', 'workbox-window$', 'stremio-translations$']
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

    describe('stremio-translations stub (F7.2)', () => {
        const { lazyLanguages } = require('../stubs/stremio-translations');
        const i18next = require('i18next');
        const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
        const instance = async (languages) => {
            const i18n = i18next.createInstance();
            await i18n.init({ resources: { 'en-US': { translation: { HELLO: 'Hello' } } }, lng: 'en-US', fallbackLng: 'en-US' });
            const loads = [];
            const load = (language) => {
                loads.push(language);
                return languages[language] ? Promise.resolve(languages[language]) : Promise.reject(new Error('no file'));
            };
            return { i18n, loads, lazy: lazyLanguages(i18n, load) };
        };

        test('bundles only en-US, with the same shape as the package', () => {
            const translations = stub('stremio-translations$')();
            expect(Object.keys(translations)).toEqual(['en-US']);
            expect(translations['en-US']).toEqual(require('stremio-translations/en-US.json'));
        });

        test('loads a language once when i18next switches to it, then shows it', async () => {
            const { i18n, loads } = await instance({ 'pt-BR': { HELLO: 'Olá' } });
            const changes = [];
            i18n.on('languageChanged', (language) => changes.push(language));
            await i18n.changeLanguage('pt-BR');
            expect(i18n.t('HELLO')).toBe('Hello');
            await flush();
            expect(i18n.t('HELLO')).toBe('Olá');
            expect(changes).toEqual(['pt-BR', 'pt-BR']);
            await i18n.changeLanguage('en-US');
            await i18n.changeLanguage('pt-BR');
            await flush();
            expect(loads).toEqual(['pt-BR']);
        });

        test('a code without a file keeps en-US, and a language left before its chunk arrives is not shown', async () => {
            const { i18n, loads } = await instance({ 'de-DE': { HELLO: 'Hallo' } });
            await i18n.changeLanguage('eng');
            await flush();
            expect(i18n.t('HELLO')).toBe('Hello');
            await i18n.changeLanguage('de-DE');
            await i18n.changeLanguage('en-US');
            await flush();
            expect(i18n.language).toBe('en-US');
            expect(i18n.hasResourceBundle('de-DE', 'translation')).toBe(true);
            expect(loads).toEqual(['eng', 'de-DE']);
        });
    });
});
