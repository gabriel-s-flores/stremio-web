// stremio-core-web for webOS (owner: F1.4).
//
// The Chromium 53 of webOS TV 4.x only runs WebAssembly MVP, so the webOS build uses the MVP core
// vendored in webos/vendor/stremio-core-web (webos/core/README.md) instead of the npm package:
// - `@stremio/stremio-core-web` (the page imports its bridge) resolves to the vendored package;
// - the worker entry is the vendored worker.js;
// - its require('./stremio_core_web_bg.wasm') resolves to webos/core/wasm-module.js, the runtime
//   loader that picks the wasm2js or the WASM core (preferred variant: wasm2js; the
//   `webos.coreVariant` localStorage key switches it);
// - the .wasm and the .wasm2js.js are copied next to worker.js, where the loader looks for them.
// The .wasm2js.js is already minified, with the eager factory parentheses that keep its init at
// ~9 s on the C8 profile: it must not go through Babel or Terser (copied, marked as minimized).
// CoreArtifactsGuard fails the build if a copied file is not byte for byte the vendored one;
// `pnpm webos:check-syntax` checks build-webos/ again (webos/scripts/check-core.js).
// Contract: runs before polyfills.js and only replaces the worker entry path (a string); it
// must not add other modules to config.entry.

const path = require('path');
const { Compilation, WebpackError } = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { ROOT } = require('./utils');
const { VENDOR_DIR, CORE_FILES, sameAsVendor } = require('../scripts/check-core');

const WASM_MODULE = path.join(ROOT, 'webos', 'core', 'wasm-module.js');

class CoreArtifactsGuard {
    constructor(dir) {
        this.dir = dir;
    }

    apply(compiler) {
        const name = this.constructor.name;
        compiler.hooks.thisCompilation.tap(name, (compilation) => {
            // REPORT is the last stage, after Terser (OPTIMIZE_SIZE) had its chance to change them.
            compilation.hooks.processAssets.tap({ name, stage: Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
                CORE_FILES.forEach((file) => {
                    const assetName = path.posix.join(this.dir, file);
                    const asset = compilation.getAsset(assetName);
                    if (!asset) {
                        compilation.errors.push(new WebpackError(`${name}: ${assetName} is missing`));
                    } else if (!sameAsVendor(file, asset.source.buffer())) {
                        compilation.errors.push(new WebpackError(`${name}: ${assetName} differs from webos/vendor/stremio-core-web/${file}`));
                    }
                });
            });
        });
    }
}

module.exports = (config) => {
    if (typeof config.output.filename !== 'string') {
        throw new Error('webos/webpack/core: output.filename must be a string');
    }
    // The worker is emitted as `${COMMIT_HASH}/scripts/worker.js`; the core files go next to it.
    const workerDir = path.posix.dirname(config.output.filename);

    config.resolve.alias = {
        ...config.resolve.alias,
        '@stremio/stremio-core-web': VENDOR_DIR,
        [path.join(VENDOR_DIR, 'stremio_core_web_bg.wasm')]: WASM_MODULE,
    };
    config.entry.worker = path.join(VENDOR_DIR, 'worker.js');

    config.plugins.push(
        new CopyWebpackPlugin({
            patterns: CORE_FILES.map((file) => ({
                from: path.join(VENDOR_DIR, file),
                to: path.posix.join(workerDir, file),
                info: { minimized: true },
            })),
        }),
        new CoreArtifactsGuard(workerDir),
    );

    return config;
};
