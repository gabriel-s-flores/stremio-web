// PostCSS plugin for the webOS build (F2.1), run right before flex-gap-polyfill.
//
// flex-gap-polyfill has two modes: by default it rewrites width/height/margin of every rule
// (+500 KB of CSS for this app); with `only: true` it polyfills only the rules marked with its
// own `/* apply fgp */` comment or declaring both `display: flex` and `gap`. Its output only
// works on an element that also gets the `--has-fgp` switch, which it emits only in a polyfilled
// rule that declares `display: flex`. So, per .less file (CSS modules: a class is local to it):
//   - a rule with a gap is marked when its element is flex: the rule itself, a related rule
//     (same media context, its last compound's classes a subset of the gap rule's, e.g.
//     `.sheet .container` for `.sheet .container:not(.flush)`) or a FLEX_ELSEWHERE entry;
//   - the related flex rules are marked too, so the element gets the switch;
//   - grid rules are left alone (Chromium 53 has no grid; fallback in Fase 2), and so are rules
//     whose element has no known display (e.g. a block `.user`): there gap does nothing.

const GAP_PROPS = new Set(['gap', 'row-gap', 'column-gap']);

// Elements whose flex display comes from outside the file (CSS injected by JS, or the root class
// of another module): `display: flex` is added to their gap rule, a no-op on them.
const FLEX_ELSEWHERE = [
    // react-colorful injects `.react-colorful { display: flex }` from JS (subtitle colors).
    { file: /src\/components\/ColorInput\/ColorInput\.less$/, className: 'react-colorful' },
    // ActionButton's root `.action-button-container` (always flex), imported as `action-wide`.
    { file: /src\/routes\/MetaDetails\/LiveTvDetails\/Actions\/Actions\.less$/, className: 'action-wide' },
];

// Classes of the last compound selector, `:not(...)` excluded, `:global(...)` included:
// `.a .b:not(.c):global(.d)` -> ['b', 'd'].
const lastClasses = (selector) => {
    let depth = 0;
    let start = 0;
    let stripped = '';
    // Drop :not(...) (possibly nested parentheses) and find where the last compound starts.
    for (let i = 0; i < selector.length; i++) {
        const char = selector[i];
        if (depth === 0 && selector.startsWith(':not(', i)) {
            let level = 0;
            let j = i + 4;
            for (; j < selector.length; j++) {
                if (selector[j] === '(') level++;
                if (selector[j] === ')' && --level === 0) break;
            }
            i = j;
            continue;
        }
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (depth === 0 && /[\s>+~]/.test(char)) {
            start = stripped.length + 1;
        }
        stripped += char;
    }
    const compound = stripped.slice(start);
    return (compound.match(/\.[\w-]+/g) || []).map((name) => name.slice(1));
};

const isFlex = (value) => /^(inline-)?flex$/.test(value);
const isGrid = (value) => /^(inline-)?grid$/.test(value);

const mediaOf = (rule) => (rule.parent && rule.parent.type === 'atrule' ? `@${rule.parent.name} ${rule.parent.params}` : '');

// Rules of `nodes` related to `rule`: a display in the same (or top-level) media context, and a
// selector whose last compound's classes are all in one of the rule's last compounds.
const relatedRules = (rule, nodes) => {
    const compounds = rule.selectors.map(lastClasses);
    return nodes.filter((other) => {
        if (other.rule === rule || other.display === null) return false;
        if (other.media !== '' && other.media !== mediaOf(rule)) return false;
        return other.compounds.some((classes) => {
            return classes.length > 0 && compounds.some((own) => classes.every((name) => own.includes(name)));
        });
    });
};

const plugin = () => ({
    postcssPlugin: 'webos-apply-fgp',
    Once(root, { comment, decl }) {
        const file = (root.source && root.source.input && root.source.input.file) || '';
        const nodes = [];
        root.walkRules((rule) => {
            if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
            const decls = rule.nodes.filter((node) => node.type === 'decl');
            const display = decls.filter((node) => node.prop === 'display').map((node) => node.value.trim()).pop();
            nodes.push({
                rule,
                media: mediaOf(rule),
                display: display === undefined ? null : display,
                hasGap: decls.some((node) => GAP_PROPS.has(node.prop)),
                compounds: rule.selectors.map(lastClasses),
            });
        });

        const marked = new Set();
        nodes.filter((node) => node.hasGap).forEach((node) => {
            if (node.display !== null && isGrid(node.display)) return;
            const related = relatedRules(node.rule, nodes);
            let flex = node.display !== null && isFlex(node.display);
            if (!flex && related.some((other) => isGrid(other.display))) return;
            if (!flex && node.display === null && FLEX_ELSEWHERE.some((entry) => {
                return entry.file.test(file) && node.compounds.some((classes) => classes.includes(entry.className));
            })) {
                node.rule.prepend(decl({ prop: 'display', value: 'flex' }));
                flex = true;
            }
            const relatedFlex = related.filter((other) => isFlex(other.display));
            if (!flex && relatedFlex.length === 0) return;
            marked.add(node.rule);
            relatedFlex.forEach((other) => marked.add(other.rule));
        });

        marked.forEach((rule) => rule.prepend(comment({ text: 'apply fgp' })));
    },
});

plugin.postcss = true;
plugin.lastClasses = lastClasses;

module.exports = plugin;
