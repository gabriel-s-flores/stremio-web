const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const webpack = require('webpack');
const { runChecks } = require('es-check');

// Avoid prewarming every CPU just by importing the config. Build loaders stay real.
jest.mock('thread-loader', () => ({ ...jest.requireActual('thread-loader'), warmup: jest.fn() }));

const createConfig = require('../webpack.config');
const packageJson = require('../package.json');

const isExcluded = (exclude, resourcePath) => (
    typeof exclude === 'function' ? exclude(resourcePath) : exclude.test(resourcePath)
);

const source = `
class Probe {
    static fallback = 'fallback';
    value = 42;
    read(input) {
        return input?.nested?.value ?? Probe.fallback;
    }
}
module.exports = { Probe };
`;
const typedSource = `${source}
const typedProbe: Probe = new Probe();
module.exports.typedValue = typedProbe.value;
`;
const fixtures = [
    ['js', source],
    ['ts', typedSource],
    ['tsx', `${typedSource}\nmodule.exports.element = <span>{new Probe().read(null)}</span>;`],
];

let directory;

beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-webos-transpilation-'));
});

afterAll(() => {
    fs.rmSync(directory, { recursive: true, force: true });
});

test.each([
    ['optional-chaining', 'module.exports = input?.value;'],
    ['nullish-coalescing', 'module.exports = input ?? "fallback";'],
    ['class-fields', 'class Probe { static fallback = "fallback"; value = 42; }'],
])('ES2018 rejects the untranspiled %s control', (name, code) => {
    const filename = path.join(directory, `${name}.js`);
    fs.writeFileSync(filename, code);
    const result = runChecks([{ ecmaVersion: 'es2018', files: [filename.split(path.sep).join('/')] }]);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].err.message).toMatch(/Unexpected token/);
});

test.each([
    ['desktop', {}, false],
    ['debug without webOS', { WEBOS_DEBUG: '1' }, false],
    ['disabled webOS', { WEBOS: '0' }, false],
    ['webOS', { WEBOS: '1' }, true],
    ['webOS debug', { WEBOS: '1', WEBOS_DEBUG: '1' }, true],
])('%s selects the intended Babel and TypeScript configuration', (_name, env, webos) => {
    const config = createConfig(env, { mode: 'production' });
    const jsRule = config.module.rules.find((rule) => rule.test.test('fixture.js'));
    const tsRule = config.module.rules.find((rule) => rule.test.test('fixture.tsx'));
    const babelOptions = jsRule.use.find((item) => item.loader === 'babel-loader').options;
    const tsOptions = tsRule.use.find((item) => item.loader === 'ts-loader').options;

    expect(babelOptions.presets[0]).toEqual(['@babel/preset-env', {
        browserslistEnv: webos ? 'webos' : undefined,
        ignoreBrowserslistConfig: !webos,
    }]);
    expect(packageJson.browserslist.webos).toEqual(['Chrome 68']);
    expect(tsOptions.configFile).toBe(path.resolve(__dirname, '..', webos ? 'tsconfig.webos.json' : 'tsconfig.json'));
    if (webos) {
        expect(config.entry.main[0]).toBe('core-js/stable');
        expect(config.entry.worker[0]).toBe('core-js/stable');

        expect(isExcluded(jsRule.exclude, path.join('project', 'node_modules', 'i18next', 'dist', 'index.js'))).toBe(false);
        expect(isExcluded(jsRule.exclude, path.join('project', 'node_modules', 'react-i18next', 'dist', 'commonjs', 'utils.js'))).toBe(false);
        expect(isExcluded(jsRule.exclude, path.join('project', 'node_modules', 'use-long-press', 'index.js'))).toBe(false);
        expect(isExcluded(jsRule.exclude, path.join('project', 'node_modules', '@sentry', 'browser', 'index.js'))).toBe(true);
        expect(isExcluded(jsRule.exclude, path.join('project', 'node_modules', '.pnpm', 'i18next@24.2.3', 'node_modules', 'i18next', 'dist', 'index.js'))).toBe(false);
    } else {
        expect(config.entry.main).toBe('./src/index.js');
        expect(config.entry.worker).toBe('./node_modules/@stremio/stremio-core-web/worker.js');
        expect(isExcluded(jsRule.exclude, path.join('project', 'node_modules', 'i18next', 'dist', 'index.js'))).toBe(true);
        expect(isExcluded(jsRule.exclude, path.join('project', 'node_modules', 'use-long-press', 'index.js'))).toBe(true);
    }
});

test.each([
    ['desktop development', {}, 'development'],
    ['desktop production', {}, 'production'],
    ['webOS development', { WEBOS: '1' }, 'development'],
    ['webOS production', { WEBOS: '1' }, 'production'],
])('%s keeps the production minifier contract', (_name, env, mode) => {
    const config = createConfig(env, { mode });
    const terserPlugin = config.optimization.minimizer[0];
    const terserOptions = terserPlugin.options.minimizer.options;

    expect(config.optimization.minimize).toBe(true);
    expect(config.optimization.minimizer).toHaveLength(1);
    expect(terserPlugin.options.test).toEqual(/\.js$/);
    expect(terserPlugin.options.extractComments).toBe(false);
    expect(terserOptions).toMatchObject({
        ecma: 5,
        mangle: true,
        warnings: false,
        output: {
            comments: false,
            beautify: false,
            wrap_iife: true,
        },
    });
});

describe.each([
    ['webos', { WEBOS: '1' }],
    ['webos-debug', { WEBOS: '1', WEBOS_DEBUG: '1' }],
])('%s source compatibility', (name, env) => {
    test.each(fixtures)('%s survives the production loader/minifier pipeline as ES2018', async (extension, code) => {
        const filename = path.join(directory, `${name}.${extension}`);
        const outputDirectory = path.join(directory, `${name}-${extension}`);
        fs.writeFileSync(filename, code);

        const config = createConfig(env, { mode: 'production' });
        // Isolate source syntax from app dependencies and asset/SW plugins (T1.4).
        const compiler = webpack({
            ...config,
            entry: filename,
            output: { path: outputDirectory, filename: 'fixture.js', library: { type: 'commonjs2' } },
            devtool: false,
            plugins: [],
        });
        await new Promise((resolve, reject) => {
            compiler.run((error, stats) => {
                compiler.close((closeError) => {
                    if (error || closeError) return reject(error || closeError);
                    if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
                    resolve();
                });
            });
        });

        const outputFile = path.join(outputDirectory, 'fixture.js');
        const result = runChecks([{ ecmaVersion: 'es2018', files: [outputFile.split(path.sep).join('/')] }]);
        expect(result).toEqual({ success: true, errors: [] });

        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(outputFile, 'utf8'), {
            module,
            React: { createElement: (type, props, child) => ({ type, props, child }) },
        }, { timeout: 1000 });
        const { Probe, typedValue, element } = module.exports;
        const probe = new Probe();
        expect(Probe.fallback).toBe('fallback');
        expect(probe.value).toBe(42);
        for (const input of [undefined, null, {}, { nested: null }, { nested: {} }, { nested: { value: null } }]) {
            expect(probe.read(input)).toBe('fallback');
        }
        for (const value of [0, false, '', 'present']) {
            expect(probe.read({ nested: { value } })).toBe(value);
        }
        if (extension !== 'js') expect(typedValue).toBe(42);
        if (extension === 'tsx') expect(element).toEqual({ type: 'span', props: null, child: 'fallback' });
    }, 30000);
});
