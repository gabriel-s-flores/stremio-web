// The core in the webOS build: webos/webpack/core.js (aliases, worker entry, copied files and the
// build guard) and webos/scripts/check-core.js (the guard of build-webos/ in webos:check-syntax).

const fs = require('fs');
const os = require('os');
const path = require('path');
const webpack = require('webpack');
const core = require('../webpack/core');
const { VENDOR_DIR, CORE_FILES, eagerProblems, checkBuild } = require('../scripts/check-core');

const ROOT = path.resolve(__dirname, '..', '..');
const WASM2JS = path.join(VENDOR_DIR, 'stremio_core_web_bg.wasm2js.js');

// The shape wasm2js-finish.js writes, with and without the eager parentheses.
const umd = (factory) => `!function(A,e){"object"==typeof module&&module.exports?module.exports=e():A.x=e()}(this,${factory});`;
const EAGER_INLINE = umd('(function(){var a=1;return (function asmFunc(i){return a})})');
const EAGER_NAMED = umd('(function(){var asmFunc=(function asmFunc(i){return 1});return asmFunc})');

const baseConfig = () => ({
    entry: { main: './src/index.js', worker: './node_modules/@stremio/stremio-core-web/worker.js' },
    output: { filename: 'abc123/scripts/[name].js' },
    resolve: { alias: { stremio: 'src' } },
    plugins: [],
});

describe('webos/scripts/check-core eager factory', () => {
    test('accepts the vendored wasm2js', () => {
        expect(eagerProblems(fs.readFileSync(WASM2JS, 'utf8'))).toEqual([]);
    }, 30000);

    test('accepts both shapes of asmFunc', () => {
        expect(eagerProblems(EAGER_INLINE)).toEqual([]);
        expect(eagerProblems(EAGER_NAMED)).toEqual([]);
    });

    test('rejects a file without the parentheses', () => {
        expect(eagerProblems(umd('function(){return (function asmFunc(i){return 1})}'))).toEqual(['the factory is not wrapped in parentheses']);
        expect(eagerProblems(umd('(function(){return function asmFunc(i){return 1}})'))).toEqual(['asmFunc (returned by the factory) is not wrapped in parentheses']);
        expect(eagerProblems(umd('(function(){function asmFunc(i){return 1}return asmFunc})'))).toEqual(['asmFunc (returned by the factory) is not wrapped in parentheses']);
    });

    test('rejects the file after a Terser pass (what a re-minifying packager does)', async () => {
        const terser = require(require.resolve('terser', { paths: [path.dirname(require.resolve('terser-webpack-plugin'))] }));
        const { code } = await terser.minify(EAGER_INLINE);
        expect(eagerProblems(code)).not.toEqual([]);
    });
});

describe('webos/scripts/check-core build folder', () => {
    let dir;
    const scripts = () => path.join(dir, 'abc123', 'scripts');

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-core-'));
        fs.mkdirSync(scripts(), { recursive: true });
        fs.writeFileSync(path.join(scripts(), 'worker.js'), '');
        CORE_FILES.forEach((file) => fs.copyFileSync(path.join(VENDOR_DIR, file), path.join(scripts(), file)));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('passes with the vendored files next to worker.js', () => {
        const { problems, lines } = checkBuild(dir);
        expect(problems).toEqual([]);
        expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('== vendor'), expect.stringContaining('eager factory ok')]));
    }, 30000);

    test('fails when a file changed by one byte', () => {
        const file = path.join(scripts(), 'stremio_core_web_bg.wasm');
        const bytes = fs.readFileSync(file);
        bytes[bytes.length - 1] ^= 1;
        fs.writeFileSync(file, bytes);
        fs.writeFileSync(path.join(scripts(), 'stremio_core_web_bg.wasm2js.js'), EAGER_INLINE);
        expect(checkBuild(dir).problems).toEqual([
            'stremio_core_web_bg.wasm differs from webos/vendor/stremio-core-web/stremio_core_web_bg.wasm',
            'stremio_core_web_bg.wasm2js.js differs from webos/vendor/stremio-core-web/stremio_core_web_bg.wasm2js.js',
        ]);
    });

    test('fails when the eager parentheses are gone', () => {
        fs.writeFileSync(path.join(scripts(), 'stremio_core_web_bg.wasm2js.js'), umd('function(){return function asmFunc(){}}'));
        expect(checkBuild(dir).problems).toEqual(expect.arrayContaining(['stremio_core_web_bg.wasm2js.js: the factory is not wrapped in parentheses']));
    });

    test('fails when a file is missing or not next to worker.js', () => {
        fs.renameSync(path.join(scripts(), 'stremio_core_web_bg.wasm'), path.join(dir, 'stremio_core_web_bg.wasm'));
        fs.rmSync(path.join(scripts(), 'stremio_core_web_bg.wasm2js.js'));
        expect(checkBuild(dir).problems).toEqual([
            'expected stremio_core_web_bg.wasm only next to worker.js (abc123/scripts/stremio_core_web_bg.wasm), found: stremio_core_web_bg.wasm',
            'expected stremio_core_web_bg.wasm2js.js only next to worker.js (abc123/scripts/stremio_core_web_bg.wasm2js.js), found: none',
        ]);
    });
});

describe('webos/webpack/core', () => {
    test('points the package and the worker entry at the vendored core', () => {
        const config = core(baseConfig());
        expect(config.resolve.alias).toEqual({
            stremio: 'src',
            '@stremio/stremio-core-web': VENDOR_DIR,
            [path.join(VENDOR_DIR, 'stremio_core_web_bg.wasm')]: path.join(ROOT, 'webos', 'core', 'wasm-module.js'),
        });
        expect(config.entry).toEqual({ main: './src/index.js', worker: path.join(VENDOR_DIR, 'worker.js') });
        expect(fs.existsSync(config.entry.worker)).toBe(true);
        expect(require.resolve('@stremio/stremio-core-web/bridge', { paths: [ROOT] })).toBeTruthy();
    });

    test('copies the core files next to the worker, marked as minimized (no Terser)', () => {
        const [copy] = core(baseConfig()).plugins;
        expect(copy.constructor.name).toBe('CopyPlugin');
        expect(copy.patterns).toEqual(CORE_FILES.map((file) => ({
            from: path.join(VENDOR_DIR, file),
            to: `abc123/scripts/${file}`,
            info: { minimized: true },
        })));
    });

    // A real compilation with the guard. CopyWebpackPlugin loads globby with import(), which jest
    // does not run, so a stand-in emits the copies the same way (same stage, same info); `change`
    // edits them on the way. The worker entry is an empty module.
    const compile = (change) => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'core-build-'));
        const entry = path.join(out, 'empty.js');
        fs.writeFileSync(entry, '');
        const config = core({ ...baseConfig(), mode: 'production', context: ROOT, output: { path: out, filename: 'abc123/scripts/[name].js' } });
        config.entry = { worker: entry };
        const [copy] = config.plugins;
        config.plugins[0] = {
            apply: (compiler) => compiler.hooks.thisCompilation.tap('CopyStandIn', (compilation) => {
                compilation.hooks.processAssets.tap({ name: 'CopyStandIn', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
                    copy.patterns.forEach(({ from, to, info }) => {
                        const bytes = change(path.basename(from), fs.readFileSync(from));
                        if (bytes) compilation.emitAsset(to, new webpack.sources.RawSource(bytes), info);
                    });
                });
            }),
        };
        return new Promise((resolve, reject) => {
            webpack(config, (err, stats) => {
                fs.rmSync(out, { recursive: true, force: true });
                if (err) reject(err);
                else resolve(stats.compilation.errors.map((error) => error.message));
            });
        });
    };

    test('the build guard passes with the files as copied', async () => {
        expect(await compile((_file, bytes) => bytes)).toEqual([]);
    }, 60000);

    test('the build guard fails the build when a copied file changed or is missing', async () => {
        const change = (file, bytes) => {
            if (file.endsWith('.wasm')) return null;
            return Buffer.concat([bytes, Buffer.from(';')]);
        };
        expect(await compile(change)).toEqual([
            'CoreArtifactsGuard: abc123/scripts/stremio_core_web_bg.wasm is missing',
            'CoreArtifactsGuard: abc123/scripts/stremio_core_web_bg.wasm2js.js differs from webos/vendor/stremio-core-web/stremio_core_web_bg.wasm2js.js',
        ]);
    }, 60000);
});
