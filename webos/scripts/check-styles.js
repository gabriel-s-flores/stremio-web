#!/usr/bin/env node
// Guard of the webOS root styles (part of pnpm webos:check-syntax):
//   node webos/scripts/check-styles.js [build-webos]
// The main.css of the build must carry the html:root rule of webos/styles/app.less: html sized by
// --dynamic-viewport-* and the --safe-area-inset-* set to the overscan margins of the TV (F2.6),
// without max() or env(), which Chromium 53 lacks. Without it html, body and #app are 0px tall and the screen shows only the
// background color. It also checks that the pointer-events flex-gap-polyfill adds were turned into
// the switches the Button root sets (webos/webpack/postcss-fgp-pointer-events.js); left as they are,
// buttons with a gap do not take clicks on their background. No min()/max()/clamp() may be left
// anywhere in main.css: Chromium 53 drops the whole declaration (webos/webpack/postcss-math-functions.js
// resolves them). Exits with 1 and lists the problems.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { TV } = require('../webpack/postcss-math-functions');

// The postcss the build uses (through postcss-loader; not a direct dependency).
const postcss = require(require.resolve('postcss', {
    paths: [path.dirname(require.resolve('postcss-loader', { paths: [ROOT] }))]
}));

// A min()/max()/clamp() call (minmax() and names such as --fgp-max-width do not match).
const MATH_CALL = /(?<![\w-])(min|max|clamp)\(/i;
const MAX_REPORTED = 10;

const REQUIRED = {
    'width': 'var(--dynamic-viewport-width)',
    'height': 'var(--dynamic-viewport-height)',
    '--safe-area-inset-top': `calc(${TV.overscan.y}px / var(--interface-scale))`,
    '--safe-area-inset-right': `calc(${TV.overscan.x}px / var(--interface-scale))`,
    '--safe-area-inset-bottom': `calc(${TV.overscan.y}px / var(--interface-scale))`,
    '--safe-area-inset-left': `calc(${TV.overscan.x}px / var(--interface-scale))`,
};

// cssnano drops the spaces around `/` in calc().
const same = (a, b) => a !== undefined && a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

// Problems with the root rule in a CSS text ([] if it is there), and pointer-events left by
// flex-gap-polyfill (webos/webpack/postcss-fgp-pointer-events.js drops them).
const stylesProblems = (css) => {
    const declarations = {};
    const root = postcss.parse(css);
    let fgpPointerEvents = 0;
    let buttonSwitch = false;
    root.walkDecls((decl) => {
        if (decl.prop === 'pointer-events' && /^var\(--(parent-)?has-fgp\)\s+(none|auto)$/.test(decl.value.trim())) fgpPointerEvents++;
        if (decl.prop === '--fgp-pointer-events' && decl.value.trim() === 'auto') buttonSwitch = true;
    });
    root.walkRules((rule) => {
        if (rule.parent.type !== 'root' || !rule.selectors.includes('html:root')) {
            return;
        }
        rule.walkDecls((decl) => {
            declarations[decl.prop] = decl.value.trim();
        });
    });
    const problems = [];
    const rawMath = [];
    root.walkDecls((decl) => {
        // The top-level html:root rule has its own message below.
        if (decl.parent.parent === root && decl.parent.selectors && decl.parent.selectors.includes('html:root')) return;
        const value = decl.value.replace(/url\([^)]*\)|"[^"]*"|'[^']*'/g, '');
        if (MATH_CALL.test(value)) rawMath.push(`${decl.parent.selector || decl.parent.name}{${decl.prop}: ${decl.value}}`);
    });
    if (rawMath.length > 0) {
        const shown = rawMath.slice(0, MAX_REPORTED).join('; ');
        const more = rawMath.length > MAX_REPORTED ? ` (and ${rawMath.length - MAX_REPORTED} more)` : '';
        problems.push(`${rawMath.length} declaration(s) still use min()/max()/clamp(), which Chromium 53 drops: ${shown}${more}`);
    }
    Object.entries(REQUIRED).forEach(([prop, value]) => {
        if (!same(declarations[prop], value)) {
            problems.push(`html:root needs ${prop}: ${value} (found ${declarations[prop] === undefined ? 'nothing' : declarations[prop]})`);
        }
    });
    Object.entries(declarations).forEach(([prop, value]) => {
        if (/\b(max|min|clamp|env)\(/i.test(value)) {
            problems.push(`html:root ${prop} uses ${value}, which Chromium 53 drops`);
        }
    });
    if (fgpPointerEvents > 0) {
        problems.push(`${fgpPointerEvents} pointer-events from flex-gap-polyfill left as they were (buttons with a gap would not take clicks)`);
    }
    if (/has-fgp/.test(css) && !buttonSwitch) {
        problems.push('no --fgp-pointer-events: auto (the Button root must turn the flex-gap-polyfill pointer-events on)');
    }
    return problems;
};

const findMainCss = (buildDir) => {
    return fs.readdirSync(buildDir)
        .map((entry) => path.join(buildDir, entry, 'styles', 'main.css'))
        .filter((file) => fs.existsSync(file));
};

const checkBuild = (buildDir) => {
    const files = findMainCss(buildDir);
    if (files.length !== 1) {
        return [`expected one <commit>/styles/main.css in ${buildDir}, found ${files.length}`];
    }
    return stylesProblems(fs.readFileSync(files[0], 'utf8')).map((problem) => `${path.relative(buildDir, files[0])}: ${problem}`);
};

if (require.main === module) {
    const buildDir = path.resolve(process.argv[2] || path.join(ROOT, 'build-webos'));
    const problems = checkBuild(buildDir);
    if (problems.length > 0) {
        problems.forEach((problem) => console.error(`check-styles: ${problem}`));
        process.exit(1);
    }
    console.log('check-styles: ok (html:root sizes the layout without max()/env(); no min()/max()/clamp() left; flex-gap-polyfill pointer-events switched by the Button root)');
}

module.exports = { REQUIRED, stylesProblems, checkBuild };
