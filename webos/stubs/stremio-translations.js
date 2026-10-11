// stremio-translations in the webOS build (F7.2): the package requires the strings of every language
// at once, 6.3 MB of the 9.4 MB main.js that the TV parses before the core starts. Here only en-US
// (the startup and fallback language of src/index.js) is bundled; any other language is a chunk of
// its own, loaded when i18next switches to it (App.js calls changeLanguage with the profile's
// interfaceLanguage). Same keys as the package: a language without a file falls back to en-US, as
// upstream. While the chunk loads, the screen shows en-US; when it arrives, changeLanguage runs again
// so react-i18next re-renders.

const i18n = require('i18next');
const enUS = require('stremio-translations/en-US.json');

const NAMESPACE = 'translation';

// Every file of the package named like a language (xx-XX.json), one chunk each. The folder comes by
// its own alias (webos/webpack/trim.js): "stremio-translations" itself resolves to this stub.
const loadLanguage = (language) => {
    const files = require.context('stremio-translations-languages', false, /^\.\/[a-z]{2}-[A-Z]{2}\.json$/, 'lazy');
    return files(`./${language}.json`).then((module) => module.default || module);
};

// The code i18next looks the strings up by: it formats the code it was given (the profile has "bn-Bd",
// the package file and the i18next lookup are "bn-BD"), as upstream, where every language is loaded.
const lookupCode = (instance, language) => {
    const utils = instance.services && instance.services.languageUtils;
    return utils && typeof utils.formatLanguageCode === 'function' ? utils.formatLanguageCode(language) : language;
};

// Listens to the language changes of an i18next instance and adds the strings of the new language
// before showing it. load(code) resolves to the strings, or rejects when there is no such file.
const lazyLanguages = (instance, load) => {
    const pending = new Map();
    const onLanguageChanged = (language) => {
        if (typeof language !== 'string') return;
        const code = lookupCode(instance, language);
        if (code === 'en-US' || pending.has(code) || instance.hasResourceBundle(code, NAMESPACE)) return;
        const loading = Promise.resolve()
            .then(() => load(code))
            .then((strings) => {
                instance.addResourceBundle(code, NAMESPACE, strings, true, true);
                if (instance.language === language) instance.changeLanguage(language);
            }, () => {
                // No file for this code (e.g. "eng"): en-US stays, as upstream.
            });
        pending.set(code, loading);
    };
    instance.on('languageChanged', onLanguageChanged);
    return { pending, off: () => instance.off('languageChanged', onLanguageChanged) };
};

lazyLanguages(i18n, loadLanguage);

module.exports = function() {
    return { 'en-US': enUS };
};

module.exports.lazyLanguages = lazyLanguages;
