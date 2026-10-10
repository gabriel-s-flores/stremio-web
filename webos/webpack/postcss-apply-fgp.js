// PostCSS plugin for the webOS build (F2.1), run right before flex-gap-polyfill.
//
// flex-gap-polyfill has two modes: by default it rewrites width/height/margin of every rule
// (+500 KB of CSS for this app); with `only: true` it polyfills only rules that declare both
// `display: flex` and `gap`, which misses the many rules whose flex display lives in another
// rule (a modifier, a base selector). This plugin marks every rule with a gap with the
// polyfill's own `/* apply fgp */` comment, except grid rules: Chromium 53 has no grid, and
// those get a manual fallback in Fase 2.

const GAP_PROPS = new Set(['gap', 'row-gap', 'column-gap']);

const plugin = () => ({
    postcssPlugin: 'webos-apply-fgp',
    Once(root, { comment }) {
        root.walkRules((rule) => {
            const decls = rule.nodes.filter((node) => node.type === 'decl');
            const hasGap = decls.some((decl) => GAP_PROPS.has(decl.prop));
            const isGrid = decls.some((decl) => decl.prop === 'display' && /grid$/.test(decl.value.trim()));
            if (hasGap && !isGrid) {
                rule.prepend(comment({ text: 'apply fgp' }));
            }
        });
    },
});

plugin.postcss = true;

module.exports = plugin;
