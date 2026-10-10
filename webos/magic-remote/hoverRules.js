// Switches the CSS :hover rules off while the Magic Remote pointer is hidden. Chromium 53 keeps
// :hover on the last element under the pointer after webOS hides it, and only a real mouse move
// updates it (measured in the emulator), so a hovered button would stay highlighted next to the
// focused item while the user navigates with the arrows.
// Each :hover becomes `:hover:not(*)`, which never matches, through CSSStyleRule.selectorText: the
// rule keeps its place and its specificity, so the cascade is the same as before once it is back.
// A selector list loses only its :hover branches. The rules are collected on the first switch
// (not at boot) and again when a stylesheet is added.

const HOVER = /:hover/g;
const DISABLED_HOVER = ':hover:not(*)';

const STYLE_RULE = 1;

// rule -> original selector; a rule already seen keeps the selector it had when enabled.
const collectRules = (rules, previous, found) => {
    Array.prototype.forEach.call(rules, (rule) => {
        if (rule.type === STYLE_RULE) {
            if (previous.has(rule)) {
                found.set(rule, previous.get(rule));
            } else if (rule.selectorText.indexOf(':hover') !== -1) {
                found.set(rule, rule.selectorText);
            }
        } else if (rule.cssRules) {
            collectRules(rule.cssRules, previous, found);
        }
    });
    return found;
};

const readRules = (sheet) => {
    try {
        return sheet.cssRules;
    } catch (_error) {
        // Cross-origin stylesheet: not ours.
        return null;
    }
};

export const disabledSelector = (selector) => selector.replace(HOVER, DISABLED_HOVER);

export const createHoverRules = (document) => {
    let sheets = null;
    let rules = new Map();
    let enabled = true;

    const refresh = () => {
        const current = Array.prototype.slice.call(document.styleSheets);
        if (sheets && current.length === sheets.length && current.every((sheet, index) => sheet === sheets[index])) {
            return;
        }
        sheets = current;
        rules = current.reduce((found, sheet) => {
            const cssRules = readRules(sheet);
            return cssRules ? collectRules(cssRules, rules, found) : found;
        }, new Map());
    };

    const setEnabled = (value) => {
        if (value === enabled) return;
        enabled = value;
        refresh();
        rules.forEach((selector, rule) => {
            rule.selectorText = enabled ? selector : disabledSelector(selector);
        });
    };

    return {
        setEnabled,
        get enabled() {
            return enabled;
        },
        get count() {
            return rules.size;
        },
    };
};
