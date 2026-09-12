const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const cssnano = require('cssnano');

jest.mock('thread-loader', () => ({ ...jest.requireActual('thread-loader'), warmup: jest.fn() }));

const createConfig = require('../webpack.config');
const root = path.resolve(__dirname, '..');
// Resolve transitive dependencies through their actual owners under pnpm.
const presetRequire = createRequire(require.resolve('cssnano-preset-advanced'));
const autoprefixerRequire = createRequire(presetRequire.resolve('autoprefixer'));
const browserslist = autoprefixerRequire('browserslist');
const postcss = createRequire(require.resolve('cssnano'))('postcss');
const less = require('less');

function pipeline(webos) {
    const config = createConfig({ WEBOS: webos }, { mode: 'production' });
    const rule = config.module.rules.find((item) => item.test.test('probe.less'));
    const options = rule.use.find((item) => item.loader === 'postcss-loader')
        .options.postcssOptions.plugins[0][1];
    return { rule, options };
}

async function processCss(css, options) {
    return (await postcss([cssnano(options)]).process(css, {
        from: path.join(root, 'src', 'pipeline-probe.css'),
    })).css;
}

test.each([false, true])('loader contract and target selection (webos=%s)', (webos) => {
    const { rule, options } = pipeline(webos);
    expect(rule.use.map((item) => item.loader)).toEqual([
        require('mini-css-extract-plugin').loader, 'thread-loader',
        'css-loader', 'postcss-loader', 'less-loader',
    ]);
    expect(rule.use[0].options).toEqual({ esModule: false });
    expect(rule.use[2].options).toEqual({
        esModule: false, importLoaders: 2,
        modules: { namedExport: false, localIdentName: '[local]-[hash:base64:5]' },
    });
    expect(rule.use[4].options).toEqual({ lessOptions: {
        strictMath: true, ieCompat: false, modifyVars: { webos: String(webos) },
    } });
    expect(options.preset[1].autoprefixer).toEqual({
        env: webos ? 'webos' : undefined,
        add: true, remove: true, flexbox: false, grid: false,
    });
});

test('the webOS environment resolves to Chrome 68 even with a desktop ambient environment', () => {
    const previous = process.env.BROWSERSLIST_ENV;
    try {
        process.env.BROWSERSLIST_ENV = 'production';
        const options = pipeline(true).options.preset[1].autoprefixer;
        expect(require('../package.json').browserslist.webos).toEqual(['Chrome 68']);
        expect(browserslist(undefined, { path: root, env: options.env })).toEqual(['chrome 68']);
    } finally {
        if (previous === undefined) delete process.env.BROWSERSLIST_ENV;
        else process.env.BROWSERSLIST_ENV = previous;
    }
});

const probe = '.control { -webkit-appearance: none; -moz-appearance: none; appearance: none;'
    + '-moz-transform: translateX(0); -o-transform: translateX(0); transform: translateX(0); }';

test('advanced cssnano retains/adds Chrome 68 appearance and removes obsolete prefixes', async () => {
    const options = pipeline(true).options;
    const css = await processCss(probe, options);
    expect(css).toContain('-webkit-appearance:none');
    expect(css).toContain('transform:translateX(0)');
    expect(css).not.toMatch(/-(moz|o)-/);
    expect(await processCss('.control { appearance: none }', options)).toContain('-webkit-appearance:none');
});

test('desktop output matches the original configuration with no env key', async () => {
    const options = pipeline(false).options;
    const original = { preset: [options.preset[0], {
        ...options.preset[1], autoprefixer: { ...options.preset[1].autoprefixer },
    }] };
    delete original.preset[1].autoprefixer.env;
    expect(await processCss(probe, options)).toBe(await processCss(probe, original));
});

test('intentional project scrollbar and line-clamp survive LESS and cssnano', async () => {
    const aliases = { install(instance, manager) {
        const resolver = new instance.FileManager();
        resolver.supports = (name) => name.startsWith('~');
        resolver.loadFile = (name) => {
            const filename = name.startsWith('~stremio/')
                ? path.join(root, 'src', name.slice(9)) : require.resolve(name.slice(1));
            return Promise.resolve({ filename, contents: fs.readFileSync(filename, 'utf8') });
        };
        manager.addFileManager(resolver);
    } };
    const { rule, options } = pipeline(true);
    const files = ['components/Video/styles.less', 'components/NavBar/VerticalNavBar/styles.less'];
    const output = [];
    for (const file of files) {
        const filename = path.join(root, 'src', file);
        const { css } = await less.render(fs.readFileSync(filename, 'utf8'), {
            filename, plugins: [aliases], ...rule.use[4].options.lessOptions,
        });
        output.push(await processCss(css, options));
    }
    expect(output[0]).toContain('-webkit-line-clamp:2');
    expect(output[0]).toContain('-webkit-box-orient:vertical');
    expect(output[0]).toContain('display:-webkit-box');
    expect(output[1]).toContain('::-webkit-scrollbar');
});
