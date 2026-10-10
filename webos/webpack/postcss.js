// CSS pipeline for Chromium 53 (owner: F2.1).
//
// Adds two plugins before the base cssnano setup of the .less rule:
//   postcss-preset-env   (chrome 53) autoprefixer, #rrggbbaa, inset, logical properties, and
//                        :focus-visible/:focus-within rewritten to the attributes set by
//                        webos/polyfills/focus.js (Chromium 53 drops a rule with either selector;
//                        the polyfills are loaded by webos/polyfills/index.js).
//   flex-gap-polyfill    `gap` emulated with margins (Chromium 53 has no gap in flexbox), on the
//                        rules marked by ./postcss-apply-fgp (every gap rule but grid ones).
// cssnano's own autoprefixer gets the same target, so it does not strip the prefixes back.
// Plugins are given by name with JSON options: the loader runs inside thread-loader.

const path = require('path');
const { findRule, findLoader } = require('./utils');

const BROWSERS = ['chrome 53'];

const PRESET_ENV = ['postcss-preset-env', {
    browsers: BROWSERS,
    autoprefixer: {
        grid: false,
    },
    features: {
        'focus-visible-pseudo-class': {
            preserve: false,
            replaceWith: '[data-focus-visible-added]',
            disablePolyfillReadyClass: true,
        },
        'focus-within-pseudo-class': {
            preserve: false,
            replaceWith: '[focus-within]',
            disablePolyfillReadyClass: true,
        },
    },
}];

const APPLY_FGP = [path.join(__dirname, 'postcss-apply-fgp.js'), {}];

const FLEX_GAP = ['flex-gap-polyfill', { only: true }];

module.exports = (config) => {
    const postcss = findLoader(findRule(config, 'file.less'), 'postcss-loader');
    const plugins = postcss.options.postcssOptions.plugins;

    const [, cssnanoOptions] = plugins.find(([name]) => name === 'cssnano');
    const [, presetOptions] = cssnanoOptions.preset;
    presetOptions.autoprefixer = { ...presetOptions.autoprefixer, overrideBrowserslist: BROWSERS };

    plugins.unshift(PRESET_ENV, APPLY_FGP, FLEX_GAP);

    return config;
};
