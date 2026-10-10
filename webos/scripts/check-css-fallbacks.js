#!/usr/bin/env node
// Guard of the CSS fallbacks (part of pnpm webos:check-syntax):
//   node webos/scripts/check-css-fallbacks.js [build-webos]
// Chromium 53 (webOS TV 4.x) drops a declaration it cannot parse, so main.css of the webOS build
// must not carry what webos/webpack/postcss-fallbacks.js rewrites: position: sticky (and
// -webkit-sticky), backdrop-filter, aspect-ratio, env(), dvh/svh/lvh viewport units, and a `mask`
// property without its -webkit- twin in the same rule. Exits with 1 and lists the problems.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// The postcss the build uses (through postcss-loader; not a direct dependency).
const postcss = require(require.resolve('postcss', {
    paths: [path.dirname(require.resolve('postcss-loader', { paths: [ROOT] }))]
}));

const VIEWPORT_UNIT = /\d[dsl]v(?:h|w|min|max|i|b)\b/;

const where = (node) => {
    const rule = node.type === 'decl' ? node.parent : node;
    return rule && rule.selector ? rule.selector : `@${rule.name} ${rule.params}`;
};

// Problems in a CSS text ([] if none), each naming the selector that holds the leftover.
const fallbackProblems = (css) => {
    const problems = [];
    postcss.parse(css).walk((node) => {
        if (node.type === 'atrule') {
            if (VIEWPORT_UNIT.test(node.params)) problems.push(`@${node.name} ${node.params} uses a dvh/svh/lvh unit`);
            return;
        }
        if (node.type !== 'decl') return;
        const value = node.value.trim();
        if (node.prop === 'position' && /^(-webkit-)?sticky$/.test(value)) {
            problems.push(`${where(node)}: position: ${value} (Chromium 53 has no sticky)`);
        }
        if (/^(-webkit-)?backdrop-filter$/.test(node.prop)) {
            problems.push(`${where(node)}: ${node.prop} (Chromium 53 has no backdrop-filter)`);
        }
        if (node.prop === 'aspect-ratio') {
            problems.push(`${where(node)}: aspect-ratio (Chromium 53 has no aspect-ratio)`);
        }
        if (/(^|[^\w-])env\(/.test(value)) {
            problems.push(`${where(node)}: ${node.prop} uses env() (Chromium 53 has no env())`);
        }
        if (VIEWPORT_UNIT.test(value)) {
            problems.push(`${where(node)}: ${node.prop} uses a dvh/svh/lvh unit (${value})`);
        }
        if (/^mask(-|$)/.test(node.prop) && !node.parent.nodes.some((other) => other.type === 'decl' && other.prop === `-webkit-${node.prop}`)) {
            problems.push(`${where(node)}: ${node.prop} without -webkit-${node.prop} (Chromium 53 only has the prefixed mask)`);
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
    return fallbackProblems(fs.readFileSync(files[0], 'utf8')).map((problem) => `${path.relative(buildDir, files[0])}: ${problem}`);
};

if (require.main === module) {
    const buildDir = path.resolve(process.argv[2] || path.join(ROOT, 'build-webos'));
    const problems = checkBuild(buildDir);
    if (problems.length > 0) {
        problems.forEach((problem) => console.error(`check-css-fallbacks: ${problem}`));
        process.exit(1);
    }
    console.log('check-css-fallbacks: ok (no sticky, backdrop-filter, aspect-ratio, env(), dvh/svh/lvh or unprefixed mask in main.css)');
}

module.exports = { fallbackProblems, checkBuild };
