// PostCSS plugin for the webOS build (F1.6), run right after flex-gap-polyfill.
//
// flex-gap-polyfill gives every polyfilled flex container `pointer-events: none` and its children
// `pointer-events: auto`, so the container, shifted up and left by the negative margin that emulates
// the gap, does not catch clicks meant for its neighbors (e.g. the Trakt row over the Privacy Policy
// link in Settings). Two side effects on buttons:
//   - a button that is itself a flex container with a gap (dropdown labels, the Addons
//     Uninstall/Share buttons) only took clicks on its text and icon: 76–92% of it was dead;
//   - the children of a disabled button got `auto` back, though upstream disables a Button only
//     with `pointer-events: none` (inherited by its children).
// The values become switches, `var(--fgp-pointer-events, none)` and
// `var(--fgp-item-pointer-events, auto)`, and the root of the Button component
// (src/components/Button/Button.less) sets them: auto on a button, none on a disabled one.

const path = require('path');

const BUTTON_LESS = path.join('src', 'components', 'Button', 'Button.less');

const CONTAINER = /^var\(--has-fgp\)\s+none$/;
const ITEM = /^var\(--parent-has-fgp\)\s+auto$/;

const SWITCHES = {
    '.button-container': { '--fgp-pointer-events': 'auto' },
    '.button-container:global(.disabled)': { '--fgp-pointer-events': 'none', '--fgp-item-pointer-events': 'none' },
};

const plugin = () => ({
    postcssPlugin: 'webos-fgp-pointer-events',
    Once(root, { result }) {
        root.walkDecls('pointer-events', (decl) => {
            const value = decl.value.trim();
            if (CONTAINER.test(value)) {
                decl.value = 'var(--has-fgp) var(--fgp-pointer-events, none)';
            } else if (ITEM.test(value)) {
                decl.value = 'var(--parent-has-fgp) var(--fgp-item-pointer-events, auto)';
            }
        });
        const file = result.opts.from || '';
        if (file.endsWith(BUTTON_LESS)) {
            root.walkRules((rule) => {
                const switches = SWITCHES[rule.selector];
                if (rule.parent.type === 'root' && switches) {
                    Object.entries(switches).forEach(([prop, value]) => rule.append({ prop, value }));
                }
            });
        }
    },
});

plugin.postcss = true;

module.exports = plugin;
