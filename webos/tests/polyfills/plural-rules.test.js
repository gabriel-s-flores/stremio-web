const i18next = require('i18next');
const stremioTranslations = require('stremio-translations');
const { install } = require('../../polyfills/plural-rules');
const { selectors, categories } = require('../../polyfills/plural-data');

const languageOf = (locale) => locale === 'pt-PT' ? 'pt-PT' : locale.split('-')[0];

describe('Intl.PluralRules polyfill', () => {
    let PluralRules;

    beforeAll(() => {
        const target = { Intl: { NumberFormat: Intl.NumberFormat } };
        install(target);
        PluralRules = target.Intl.PluralRules;
    });

    test('installs only when missing', () => {
        const target = { Intl: { PluralRules: Intl.PluralRules, NumberFormat: Intl.NumberFormat } };
        install(target);
        expect(target.Intl.PluralRules).toBe(Intl.PluralRules);
    });

    test('creates Intl when it does not exist', () => {
        const target = {};
        install(target);
        expect(typeof target.Intl.PluralRules).toBe('function');
    });

    test('has the data of every language of stremio-translations', () => {
        const locales = Object.keys(stremioTranslations());
        expect(locales.length).toBeGreaterThan(40);
        locales.forEach((locale) => {
            const language = languageOf(locale);
            expect(typeof selectors[language]).toBe('function');
            expect(categories[language].cardinal.length).toBeGreaterThan(0);
            const rules = new PluralRules(locale);
            expect(rules.resolvedOptions().locale).toBe(language);
            expect(rules.resolvedOptions().pluralCategories).toEqual(categories[language].cardinal);
        });
    });

    test('has no data for languages the app does not ship', () => {
        const translated = new Set(Object.keys(stremioTranslations()).map(languageOf));
        Object.keys(selectors).forEach((language) => expect(translated.has(language)).toBe(true));
        expect(Object.keys(selectors).sort()).toEqual(Object.keys(categories).sort());
    });

    test.each([
        ['en-US', [[0, 'other'], [1, 'one'], [2, 'other'], [1.5, 'other']]],
        ['pt-BR', [[0, 'one'], [1, 'one'], [2, 'other']]],
        ['pt-PT', [[0, 'other'], [1, 'one'], [2, 'other']]],
        ['ru-RU', [[1, 'one'], [2, 'few'], [5, 'many'], [21, 'one'], [22, 'few'], [11, 'many'], [1.5, 'other']]],
        ['pl-PL', [[1, 'one'], [2, 'few'], [5, 'many'], [22, 'few'], [12, 'many']]],
        ['ar-AR', [[0, 'zero'], [1, 'one'], [2, 'two'], [3, 'few'], [11, 'many'], [100, 'other']]],
        ['ja-JP', [[0, 'other'], [1, 'other']]],
        ['fr-FR', [[0, 'one'], [1, 'one'], [2, 'other']]],
        ['sl-SL', [[1, 'one'], [2, 'two'], [3, 'few'], [5, 'other']]],
    ])('selects cardinal categories for %s', (locale, cases) => {
        const rules = new PluralRules(locale);
        cases.forEach(([number, category]) => expect([number, rules.select(number)]).toEqual([number, category]));
    });

    test('selects ordinal categories', () => {
        const rules = new PluralRules('en-US', { type: 'ordinal' });
        expect([1, 2, 3, 4, 11, 21, 22].map((number) => rules.select(number)))
            .toEqual(['one', 'two', 'few', 'other', 'other', 'one', 'two']);
        expect(rules.resolvedOptions().type).toBe('ordinal');
    });

    test('rejects an invalid type', () => {
        expect(() => new PluralRules('en', { type: 'x' })).toThrow(RangeError);
    });

    test('falls back to the host locale for unknown languages and supportedLocalesOf filters', () => {
        expect(PluralRules.supportedLocalesOf(['ru-RU', 'xx-XX', 'pt-PT'])).toEqual(['ru-RU', 'pt-PT']);
        expect(new PluralRules('xx-XX').resolvedOptions().locale).toBe('en');
    });

    test('treats Infinity and NaN as other', () => {
        const rules = new PluralRules('en');
        expect(rules.select(Infinity)).toBe('other');
        expect(rules.select(NaN)).toBe('other');
    });
});

// i18next picks the plural suffix of a key with Intl.PluralRules; without it every count would
// resolve to the singular key of the language prefix (or the dummy rule).
describe('i18next with the polyfill instead of the native Intl.PluralRules', () => {
    const native = Intl.PluralRules;
    let instance;

    beforeAll(async () => {
        delete Intl.PluralRules;
        install(global);
        expect(Intl.PluralRules).not.toBe(native);
        instance = i18next.createInstance();
        await instance.init({
            lng: 'ru-RU',
            fallbackLng: 'en-US',
            resources: {
                'ru-RU': { translation: { item_one: '{{count}} штука', item_few: '{{count}} штуки', item_many: '{{count}} штук', item_other: '{{count}} штуки' } },
                'en-US': { translation: { item_one: '{{count}} item', item_other: '{{count}} items' } },
            },
            interpolation: { escapeValue: false },
        });
    });

    afterAll(() => {
        Object.defineProperty(Intl, 'PluralRules', { value: native, writable: true, configurable: true, enumerable: false });
    });

    test('resolves the plural forms of Russian', () => {
        expect([1, 2, 5, 21].map((count) => instance.t('item', { count }))).toEqual(['1 штука', '2 штуки', '5 штук', '21 штука']);
    });

    test('resolves the plural forms of the fallback language', () => {
        expect([1, 2].map((count) => instance.t('item', { count, lng: 'en-US' }))).toEqual(['1 item', '2 items']);
    });
});
