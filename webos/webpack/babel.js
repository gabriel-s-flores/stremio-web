// Transpilation for Chromium 53 (owner: F1.2).
//
// Everything that ends up in a bundle goes through Babel preset-env with target chrome 53:
// - src .js: the base babel-loader with preset-env retargeted (preset-react kept);
// - src .ts/.tsx: babel-loader after ts-loader (ts-loader emits ESNext, e.g. `?.` and `??`);
// - node_modules: a new rule (the base config excludes them), worker and lazy chunks included.
// core-js 3 polyfills are added per usage; what core-js does not cover (ResizeObserver,
// Intl.PluralRules, DOM methods) is F1.3. `pnpm webos:check-syntax` checks the result (ES2016).

const { findRule, findLoader } = require('./utils');

const CORE_JS_VERSION = require('core-js/package.json').version;

const presetEnv = ['@babel/preset-env', {
    targets: 'chrome 53',
    bugfixes: true,
    useBuiltIns: 'usage',
    corejs: CORE_JS_VERSION,
    // queueMicrotask comes from webos/polyfills (F1.3), prefixed to the page and the worker.
    // Otherwise core-js is injected into that very module and installs its own first.
    exclude: ['web.queue-microtask'],
}];

const babelLoader = (presets) => ({
    loader: 'babel-loader',
    options: {
        presets,
        // CommonJS files (most of src and many packages) get `require('core-js/...')` instead of
        // an `import`, which would turn them into ES modules and break `module.exports`.
        sourceType: 'unambiguous',
        cacheDirectory: true,
    },
});

// Polyfilling core-js with itself is circular; @babel/runtime and regenerator-runtime are
// helpers that Babel output may require.
const NOT_TRANSPILED = /[\\/]node_modules[\\/](core-js|@babel[\\/]runtime|regenerator-runtime)[\\/]/;

module.exports = (config) => {
    const jsRule = findRule(config, 'file.js');
    const threadLoader = findLoader(jsRule, 'thread-loader');
    const jsBabel = findLoader(jsRule, 'babel-loader');
    const presets = jsBabel.options.presets.filter((preset) => preset !== '@babel/preset-env');
    Object.assign(jsBabel, babelLoader([presetEnv, ...presets]));

    // Loaders run from last to first: ts-loader, then babel-loader.
    const tsRule = findRule(config, 'file.ts');
    const tsLoaderIndex = tsRule.use.indexOf(findLoader(tsRule, 'ts-loader'));
    tsRule.use.splice(tsLoaderIndex, 0, babelLoader([presetEnv]));

    config.module.rules.push({
        test: /\.[cm]?js$/,
        include: /[\\/]node_modules[\\/]/,
        exclude: NOT_TRANSPILED,
        use: [threadLoader, babelLoader([presetEnv])],
    });

    // The webpack runtime (chunk loading, module wrappers) follows the same target.
    config.target = 'browserslist:chrome 53';

    return config;
};
