// PostCSS plugin for the webOS build (F2.5): fallbacks for CSS that Chromium 53 (webOS TV 4.x) does
// not know. It drops declarations it cannot parse, so each case below is rewritten before the
// browser sees it (probed on the emulator: webos/docs/PESQUISA.md, F2.5 report):
//   position: sticky      -> relative, and the offsets (top/right/bottom/left) go: with sticky they
//                            are scroll thresholds, with relative they would shift the element. The
//                            element stays where the flow puts it (it just stops following the scroll).
//   backdrop-filter       -> removed (there is no blur to do). A dark translucent background that was
//                            there to sit on top of the blur gets a more opaque alpha (see SCRIM_ALPHA).
//   aspect-ratio: a / b   -> a fixed height from the width (or the max-width when the width is a
//                            percentage) of the same rule; without a length to derive it from, the
//                            declaration is removed and the element keeps its content/intrinsic ratio.
//   env(name, fallback)   -> the fallback (0px without one): a TV has no safe-area insets.
//   dvh/svh/lvh (and w, min, max, i, b) -> vh/vw...: 100vh is 1080px on the 1920x1080 TV. The
//                            `@supports` blocks that test those units can never be true here and go.
// mask-image needs nothing: autoprefixer already adds `-webkit-mask-image`, which Chromium 53 has.
// webos/scripts/check-css-fallbacks.js fails the build check if any of these is left in main.css.

const SCRIM_ALPHA = 0.7;

const VIEWPORT_UNITS = /(\d*\.?\d+)([dsl])v(h|w|min|max|i|b)\b/g;
const VIEWPORT_UNIT_TEST = /\d[dsl]v(?:h|w|min|max|i|b)\b/;
const VIEWPORT_AXIS = { i: 'w', b: 'h' };

const OFFSETS = new Set(['top', 'right', 'bottom', 'left']);
const LENGTH = /^(\d*\.?\d+)(rem|em|px)$/;
const DARK_TRANSLUCENT = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d*\.?\d+)\s*\)$/;

const replaceViewportUnits = (value) => value.replace(VIEWPORT_UNITS, (match, number, size, axis) => `${number}v${VIEWPORT_AXIS[axis] || axis}`);

// Replaces every env(name[, fallback]) of a value with its fallback; the fallback may hold more env().
const replaceEnv = (value) => {
    let output = '';
    let index = 0;
    for (;;) {
        const found = value.slice(index).search(/(^|[^\w-])env\(/);
        if (found === -1) {
            return output + value.slice(index);
        }
        const start = index + found + value.slice(index + found).indexOf('env(');
        let depth = 0;
        let end = start + 3;
        let comma = -1;
        for (; end < value.length; end++) {
            if (value[end] === '(') depth++;
            if (value[end] === ')' && --depth === 0) break;
            if (value[end] === ',' && depth === 1 && comma === -1) comma = end;
        }
        const fallback = comma === -1 ? '0px' : value.slice(comma + 1, end).trim();
        output += value.slice(index, start) + replaceEnv(fallback);
        index = end + 1;
    }
};

const lastDecl = (rule, prop) => rule.nodes.filter((node) => node.type === 'decl' && node.prop === prop).pop();

const round = (number) => Math.round(number * 10000) / 10000;

// `16 / 9` -> 9 / 16 (height per unit of width); null if it is not a ratio (`auto`, `1 / 0`).
const heightPerWidth = (value) => {
    const match = /^(\d*\.?\d+)(?:\s*\/\s*(\d*\.?\d+))?$/.exec(value.trim());
    if (!match) return null;
    const width = parseFloat(match[1]);
    const height = match[2] === undefined ? 1 : parseFloat(match[2]);
    return width > 0 && height > 0 ? height / width : null;
};

const fixedHeight = (rule, ratio) => {
    const width = lastDecl(rule, 'width');
    const maxWidth = lastDecl(rule, 'max-width');
    const length = [width, maxWidth].map((decl) => decl && LENGTH.exec(decl.value.trim())).find(Boolean);
    return length ? `${round(parseFloat(length[1]) * ratio)}${length[2]}` : null;
};

const scrim = (rule) => {
    ['background-color', 'background'].forEach((prop) => {
        const decl = lastDecl(rule, prop);
        const match = decl && DARK_TRANSLUCENT.exec(decl.value.trim());
        if (match && [match[1], match[2], match[3]].every((channel) => Number(channel) <= 40) && parseFloat(match[4]) < SCRIM_ALPHA) {
            decl.value = `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${SCRIM_ALPHA})`;
        }
    });
};

const plugin = () => ({
    postcssPlugin: 'webos-fallbacks',
    Once(root) {
        root.walkAtRules('supports', (atRule) => {
            if (VIEWPORT_UNIT_TEST.test(atRule.params)) atRule.remove();
        });
        root.walkAtRules((atRule) => {
            atRule.params = replaceViewportUnits(atRule.params);
        });

        const sticky = new Set();
        const backdrop = [];
        const aspect = [];
        root.walkDecls((decl) => {
            if (decl.value.includes('env(')) decl.value = replaceEnv(decl.value);
            decl.value = replaceViewportUnits(decl.value);
            if (decl.parent.type !== 'rule') return;
            if (decl.prop === 'position' && /^(-webkit-)?sticky$/.test(decl.value.trim())) sticky.add(decl.parent);
            if (/^(-webkit-)?backdrop-filter$/.test(decl.prop)) backdrop.push(decl);
            if (decl.prop === 'aspect-ratio') aspect.push(decl);
        });

        sticky.forEach((rule) => {
            rule.walkDecls((decl) => {
                if (decl.parent !== rule) return;
                if (decl.prop === 'position' && /^(-webkit-)?sticky$/.test(decl.value.trim())) decl.value = 'relative';
                if (OFFSETS.has(decl.prop)) decl.remove();
            });
        });

        backdrop.forEach((decl) => {
            const rule = decl.parent;
            if (decl.value.trim() !== 'none') scrim(rule);
            decl.remove();
        });

        aspect.forEach((decl) => {
            const rule = decl.parent;
            const ratio = heightPerWidth(decl.value);
            const height = ratio && !lastDecl(rule, 'height') && fixedHeight(rule, ratio);
            if (height) decl.replaceWith({ prop: 'height', value: height });
            else decl.remove();
        });
    },
});

plugin.postcss = true;
plugin.replaceEnv = replaceEnv;

module.exports = plugin;
