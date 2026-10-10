// webos/webpack/postcss-fgp-pointer-events.js: after flex-gap-polyfill, a Button that is a flex
// container with a gap takes clicks on its whole box, a disabled one takes none, and the other
// polyfilled containers keep the polyfill's pointer-events: none (they are shifted over neighbors).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BUTTON_LESS = path.join(ROOT, 'src', 'components', 'Button', 'Button.less');
const fromRoot = (name) => require(require.resolve(name, { paths: [ROOT] }));
const fromLoader = (name) => require(require.resolve(name, { paths: [path.dirname(require.resolve('postcss-loader', { paths: [ROOT] }))] }));

const postcss = fromLoader('postcss');
const less = fromRoot('less');
const flexGap = fromRoot('flex-gap-polyfill');
const fgpPointerEvents = require('../../webpack/postcss-fgp-pointer-events');
const postcssConfig = require('../../webpack/postcss');

const LABEL = '.button { display: flex; gap: 0 0.5rem; padding: 0.75rem 1.5rem; } .icon { pointer-events: none; }';

const run = (css, from, plugins) => postcss(plugins).process(css, { from }).then((result) => result.css);
const declarations = (css, selector) => {
    const found = {};
    postcss.parse(css).walkRules((rule) => {
        if (rule.selector === selector) rule.walkDecls((decl) => { found[decl.prop] = decl.value; });
    });
    return found;
};

describe('webos/webpack/postcss-fgp-pointer-events', () => {
    test('flex-gap-polyfill alone turns every flex container off for the mouse', async () => {
        const css = await run(LABEL, 'Label.less', [flexGap({ only: true })]);
        expect(declarations(css, '.button')['pointer-events']).toBe('var(--has-fgp) none');
        expect(declarations(css, '.button > *')['pointer-events']).toBe('var(--parent-has-fgp) auto');
    });

    test('turns the polyfill pointer-events into switches, defaulting to the polyfill values', async () => {
        const css = await run(LABEL, 'Label.less', [flexGap({ only: true }), fgpPointerEvents()]);
        expect(declarations(css, '.button')['pointer-events']).toBe('var(--has-fgp) var(--fgp-pointer-events, none)');
        expect(declarations(css, '.button > *')['pointer-events']).toBe('var(--parent-has-fgp) var(--fgp-item-pointer-events, auto)');
        // The gap emulation and the app's own pointer-events stay.
        expect(declarations(css, '.button')['--fgp-gap-column']).toBe('0.5rem');
        expect(declarations(css, '.icon')['pointer-events']).toBe('none');
    });

    test('the Button root turns them on, and a disabled Button off for its children too', async () => {
        const { css: compiled } = await less.render(fs.readFileSync(BUTTON_LESS, 'utf8'), {
            filename: BUTTON_LESS,
            paths: [path.join(ROOT, 'node_modules')],
            plugins: [{ install: (_less, pluginManager) => pluginManager.addFileManager(new (class extends _less.FileManager {
                supports(filename) { return filename.startsWith('~'); }
                loadFile(filename, dir, options, env) { return super.loadFile(filename.slice(1), dir, options, env); }
            })()) }],
        });
        const css = await run(compiled, BUTTON_LESS, [flexGap({ only: true }), fgpPointerEvents()]);
        expect(declarations(css, '.button-container')['--fgp-pointer-events']).toBe('auto');
        expect(declarations(css, '.button-container:global(.disabled)')).toMatchObject({
            'pointer-events': 'none',
            '--fgp-pointer-events': 'none',
            '--fgp-item-pointer-events': 'none',
        });
        // Only the top-level rules: the one inside @media (pointer: coarse) is left alone.
        expect((css.match(/--fgp-pointer-events: auto/g) || []).length).toBe(1);
    });

    test('other files get no switch', async () => {
        const css = await run('.button-container { display: flex; gap: 1rem; }', 'Other.less', [flexGap({ only: true }), fgpPointerEvents()]);
        expect(css).not.toMatch(/--fgp-pointer-events:/);
    });

    test('runs right after flex-gap-polyfill in the webOS less pipeline', () => {
        const config = postcssConfig({
            module: {
                rules: [{
                    test: /\.less$/,
                    use: [{ loader: 'postcss-loader', options: { postcssOptions: { plugins: [['cssnano', { preset: ['advanced', {}] }]] } } }],
                }],
            },
        });
        const names = config.module.rules[0].use[0].options.postcssOptions.plugins.map(([name]) => path.basename(name));
        expect(names.indexOf('postcss-fgp-pointer-events.js')).toBe(names.indexOf('flex-gap-polyfill') + 1);
    });
});
