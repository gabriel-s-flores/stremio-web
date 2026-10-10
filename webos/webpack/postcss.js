// CSS pipeline for Chromium 53 (owner: F2.1).
//
// Extension point (helpers in ./utils): change the postcss-loader of the .less rule, e.g.
//   const postcss = findLoader(findRule(config, 'file.less'), 'postcss-loader');
//   postcss.options.postcssOptions.plugins.unshift(['postcss-preset-env', { browsers: 'chrome 53' }]);
// Today it is a no-op: the base cssnano setup is used as is.

module.exports = (config) => {
    return config;
};
