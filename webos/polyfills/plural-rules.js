// Intl.PluralRules for Chromium 53 (webOS TV 4.x), which has Intl but not PluralRules.
// i18next builds one per language to pick the plural suffix of a key.
// The implementation is eemeli's intl-pluralrules; the rules come from plural-data.js
// (only the app languages) instead of the package's own bundle with every locale.

import getPluralRules from 'intl-pluralrules/factory';
import { selectors, categories } from './plural-data';

// Intl.PluralRules#selectRange is not used by the app: the factory gets a stub for it.
const getRangeSelector = () => () => 'other';

// Same lookup as the factory: drop subtags until a language with rules is found.
const hasRules = (locale) => {
    for (let tag = locale; tag; tag = tag.replace(/-?[^-]*$/, '')) {
        if (selectors[tag]) return true;
    }
    return false;
};

// When no requested locale has rules, the factory takes the host locale from `new NumberFormat()`.
// If the TV's locale has none either, it ends up with no rules and throws a TypeError, so the
// host locale given to it falls back to English.
const withEnglishHost = (NumberFormat) => function(locales, options) {
    if (locales === undefined) {
        const host = new NumberFormat().resolvedOptions().locale;
        return new NumberFormat(hasRules(host) ? host : 'en', options);
    }
    return new NumberFormat(locales, options);
};

export const install = (global) => {
    if (!global.Intl) {
        global.Intl = {};
    }
    if (typeof global.Intl.PluralRules === 'function') {
        return;
    }
    const PluralRules = getPluralRules(
        withEnglishHost(global.Intl.NumberFormat),
        (locale) => selectors[locale],
        (locale, ordinal) => categories[locale][ordinal ? 'ordinal' : 'cardinal'],
        getRangeSelector
    );
    Object.defineProperty(global.Intl, 'PluralRules', {
        value: PluralRules,
        writable: true,
        configurable: true,
        enumerable: false
    });
};
