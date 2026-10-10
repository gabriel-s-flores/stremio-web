// webos/webpack/postcss-math-functions.js: min()/max()/clamp() resolved for Chromium 53 (F2.4).
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const fromLoader = (name) => require(require.resolve(name, { paths: [path.dirname(require.resolve('postcss-loader', { paths: [ROOT] }))] }));

const postcss = fromLoader('postcss');
const mathFunctions = require('../../webpack/postcss-math-functions');
const postcssConfig = require('../../webpack/postcss');

const { resolveValue } = mathFunctions;

const run = (css) => postcss([mathFunctions()]).process(css, { from: undefined });

describe('webos/webpack/postcss-math-functions', () => {
    describe('values that can all be sized', () => {
        test.each([
            ['min(14rem, 100vw)', '14rem'],
            ['max(1rem, 2rem)', '2rem'],
            ['clamp(1.6rem, 6.5vw, 2.5rem)', '2.5rem'],
            ['clamp(5rem, 1vw, 9rem)', '5rem'],
            ['clamp(5rem, 99vw, 9rem)', '9rem'],
            ['min(calc(3rem * 7), calc(var(--dynamic-viewport-height) - 1rem))', '21rem'],
            ['min(48rem, calc(100dvh - 4rem))', '48rem'],
            ['min(18rem, 70vw)', '18rem'],
            ['min(100% - 2rem, 20rem)', '20rem'],
            ['max(0.5rem, 8px)', '0.5rem'],
        ])('%s -> %s', (input, expected) => {
            expect(resolveValue(input)).toBe(expected);
        });

        test('keeps the winner viewport-relative when it is one (1920x1080: 5.2vh is 56px, 3.8rem is 61px)', () => {
            expect(resolveValue('clamp(2rem, 5.2vh, 3.8rem)')).toBe('5.2vh');
            expect(resolveValue('max(0.8rem, min(2.2vh, 1.75rem))')).toBe('2.2vh');
        });

        test('ties go to the first argument', () => {
            expect(resolveValue('max(16px, 1rem)')).toBe('16px');
        });
    });

    describe('safe areas are zero on a TV', () => {
        test.each([
            ['max(1rem, var(--safe-area-inset-bottom))', '1rem'],
            ['max(0.5rem, var(--safe-area-inset-top)) max(0.5rem, var(--safe-area-inset-left))', '0.5rem 0.5rem'],
            ['max(0rem, calc(1rem - var(--safe-area-inset-left)))', 'calc(1rem - var(--safe-area-inset-left))'],
            ['calc(100% - max(0.75rem, var(--safe-area-inset-top)))', 'calc(100% - 0.75rem)'],
            ['0 clamp(1.5rem, 5vw, 6rem) max(2rem, var(--safe-area-inset-bottom))', '0 5vw 2rem'],
            ['min(calc(env(safe-area-inset-bottom, 0rem) / var(--interface-scale)), max(1rem, calc(var(--viewport-height-diff) - var(--safe-area-inset-top))))', 'calc(0rem / var(--interface-scale))'],
        ])('%s -> %s', (input, expected) => {
            expect(resolveValue(input)).toBe(expected);
        });
    });

    describe('arguments the reference cannot size', () => {
        test('a % or a custom property set from JS is ignored when another argument can be sized', () => {
            expect(resolveValue('min(30rem, 100%)')).toBe('30rem');
            expect(resolveValue('min(56rem, calc(100% - 3rem))')).toBe('56rem');
            expect(resolveValue('min(24rem, var(--content-width))')).toBe('24rem');
            expect(resolveValue('max(min(24rem, var(--content-width)), min(18rem, var(--viewport-width)))')).toBe('24rem');
            expect(resolveValue('translateX(min(0px, calc(var(--preview-space) - 100%)))')).toBe('translateX(0px)');
        });

        test('clamp() with an unsized middle or bound', () => {
            expect(resolveValue('clamp(1rem, 50%, 3rem)')).toBe('3rem');
            expect(resolveValue('clamp(1rem, 2rem, 50%)')).toBe('2rem');
            expect(resolveValue('clamp(50%, 2rem, 3rem)')).toBe('2rem');
        });

        test('with nothing sized, the first argument without % is used', () => {
            expect(resolveValue('max(100%, var(--x))')).toBe('var(--x)');
            expect(resolveValue('min(50%, 20%)')).toBe('50%');
        });
    });

    test('leaves out of reach what is not min(), max() or clamp()', () => {
        expect(resolveValue('minmax(0, 1fr) 2rem')).toBe('minmax(0, 1fr) 2rem');
        expect(resolveValue('var(--fgp-max-width, 1px)')).toBe('var(--fgp-max-width, 1px)');
        expect(resolveValue('calc(100% - 2rem)')).toBe('calc(100% - 2rem)');
    });

    test('inside @media (max-width/max-height) the reference viewport is no larger than the query', async () => {
        const css = '.t{font-size:clamp(1rem,10vw,3rem)}@media (max-width:200px){.t{font-size:clamp(1rem,10vw,3rem)}}@media (max-height:100px) and (orientation:landscape){.t{font-size:clamp(1rem,10vh,3rem)}}';
        expect((await run(css)).css).toBe('.t{font-size:3rem}@media (max-width:200px){.t{font-size:10vw}}@media (max-height:100px) and (orientation:landscape){.t{font-size:1rem}}');
    });

    test('rewrites the declarations, custom properties and nested rules of a stylesheet', async () => {
        const css = '.a{max-width:min(30rem,100%);--size:max(1rem,0px)}@media (min-width:600px){.b{font-size:clamp(1rem,2vw,2rem)}}';
        const result = await run(css);
        expect(result.css).toBe('.a{max-width:30rem;--size:1rem}@media (min-width:600px){.b{font-size:2rem}}');
        expect(result.messages.map((message) => message.text)).toEqual([
            'max-width: min(30rem,100%) -> 30rem',
            '--size: max(1rem,0px) -> 1rem',
            'font-size: clamp(1rem,2vw,2rem) -> 2rem',
        ]);
    });

    test('runs first in the webOS PostCSS pipeline', () => {
        const config = postcssConfig({
            module: {
                rules: [{
                    test: /\.less$/,
                    use: [{ loader: 'postcss-loader', options: { postcssOptions: { plugins: [['cssnano', { preset: ['advanced', {}] }]] } } }],
                }],
            },
        });
        const names = config.module.rules[0].use[0].options.postcssOptions.plugins.map(([name]) => path.basename(name));
        expect(names[0]).toBe('postcss-math-functions.js');
    });
});
