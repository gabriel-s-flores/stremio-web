// CSS pipeline for Chromium 53 (owner: F2.1).
//
// Adds its plugins before the base cssnano setup of the .less rule:
//   postcss-preset-env   (chrome 53) autoprefixer, #rrggbbaa, inset, logical properties, and
//                        :focus-visible/:focus-within rewritten to the attributes set by
//                        webos/polyfills/focus.js (Chromium 53 drops a rule with either selector;
//                        the polyfills are loaded by webos/polyfills/index.js).
//   flex-gap-polyfill    `gap` emulated with margins (Chromium 53 has no gap in flexbox), on the
//                        rules marked by ./postcss-apply-fgp (every gap rule but grid ones).
//   postcss-fgp-pointer-events  turns the pointer-events flex-gap-polyfill adds into switches that
//                        the Button component sets, so buttons with a gap take clicks on their
//                        whole box and disabled ones none (./postcss-fgp-pointer-events.js).
//   postcss-math-functions  min()/max()/clamp() replaced by the argument that wins on a 1920x1080 TV,
//                        Chromium 53 drops a declaration that has one (./postcss-math-functions.js, F2.4);
//                        first, so the other plugins never see the raw functions.
//   postcss-fallbacks    sticky, backdrop-filter, aspect-ratio, env() and dvh/svh/lvh rewritten into what
//                        Chromium 53 handles (F2.5), before the others see the CSS (./postcss-fallbacks.js).
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

const MATH_FUNCTIONS = [path.join(__dirname, 'postcss-math-functions.js'), {}];

const FLEX_GAP = ['flex-gap-polyfill', { only: true }];

// Buttons that are polyfilled flex containers take clicks again (F1.6): see the plugin.
const FGP_POINTER_EVENTS = [path.join(__dirname, 'postcss-fgp-pointer-events.js'), {}];

const FALLBACKS = [path.join(__dirname, 'postcss-fallbacks.js'), {}];

module.exports = (config) => {
    const postcss = findLoader(findRule(config, 'file.less'), 'postcss-loader');
    const plugins = postcss.options.postcssOptions.plugins;

    const [, cssnanoOptions] = plugins.find(([name]) => name === 'cssnano');
    const [, presetOptions] = cssnanoOptions.preset;
    presetOptions.autoprefixer = { ...presetOptions.autoprefixer, overrideBrowserslist: BROWSERS };

    plugins.unshift(MATH_FUNCTIONS, FALLBACKS, PRESET_ENV, APPLY_FGP, FLEX_GAP, FGP_POINTER_EVENTS);

    return config;
};
