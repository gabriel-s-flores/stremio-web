#!/usr/bin/env node
// Inspects a built main.css for what Chromium 53 (webOS TV 4.x) cannot handle (F2.1).
//   node webos/scripts/inspect-css.js [build-webos/<hash>/styles/main.css] [--json]
// Reports:
//   - rules with gap/row-gap/column-gap in a flex context (display: flex in the same rule or in
//     another rule with the same selector) and whether flex-gap-polyfill rewrote them;
//   - raw :focus-visible/:focus-within selectors (Chromium 53 drops the whole rule);
//   - the MetaItem highlight rule rewritten to [focus-within];
//   - leftovers the preset should have removed (#rrggbbaa, inset, logical properties).
// Exits 1 when an acceptance check fails.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// postcss is a dependency of postcss-loader, not of the app (pnpm keeps it out of the root).
const postcss = require(require.resolve('postcss', { paths: [path.dirname(require.resolve('postcss-loader'))] }));

const print = (line) => process.stdout.write(`${line}\n`);

const findCss = () => {
    const dir = path.join(ROOT, 'build-webos');
    const hash = fs.readdirSync(dir).find((name) => fs.existsSync(path.join(dir, name, 'styles', 'main.css')));
    if (!hash) {
        throw new Error('build-webos/<hash>/styles/main.css not found: run pnpm webos:build');
    }
    return path.join(dir, hash, 'styles', 'main.css');
};

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const file = args.find((arg) => !arg.startsWith('--')) || findCss();
const css = fs.readFileSync(file, 'utf8');
const root = postcss.parse(css);

const GAP_PROPS = new Set(['gap', 'row-gap', 'column-gap', 'grid-gap', 'grid-row-gap', 'grid-column-gap']);
const LOGICAL_PROPS = /^(margin|padding|border|inset)-(block|inline)(-(start|end))?(-(width|style|color))?$|^(block|inline)-size$|^(min|max)-(block|inline)-size$/;
const HEX_ALPHA = /#([0-9a-f]{4}|[0-9a-f]{8})\b/i;

const rules = [];
root.walkRules((rule) => {
    // Rules inside @keyframes have percentage selectors, not element selectors.
    if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) {
        return;
    }
    rules.push(rule);
});

const displayBySelector = new Map();
rules.forEach((rule) => {
    rule.walkDecls('display', (decl) => {
        rule.selectors.forEach((selector) => {
            const values = displayBySelector.get(selector) || new Set();
            values.add(decl.value.trim());
            displayBySelector.set(selector, values);
        });
    });
});

const isFlex = (value) => /^(inline-)?flex$/.test(value);
const isGrid = (value) => /^(inline-)?grid$/.test(value);

const gap = { flex: 0, flexPolyfilled: 0, flexRaw: [], grid: 0, unknown: 0, unknownRaw: [] };
const focus = { focusVisible: [], focusWithin: [], focusVisibleRewritten: 0, focusWithinRewritten: 0 };
const leftovers = { hexAlpha: [], inset: [], logical: [] };
let metaItemRule = null;

rules.forEach((rule) => {
    const gapDecls = rule.nodes.filter((node) => node.type === 'decl' && GAP_PROPS.has(node.prop));
    const realGaps = gapDecls.filter((decl) => !/var\(--fgp-/.test(decl.value));
    if (gapDecls.length > 0) {
        // The rule's own display wins; otherwise any display given to the same selector elsewhere.
        const displays = new Set();
        rule.walkDecls('display', (decl) => displays.add(decl.value.trim()));
        if (displays.size === 0) {
            rule.selectors.forEach((selector) => {
                (displayBySelector.get(selector) || []).forEach((value) => displays.add(value));
            });
        }
        const polyfilled = rule.nodes.some((node) => node.type === 'decl' && /^--fgp-(row-|column-)?gap$/.test(node.prop));
        const sample = `${rule.selector} { ${gapDecls.map((decl) => `${decl.prop}: ${decl.value}`).join('; ')} }`;
        if ([...displays].some(isFlex)) {
            gap.flex += 1;
            if (polyfilled) {
                gap.flexPolyfilled += 1;
            } else if (realGaps.length > 0) {
                gap.flexRaw.push(sample);
            }
        } else if ([...displays].some(isGrid)) {
            gap.grid += 1;
        } else {
            gap.unknown += 1;
            if (!polyfilled && realGaps.length > 0) {
                gap.unknownRaw.push(sample);
            }
        }
    }

    rule.selectors.forEach((selector) => {
        if (selector.includes(':focus-visible')) focus.focusVisible.push(selector);
        if (selector.includes(':focus-within')) focus.focusWithin.push(selector);
        if (selector.includes('[data-focus-visible-added]')) focus.focusVisibleRewritten += 1;
        if (selector.includes('[focus-within]')) focus.focusWithinRewritten += 1;
    });

    // MetaItem: `&:global(.hovered), &:focus-within, &:global(.active), &:global(.selected)`.
    const metaItem = rule.selectors.find((selector) => /^\.meta-item-container-[\w-]{5}\[focus-within\]$/.test(selector));
    if (metaItem && rule.nodes.some((node) => node.type === 'decl' && node.prop === 'outline-style')) {
        metaItemRule = rule.selector;
    }

    rule.walkDecls((decl) => {
        if (HEX_ALPHA.test(decl.value)) leftovers.hexAlpha.push(`${rule.selector} { ${decl.prop}: ${decl.value} }`);
        if (decl.prop === 'inset') leftovers.inset.push(rule.selector);
        if (LOGICAL_PROPS.test(decl.prop)) leftovers.logical.push(`${rule.selector} { ${decl.prop} }`);
    });
});

const checks = {
    'flex gap without the polyfill': gap.flexRaw.length === 0,
    'raw :focus-visible selectors': focus.focusVisible.length === 0,
    'raw :focus-within selectors': focus.focusWithin.length === 0,
    'MetaItem highlight rule with [focus-within]': metaItemRule !== null,
};

const report = {
    file: path.relative(ROOT, file),
    bytes: Buffer.byteLength(css),
    rules: rules.length,
    gap,
    focus: {
        focusVisible: focus.focusVisible.length,
        focusWithin: focus.focusWithin.length,
        focusVisibleRewritten: focus.focusVisibleRewritten,
        focusWithinRewritten: focus.focusWithinRewritten,
        raw: [...focus.focusVisible, ...focus.focusWithin],
    },
    metaItemRule,
    leftovers: {
        hexAlpha: leftovers.hexAlpha.length,
        inset: leftovers.inset.length,
        logical: leftovers.logical.length,
        samples: [...leftovers.hexAlpha, ...leftovers.inset, ...leftovers.logical].slice(0, 10),
    },
    checks,
    ok: Object.values(checks).every(Boolean),
};

if (asJson) {
    print(JSON.stringify(report, null, 2));
} else {
    print(`${report.file}: ${report.bytes} bytes, ${report.rules} rules`);
    print(`gap: ${gap.flex} rules in flex context (${gap.flexPolyfilled} polyfilled, ${gap.flexRaw.length} raw), ${gap.grid} in grid context, ${gap.unknown} with no display found (${gap.unknownRaw.length} raw)`);
    gap.flexRaw.forEach((sample) => print(`  raw flex gap: ${sample}`));
    gap.unknownRaw.forEach((sample) => print(`  gap, no display found: ${sample}`));
    print(`focus: ${report.focus.focusVisible} :focus-visible and ${report.focus.focusWithin} :focus-within raw; ${focus.focusVisibleRewritten} [data-focus-visible-added] and ${focus.focusWithinRewritten} [focus-within] selectors`);
    report.focus.raw.forEach((selector) => print(`  raw: ${selector}`));
    print(`MetaItem highlight rule: ${metaItemRule || 'NOT FOUND'}`);
    print(`leftovers: ${report.leftovers.hexAlpha} #rrggbbaa, ${report.leftovers.inset} inset, ${report.leftovers.logical} logical properties`);
    report.leftovers.samples.forEach((sample) => print(`  ${sample}`));
    Object.entries(checks).forEach(([name, ok]) => print(`${ok ? 'PASS' : 'FAIL'} ${name}`));
}

process.exitCode = report.ok ? 0 : 1;
