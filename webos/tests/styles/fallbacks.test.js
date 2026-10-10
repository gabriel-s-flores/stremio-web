// webos/webpack/postcss-fallbacks.js and webos/scripts/check-css-fallbacks.js: what Chromium 53
// cannot parse (sticky, backdrop-filter, aspect-ratio, env(), dvh) is rewritten, and the check
// fails when a raw use is left in main.css.
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const fromLoader = (name) => require(require.resolve(name, { paths: [path.dirname(require.resolve('postcss-loader', { paths: [ROOT] }))] }));

const postcss = fromLoader('postcss');
const fallbacks = require('../../webpack/postcss-fallbacks');
const { fallbackProblems } = require('../../scripts/check-css-fallbacks');

const run = (css) => postcss([fallbacks()]).process(css, { from: 'file.less' }).then((result) => result.css);
const declarations = (css, selector) => {
    const found = {};
    postcss.parse(css).walkRules((rule) => {
        if (rule.selector === selector) rule.walkDecls((decl) => { found[decl.prop] = decl.value; });
    });
    return found;
};

describe('webos/webpack/postcss-fallbacks', () => {
    describe('position: sticky', () => {
        test('becomes relative and loses the offsets, which are only scroll thresholds', async () => {
            const css = await run('.label { position: sticky; left: 1.5rem; top: 0; display: flex; }');
            expect(declarations(css, '.label')).toEqual({ position: 'relative', display: 'flex' });
        });

        test('leaves other positions and their offsets alone', async () => {
            const css = await run('.a { position: absolute; left: 1rem; } .b { position: relative; top: 2px; }');
            expect(declarations(css, '.a')).toEqual({ position: 'absolute', left: '1rem' });
            expect(declarations(css, '.b')).toEqual({ position: 'relative', top: '2px' });
        });
    });

    describe('backdrop-filter', () => {
        test('is removed, with its -webkit- twin and the none reset', async () => {
            const css = await run('.a { backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); color: red; } .b { backdrop-filter: none; }');
            expect(declarations(css, '.a')).toEqual({ color: 'red' });
            expect(declarations(css, '.b')).toEqual({});
        });

        test('makes a dark translucent background more opaque, since nothing blurs behind it', async () => {
            const css = await run('.list { background-color: rgba(0, 0, 0, 0.4); backdrop-filter: blur(15px); }');
            expect(declarations(css, '.list')).toEqual({ 'background-color': 'rgba(0, 0, 0, 0.7)' });
        });

        test('keeps light, opaque and variable backgrounds', async () => {
            const css = await run([
                '.a { background-color: var(--overlay-color); backdrop-filter: blur(5px); }',
                '.b { background-color: rgba(255, 255, 255, 0.1); backdrop-filter: blur(5px); }',
                '.c { background-color: rgba(0, 0, 0, 0.9); backdrop-filter: blur(5px); }',
                '.d { background-color: rgba(0, 0, 0, 0.4); }',
            ].join('\n'));
            expect(declarations(css, '.a')).toEqual({ 'background-color': 'var(--overlay-color)' });
            expect(declarations(css, '.b')).toEqual({ 'background-color': 'rgba(255, 255, 255, 0.1)' });
            expect(declarations(css, '.c')).toEqual({ 'background-color': 'rgba(0, 0, 0, 0.9)' });
            expect(declarations(css, '.d')).toEqual({ 'background-color': 'rgba(0, 0, 0, 0.4)' });
        });
    });

    describe('aspect-ratio', () => {
        test('becomes a fixed height from a length width', async () => {
            const css = await run('.art { width: 8rem; aspect-ratio: 16 / 9; }');
            expect(declarations(css, '.art')).toEqual({ width: '8rem', height: '4.5rem' });
        });

        test('uses the max-width when the width is a percentage', async () => {
            const css = await run('.art { width: 40%; max-width: 8rem; aspect-ratio: 16 / 9; }');
            expect(declarations(css, '.art')).toEqual({ width: '40%', 'max-width': '8rem', height: '4.5rem' });
        });

        test('is removed when there is nothing to derive the height from, or a height already', async () => {
            const css = await run('.a { height: 100%; aspect-ratio: 2 / 3; } .b { width: 4rem; height: 3rem; aspect-ratio: 1; } .c { aspect-ratio: auto; width: 2px; }');
            expect(declarations(css, '.a')).toEqual({ height: '100%' });
            expect(declarations(css, '.b')).toEqual({ width: '4rem', height: '3rem' });
            expect(declarations(css, '.c')).toEqual({ width: '2px' });
        });
    });

    describe('env() and viewport units', () => {
        test('env() becomes its fallback, or 0px', async () => {
            const css = await run(':root { --a: calc(env(safe-area-inset-top, 0rem) / var(--s)); --b: env(safe-area-inset-left); --c: env(x, env(y, 3px)); --d: soenv(x); }');
            expect(declarations(css, ':root')).toEqual({
                '--a': 'calc(0rem / var(--s))',
                '--b': '0px',
                '--c': '3px',
                '--d': 'soenv(x)',
            });
        });

        test('dvh, svh and lvh become vh (dvw... vw)', async () => {
            const css = await run('.a { max-height: calc(100dvh - 4rem); width: 50.5svw; height: 10lvh; margin: 1dvmin 2svmax; }');
            expect(declarations(css, '.a')).toEqual({ 'max-height': 'calc(100vh - 4rem)', width: '50.5vw', height: '10vh', margin: '1vmin 2vmax' });
        });

        test('the @supports blocks that test those units are dropped, the others stay', async () => {
            const css = await run('@supports (height: 100dvh) { :root { --a: 1; } } @supports (display: flex) { :root { --b: 2; } }');
            expect(css).not.toMatch(/dvh/);
            expect(declarations(css, ':root')).toEqual({ '--b': '2' });
        });
    });
});

describe('webos/scripts/check-css-fallbacks', () => {
    test('accepts CSS without the raw uses', () => {
        expect(fallbackProblems('.a { position: relative; height: 4.5rem; max-height: calc(100vh - 1rem); -webkit-mask-image: linear-gradient(#000, transparent); }')).toEqual([]);
    });

    test('accepts a mask with its -webkit- twin, rejects one without', () => {
        expect(fallbackProblems('.a { -webkit-mask-image: none; mask-image: none; }')).toEqual([]);
        expect(fallbackProblems('.a { mask-image: none; }')).toHaveLength(1);
    });

    test.each([
        ['sticky', '.a { position: sticky; }'],
        ['-webkit-sticky', '.a { position: -webkit-sticky; }'],
        ['backdrop-filter', '.a { backdrop-filter: blur(1px); }'],
        ['-webkit-backdrop-filter', '.a { -webkit-backdrop-filter: blur(1px); }'],
        ['aspect-ratio', '.a { aspect-ratio: 16 / 9; }'],
        ['env()', ':root { --a: calc(env(safe-area-inset-top, 0rem) / 1); }'],
        ['dvh in a value', '.a { height: 100dvh; }'],
        ['svw in a value', '.a { width: calc(100svw - 1px); }'],
        ['dvh in an at-rule', '@supports (height: 100dvh) { .a { color: red; } }'],
    ])('rejects %s', (name, css) => {
        const problems = fallbackProblems(css);
        expect(problems.length).toBeGreaterThan(0);
    });

    test('names the selector that holds the leftover', () => {
        expect(fallbackProblems('.panel .label { position: sticky; }')[0]).toMatch(/^\.panel \.label: position: sticky/);
    });

    test('the plugin leaves nothing for the check to find', async () => {
        const css = await run([
            '.a { position: sticky; left: 0; backdrop-filter: blur(5px); aspect-ratio: 1; padding-top: env(safe-area-inset-top, 0px); height: 100dvh; }',
            '@supports (height: 100svh) { :root { --h: 100svh; } }',
        ].join('\n'));
        expect(fallbackProblems(css)).toEqual([]);
    });
});
