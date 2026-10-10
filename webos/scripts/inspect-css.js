#!/usr/bin/env node
// Inspects a built main.css for what Chromium 53 (webOS TV 4.x) cannot handle (F2.1).
//   node webos/scripts/inspect-css.js [build-webos/<hash>/styles/main.css] [--desktop <css>] [--json]
// Reports:
//   - rules with gap/row-gap/column-gap and the display of their element: the rule itself or a
//     related rule (same media context, last compound's classes a subset, as in
//     webos/webpack/postcss-apply-fgp.js). Fails on a flex gap without flex-gap-polyfill and on an
//     "inert" polyfill: rewritten, but the element never gets the `--has-fgp` switch, so the gap
//     stays 0 and pointer-events turns unset. Lists the grid elements for the Fase 2 fallback;
//   - raw :focus-visible/:focus-within selectors (Chromium 53 drops the whole rule), focus classes
//     hashed by CSS modules (no polyfill sets them), and fewer rewritten selectors than the raw
//     ones in the desktop main.css (default build/<hash>/styles/main.css, skipped if missing);
//   - the MetaItem highlight rule rewritten to [focus-within];
//   - leftovers the preset should have removed (#rrggbbaa, inset, logical properties).
// Exits 1 when an acceptance check fails.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// postcss is a dependency of postcss-loader, not of the app (pnpm keeps it out of the root).
const postcss = require(require.resolve('postcss', { paths: [path.dirname(require.resolve('postcss-loader'))] }));

const print = (line) => process.stdout.write(`${line}\n`);

const { lastClasses } = require('../webpack/postcss-apply-fgp');

const findCss = (buildDir) => {
    const dir = path.join(ROOT, buildDir);
    const hash = fs.existsSync(dir) && fs.readdirSync(dir).find((name) => fs.existsSync(path.join(dir, name, 'styles', 'main.css')));
    return hash ? path.join(dir, hash, 'styles', 'main.css') : null;
};

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const desktopIndex = args.indexOf('--desktop');
const desktopFile = desktopIndex === -1 ? findCss('build') : args[desktopIndex + 1];
const positional = args.filter((arg, index) => !arg.startsWith('--') && (desktopIndex === -1 || index !== desktopIndex + 1));
const file = positional[0] || findCss('build-webos');
if (!file) {
    throw new Error('build-webos/<hash>/styles/main.css not found: run pnpm webos:build');
}
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

const isFlex = (value) => /^(inline-)?flex$/.test(value);
const isGrid = (value) => /^(inline-)?grid$/.test(value);
const mediaOf = (rule) => (rule.parent && rule.parent.type === 'atrule' ? `@${rule.parent.name} ${rule.parent.params}` : '');
const declsOf = (rule) => rule.nodes.filter((node) => node.type === 'decl');

const nodes = rules.map((rule) => {
    const decls = declsOf(rule);
    const display = decls.filter((decl) => decl.prop === 'display').map((decl) => decl.value.trim()).pop();
    return {
        rule,
        media: mediaOf(rule),
        display: display === undefined ? null : display,
        // The polyfill's switch: `--has-fgp: ;` (empty) on the container.
        switch: decls.some((decl) => decl.prop === '--has-fgp' && decl.value.trim() === ''),
        compounds: rule.selectors.map(lastClasses),
    };
});

// Rules for the same element: top-level or same media, last compound's classes a subset.
const relatedTo = (node) => nodes.filter((other) => {
    if (other.rule === node.rule) return false;
    if (other.media !== '' && other.media !== node.media) return false;
    return other.compounds.some((classes) => {
        return classes.length > 0 && node.compounds.some((own) => classes.every((name) => own.includes(name)));
    });
});

const gap = { flex: 0, flexActive: 0, flexRaw: [], inert: [], gridOwn: 0, gridElsewhere: [], unknown: 0, unknownRaw: [] };
const focus = { focusVisible: [], focusWithin: [], hashed: [], focusVisibleRewritten: 0, focusWithinRewritten: 0 };
const leftovers = { hexAlpha: [], inset: [], logical: [] };
let metaItemRule = null;

nodes.forEach((node) => {
    const { rule } = node;
    const gapDecls = declsOf(rule).filter((decl) => GAP_PROPS.has(decl.prop));
    const polyfilled = declsOf(rule).some((decl) => /^--fgp-(row-|column-)?gap$/.test(decl.prop));
    if (gapDecls.length > 0 || polyfilled) {
        const realGaps = gapDecls.filter((decl) => !/var\(--fgp-/.test(decl.value));
        const related = relatedTo(node);
        const relatedDisplays = related.map((other) => other.display).filter((display) => display !== null);
        const switched = node.switch || related.some((other) => other.switch);
        const where = `${rule.selector}${node.media ? `  ${node.media}` : ''}`;
        const sample = `${where} { ${gapDecls.map((decl) => `${decl.prop}: ${decl.value}`).join('; ')} }`;
        if (polyfilled && !switched) {
            gap.inert.push(where);
        }
        if (node.display !== null && isGrid(node.display)) {
            gap.gridOwn += 1;
        } else if (!(node.display !== null && isFlex(node.display)) && relatedDisplays.some(isGrid)) {
            gap.gridElsewhere.push(`${where}${polyfilled ? '  (with fgp)' : ''}`);
        } else if ((node.display !== null && isFlex(node.display)) || relatedDisplays.some(isFlex)) {
            gap.flex += 1;
            if (polyfilled && switched) {
                gap.flexActive += 1;
            } else if (!polyfilled && realGaps.length > 0) {
                gap.flexRaw.push(sample);
            }
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
        if (/\.(js-)?focus-(visible|within)-[\w-]{5}(?![\w-])/.test(selector)) focus.hashed.push(selector);
        if (selector.includes('[data-focus-visible-added]')) focus.focusVisibleRewritten += 1;
        if (selector.includes('[focus-within]')) focus.focusWithinRewritten += 1;
    });

    // MetaItem: `&:global(.hovered), &:focus-within, &:global(.active), &:global(.selected)`.
    const metaItem = rule.selectors.find((selector) => /^\.meta-item-container-[\w-]{5}\[focus-within\]$/.test(selector));
    if (metaItem && declsOf(rule).some((decl) => decl.prop === 'outline-style')) {
        metaItemRule = rule.selector;
    }

    rule.walkDecls((decl) => {
        if (HEX_ALPHA.test(decl.value)) leftovers.hexAlpha.push(`${rule.selector} { ${decl.prop}: ${decl.value} }`);
        if (decl.prop === 'inset') leftovers.inset.push(rule.selector);
        if (LOGICAL_PROPS.test(decl.prop)) leftovers.logical.push(`${rule.selector} { ${decl.prop} }`);
    });
});

// The desktop build keeps the raw selectors: each one must have a rewritten counterpart.
let desktop = null;
if (desktopFile && fs.existsSync(desktopFile)) {
    desktop = { file: path.relative(ROOT, desktopFile), focusVisible: 0, focusWithin: 0 };
    postcss.parse(fs.readFileSync(desktopFile, 'utf8')).walkRules((rule) => {
        rule.selectors.forEach((selector) => {
            if (selector.includes(':focus-visible')) desktop.focusVisible += 1;
            if (selector.includes(':focus-within')) desktop.focusWithin += 1;
        });
    });
}

const checks = {
    'flex gap without the polyfill': gap.flexRaw.length === 0,
    'inert flex gap polyfill (no --has-fgp on the element)': gap.inert.length === 0,
    'raw :focus-visible selectors': focus.focusVisible.length === 0,
    'raw :focus-within selectors': focus.focusWithin.length === 0,
    'focus selectors rewritten to hashed classes': focus.hashed.length === 0,
    'MetaItem highlight rule with [focus-within]': metaItemRule !== null,
};
if (desktop) {
    checks[`rewritten focus selectors >= raw ones in the desktop CSS (${desktop.focusVisible}/${desktop.focusWithin})`] =
        focus.focusVisibleRewritten >= desktop.focusVisible && focus.focusWithinRewritten >= desktop.focusWithin;
}

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
        hashed: focus.hashed,
        desktop,
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
    print(`gap: ${gap.flex} rules in flex context (${gap.flexActive} with an active polyfill, ${gap.flexRaw.length} raw); ${gap.inert.length} inert polyfills; ${gap.gridOwn} grid rules; ${gap.unknown} with no display found (${gap.unknownRaw.length} raw, gap is a no-op there)`);
    gap.flexRaw.forEach((sample) => print(`  raw flex gap: ${sample}`));
    gap.inert.forEach((where) => print(`  inert polyfill: ${where}`));
    gap.unknownRaw.forEach((sample) => print(`  gap, no display found: ${sample}`));
    print(`gap on elements that are grid in another rule (Fase 2 grid fallback): ${gap.gridElsewhere.length}`);
    gap.gridElsewhere.forEach((where) => print(`  ${where}`));
    print(`focus: ${report.focus.focusVisible} :focus-visible and ${report.focus.focusWithin} :focus-within raw; ${focus.focusVisibleRewritten} [data-focus-visible-added] and ${focus.focusWithinRewritten} [focus-within] selectors; ${focus.hashed.length} hashed focus classes`);
    print(desktop ? `desktop CSS (${desktop.file}): ${desktop.focusVisible} :focus-visible and ${desktop.focusWithin} :focus-within raw` : 'desktop CSS not found: count comparison SKIPPED (run pnpm build or pass --desktop)');
    report.focus.raw.forEach((selector) => print(`  raw: ${selector}`));
    focus.hashed.forEach((selector) => print(`  hashed: ${selector}`));
    print(`MetaItem highlight rule: ${metaItemRule || 'NOT FOUND'}`);
    print(`leftovers: ${report.leftovers.hexAlpha} #rrggbbaa, ${report.leftovers.inset} inset, ${report.leftovers.logical} logical properties`);
    report.leftovers.samples.forEach((sample) => print(`  ${sample}`));
    Object.entries(checks).forEach(([name, ok]) => print(`${ok ? 'PASS' : 'FAIL'} ${name}`));
}

process.exitCode = report.ok ? 0 : 1;
