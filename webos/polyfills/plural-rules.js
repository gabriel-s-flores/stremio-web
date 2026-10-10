// Intl.PluralRules for Chromium 53 (webOS TV 4.x), which has Intl but not PluralRules.
// i18next builds one per language to pick the plural suffix of a key.
// The implementation is eemeli's intl-pluralrules; the rules come from plural-data.js
// (only the app languages) instead of the package's own bundle with every locale.

import getPluralRules from 'intl-pluralrules/factory';
import { selectors, categories } from './plural-data';

// Intl.PluralRules#selectRange is not used by the app: the factory gets a stub for it.
const getRangeSelector = () => () => 'other';

export const install = (global) => {
    if (!global.Intl) {
        global.Intl = {};
    }
    if (typeof global.Intl.PluralRules === 'function') {
        return;
    }
    const PluralRules = getPluralRules(
        global.Intl.NumberFormat,
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

