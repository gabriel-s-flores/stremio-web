// webos/scripts/check-styles.js (in webos:check-syntax) and the content of webos/styles/app.less:
// the html:root rule that keeps html, body and #app from being 0px tall on Chromium 53.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REQUIRED, stylesProblems, checkBuild } = require('../../scripts/check-styles');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const APP_LESS = path.join(ROOT, 'webos', 'styles', 'app.less');

// app.less through less, as the build does before PostCSS (no imports, so no loader options matter).
const compileAppLess = async () => {
    const less = require(require.resolve('less', { paths: [ROOT] }));
    const { css } = await less.render(fs.readFileSync(APP_LESS, 'utf8'), { filename: APP_LESS });
    return css;
};

const rule = (body) => `html{width:calc(1px + 2px);height:calc(1px + 2px)}html:root{${body}}`;
const GOOD = Object.entries(REQUIRED).map(([prop, value]) => `${prop}:${value}`).join(';');

describe('webos/styles/app.less', () => {
    test('compiles to the html:root rule the check expects', async () => {
        expect(stylesProblems(await compileAppLess())).toEqual([]);
    });

    test('does not use max(), min(), clamp() or env() in its declarations', () => {
        const declarations = fs.readFileSync(APP_LESS, 'utf8').split('\n').filter((line) => !line.trim().startsWith('//'));
        expect(declarations.join('\n')).not.toMatch(/\b(max|min|clamp|env)\(/);
    });
});

describe('webos/scripts/check-styles', () => {
    test('accepts the rule', () => {
        expect(stylesProblems(rule(GOOD))).toEqual([]);
        // as cssnano writes it
        expect(stylesProblems(rule(GOOD.replace(/ \/ /g, '/')))).toEqual([]);
    });

    test('rejects safe areas left at zero: they hold the overscan margins (F2.6)', () => {
        expect(stylesProblems(rule(GOOD.replace(/--safe-area-inset-top:[^;]*/, '--safe-area-inset-top:0rem')))).toEqual([
            'html:root needs --safe-area-inset-top: calc(33px / var(--interface-scale)) (found 0rem)',
        ]);
    });

    test('rejects a missing or empty rule', () => {
        expect(stylesProblems('html{height:100%}')).toHaveLength(Object.keys(REQUIRED).length);
        expect(stylesProblems(rule(''))).toHaveLength(Object.keys(REQUIRED).length);
    });

    test('rejects the height or a safe area left out', () => {
        expect(stylesProblems(rule(GOOD.replace('height:var(--dynamic-viewport-height)', 'height:100%')))).toEqual([
            'html:root needs height: var(--dynamic-viewport-height) (found 100%)',
        ]);
        expect(stylesProblems(rule(GOOD.replace(/--safe-area-inset-left:[^;]*;?/, '')))).toHaveLength(1);
    });

    test('rejects max() and env()', () => {
        const withMax = rule(`${GOOD};min-height:max(100vh,1px)`);
        expect(stylesProblems(withMax)).toEqual(['html:root min-height uses max(100vh,1px), which Chromium 53 drops']);
        expect(stylesProblems(rule(`${GOOD};padding-top:env(safe-area-inset-top)`))).toHaveLength(1);
    });

    test('rejects min(), max() and clamp() left anywhere in the CSS', () => {
        const raw = `${rule(GOOD)}.a{max-width:min(30rem,100%)}@media (min-width:600px){.b{font-size:clamp(1rem,2vw,2rem);padding:max(1rem,0px)}}`;
        const problems = stylesProblems(raw);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('3 declaration(s) still use min()/max()/clamp()');
        expect(problems[0]).toContain('.a{max-width: min(30rem,100%)}');
        expect(problems[0]).toContain('.b{font-size: clamp(1rem,2vw,2rem)}');
    });

    test('finds the functions in any case and in a media-scoped html:root', () => {
        const problems = stylesProblems(`${rule(GOOD)}.a{width:MIN(1px,2px);height:Max(1px,2px)}@media (min-width:1px){html:root{padding:max(1px,2px)}}`);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('3 declaration(s)');
        expect(problems[0]).toContain('html:root{padding: max(1px,2px)}');
    });

    test('does not take minmax(), custom property names, urls or media features for them', () => {
        const css = `${rule(GOOD)}.a{grid-template-columns:minmax(0,1fr) 2rem;--fgp-max-width:2rem;background:url(max(1).png)}@media (min-width:600px) and (max-width:900px){.b{width:var(--fgp-max-width,1px)}}`;
        expect(stylesProblems(css)).toEqual([]);
    });

    test('rejects the pointer-events of flex-gap-polyfill left as they were', () => {
        const raw = `${rule(GOOD)}.a{--has-fgp: ;pointer-events:var(--has-fgp) none}.a>*{pointer-events:var(--parent-has-fgp) auto}.b{pointer-events:none}`;
        expect(stylesProblems(raw)).toEqual([
            '2 pointer-events from flex-gap-polyfill left as they were (buttons with a gap would not take clicks)',
            'no --fgp-pointer-events: auto (the Button root must turn the flex-gap-polyfill pointer-events on)',
        ]);
        const switched = `${rule(GOOD)}.a{--has-fgp: ;pointer-events:var(--has-fgp) var(--fgp-pointer-events, none)}.button-container-x{--fgp-pointer-events:auto}`;
        expect(stylesProblems(switched)).toEqual([]);
    });

    test('checks the one main.css of a build folder', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-styles-'));
        try {
            expect(checkBuild(dir)).toEqual([`expected one <commit>/styles/main.css in ${dir}, found 0`]);
            fs.mkdirSync(path.join(dir, 'abc', 'styles'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'abc', 'styles', 'main.css'), rule(GOOD));
            expect(checkBuild(dir)).toEqual([]);
            fs.writeFileSync(path.join(dir, 'abc', 'styles', 'main.css'), 'html{height:100%}');
            expect(checkBuild(dir)[0]).toMatch(/^abc\/styles\/main\.css: html:root needs width/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
