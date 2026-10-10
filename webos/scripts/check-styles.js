#!/usr/bin/env node
// Guard of the webOS root styles (part of pnpm webos:check-syntax):
//   node webos/scripts/check-styles.js [build-webos]
// The main.css of the build must carry the html:root rule of webos/styles/app.less: html sized by
// --dynamic-viewport-* and the --safe-area-inset-* set to zero, without max() or env(), which
// Chromium 53 lacks. Without it html, body and #app are 0px tall and the screen shows only the
// background color. Exits with 1 and lists the problems otherwise.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// The postcss the build uses (through postcss-loader; not a direct dependency).
const postcss = require(require.resolve('postcss', {
    paths: [path.dirname(require.resolve('postcss-loader', { paths: [ROOT] }))]
}));

const REQUIRED = {
    'width': 'var(--dynamic-viewport-width)',
    'height': 'var(--dynamic-viewport-height)',
    '--safe-area-inset-top': '0rem',
    '--safe-area-inset-right': '0rem',
    '--safe-area-inset-bottom': '0rem',
    '--safe-area-inset-left': '0rem',
};

// Problems with the root rule in a CSS text ([] if it is there).
const stylesProblems = (css) => {
    const declarations = {};
    postcss.parse(css).walkRules((rule) => {
        if (rule.parent.type !== 'root' || !rule.selectors.includes('html:root')) {
            return;
        }
        rule.walkDecls((decl) => {
            declarations[decl.prop] = decl.value.trim();
        });
    });
    const problems = [];
    Object.entries(REQUIRED).forEach(([prop, value]) => {
        if (declarations[prop] !== value) {
            problems.push(`html:root needs ${prop}: ${value} (found ${declarations[prop] === undefined ? 'nothing' : declarations[prop]})`);
        }
    });
    Object.entries(declarations).forEach(([prop, value]) => {
        if (/\b(max|min|clamp|env)\(/.test(value)) {
            problems.push(`html:root ${prop} uses ${value}, which Chromium 53 drops`);
        }
    });
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
    console.log('check-styles: ok (html:root sizes the layout without max()/env())');
}

module.exports = { REQUIRED, stylesProblems, checkBuild };
