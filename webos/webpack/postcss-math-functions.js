// PostCSS plugin for the webOS build (F2.4), run first in the pipeline (before flex-gap-polyfill and
// cssnano, which would copy or rewrite the raw functions).
//
// Chromium 53 has no min(), max() or clamp(): a declaration using one is dropped as a whole (that is
// why html, body and #app were 0px tall, see webos/styles/app.less). Each call is replaced by the
// one of its arguments that wins in a reference environment, so the value stays an expression the
// browser understands (`clamp(1.6rem, 6.5vw, 2.5rem)` -> `2.5rem`, `clamp(2rem, 5.2vh, 3.8rem)` ->
// `5.2vh`, which still follows the viewport). The reference is a 1920x1080 TV at interface scale 1:
//   1rem = 16px, 1vw = 19.2px, 1vh = 10.8px, --interface-scale = 1
//   (inside @media (max-width/max-height: N px) the viewport is N px at most, so those rules, which a
//   TV never matches, still get values that make sense in the viewport they are for)
//   --safe-area-inset-* and env(safe-area-inset-*) = 0 (webos/styles/app.less: a TV has no safe areas)
//   --dynamic/small/large-viewport-* = the 100vw/100vh of the viewport (the dvw/svh/lvh branches of
//   :root in src/App/styles.less need units Chromium 53 lacks, so the plain ones stay).
// Arguments the reference cannot size (a % of the container, a custom property set from JS such as
// the Timeline's --content-width) are ignored while another argument can be: the length written in
// the source is the design value, the dynamic term is only a guard for a viewport that is not a TV.
// If none can be sized, the first argument without % is used (the first, if all have %).
// One exception: max-width/max-height: min(L, X%) keeps the X% term. There the % is a guard that
// keeps the box inside its container (a 360px MetaPreview column on Discover is narrower than the
// 30rem of the logo cap), while L is only a cap; elsewhere (width: min(1.25rem, 100%)) L is the value.
// Consequence: max(1rem, var(--safe-area-inset-*)) is frozen at 1rem. An overscan margin set through
// the --safe-area-inset-* variables must not rely on those paddings.
// Also in what is emitted: static calc() arithmetic is folded (`calc(3rem * 7)` -> `21rem`), env()
// of the safe areas becomes 0rem and the dvw/dvh/svh/lvh units become vw/vh.
// The webos:check-syntax step (webos/scripts/check-styles.js) fails if any call is left.

const REM = 16;
const VIEWPORT = { width: 1920, height: 1080 };

// Custom properties of src/App/styles.less / webos/styles/app.less, as unit coefficients.
const KNOWN_VARS = {
    '--interface-scale': { num: 1 },
    '--viewport-height-diff': { px: 0 },
    '--dynamic-viewport-width': { vw: 100 },
    '--dynamic-viewport-height': { vh: 100 },
    '--large-viewport-width': { vw: 100 },
    '--large-viewport-height': { vh: 100 },
    '--small-viewport-width': { vw: 100 },
    '--small-viewport-height': { vh: 100 },
    '--safe-area-inset-top': { rem: 0 },
    '--safe-area-inset-right': { rem: 0 },
    '--safe-area-inset-bottom': { rem: 0 },
    '--safe-area-inset-left': { rem: 0 },
};

const CALL = /(?<![\w-])(min|max|clamp)\(/;
const ENV_SAFE_AREA = /env\(\s*safe-area-inset-[a-z]+\s*(?:,[^()]*)?\)/g;
const DYNAMIC_UNITS = /(\d)(?:d|s|l)(v(?:w|h|min|max))\b/g;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

// Index of the parenthesis closing the one at `open`.
const closing = (text, open) => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++;
        if (text[i] === ')' && --depth === 0) return i;
    }
    return -1;
};

// Top-level comma separated parts of `text`.
const splitArgs = (text) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') depth++;
        if (text[i] === ')') depth--;
        if (text[i] === ',' && depth === 0) {
            parts.push(text.slice(start, i).trim());
            start = i + 1;
        }
    }
    parts.push(text.slice(start).trim());
    return parts;
};

// ---- Evaluation of one argument: a sum of coefficients per unit, or null when it cannot be sized ----

const combine = (a, b, sign) => {
    const sum = { ...a };
    Object.keys(b).forEach((unit) => {
        sum[unit] = (sum[unit] || 0) + sign * b[unit];
    });
    return sum;
};
const scale = (a, factor) => Object.keys(a).reduce((product, unit) => ({ ...product, [unit]: a[unit] * factor }), {});
const isScalar = (a) => Object.keys(a).every((unit) => unit === 'num');
const scalarOf = (a) => a.num || 0;

// Recursive descent over `text`. Returns null for anything it cannot size, throws on bad syntax.
const parseExpression = (text) => {
    let pos = 0;
    const skip = () => {
        while (pos < text.length && /\s/.test(text[pos])) pos++;
    };

    const parseFunctionBody = () => {
        const end = closing(text, pos);
        if (end === -1) throw new Error('unbalanced');
        const body = text.slice(pos + 1, end);
        pos = end + 1;
        return body;
    };

    const parseFactor = () => {
        skip();
        if (text[pos] === '(') {
            const body = parseFunctionBody();
            return parseExpression(body);
        }
        if (text[pos] === '-' && !NUMBER.test(text.slice(pos))) {
            pos++;
            const inner = parseFactor();
            return inner && scale(inner, -1);
        }
        const number = NUMBER.exec(text.slice(pos));
        if (number) {
            pos += number[0].length;
            const value = parseFloat(number[0]);
            const unit = /^(%|[a-z]+)/i.exec(text.slice(pos));
            if (!unit) return { num: value };
            pos += unit[0].length;
            return { [unit[0] === '%' ? 'pct' : unit[0].toLowerCase()]: value };
        }
        const name = /^[a-z-][\w-]*/i.exec(text.slice(pos));
        if (name && text[pos + name[0].length] === '(') {
            pos += name[0].length;
            const body = parseFunctionBody();
            const fn = name[0].toLowerCase();
            if (fn === 'calc') return parseExpression(body);
            if (fn === 'var') {
                const [custom] = splitArgs(body);
                return KNOWN_VARS[custom] || null;
            }
            if (fn === 'env') return /^safe-area-inset-[a-z]+$/.test(splitArgs(body)[0]) ? { rem: 0 } : null;
            return null;
        }
        throw new Error('unexpected token');
    };

    const parseTerm = () => {
        let left = parseFactor();
        for (;;) {
            skip();
            const op = text[pos];
            if (op !== '*' && op !== '/') return left;
            pos++;
            const right = parseFactor();
            if (left === null || right === null) {
                left = null;
            } else if (op === '*' && isScalar(right)) {
                left = scale(left, scalarOf(right));
            } else if (op === '*' && isScalar(left)) {
                left = scale(right, scalarOf(left));
            } else if (op === '/' && isScalar(right) && scalarOf(right) !== 0) {
                left = scale(left, 1 / scalarOf(right));
            } else {
                left = null;
            }
        }
    };

    const parseSum = () => {
        let left = parseTerm();
        for (;;) {
            skip();
            const op = text[pos];
            if (op !== '+' && op !== '-') return left;
            pos++;
            const right = parseTerm();
            left = left === null || right === null ? null : combine(left, right, op === '+' ? 1 : -1);
        }
    };

    const value = parseSum();
    skip();
    if (pos !== text.length) throw new Error('unexpected token');
    return value;
};

const evaluate = (text) => {
    try {
        return parseExpression(text);
    } catch (error) {
        return null;
    }
};

// Length in px in a viewport ({ width, height } in px), or null (% or a unit the reference does not know).
const referencePx = (sum, viewport) => {
    if (sum === null) return null;
    const unitPx = {
        px: 1,
        rem: REM,
        vw: viewport.width / 100,
        vh: viewport.height / 100,
        vmin: Math.min(viewport.width, viewport.height) / 100,
        vmax: Math.max(viewport.width, viewport.height) / 100,
    };
    let px = 0;
    for (const unit of Object.keys(sum)) {
        if (sum[unit] === 0) continue;
        if (unitPx[unit] === undefined) return null;
        px += sum[unit] * unitPx[unit];
    }
    return px;
};

// ---- Replacement of the calls ----

const format = (number) => String(Math.round(number * 10000) / 10000);

// `3rem * 7` and `1rem - 0rem` written as one length, only when nothing in it depends on the page.
const fold = (text, sum) => {
    const staticUnits = sum !== null && Object.keys(sum).every((unit) => unit === 'rem' || unit === 'px');
    if (!staticUnits || /var\(|env\(/.test(text)) return text;
    const rem = sum.rem || 0;
    const px = sum.px || 0;
    if (px === 0) return `${format(rem)}rem`;
    if (rem === 0) return `${format(px)}px`;
    return `calc(${format(rem)}rem + ${format(px)}px)`;
};

// Whether `text` needs calc() around it to be used as a value: a top-level operator.
const hasTopLevelOperator = (text) => {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        else if (depth === 0 && (text[i] === '*' || text[i] === '/' || (/[+-]/.test(text[i]) && /\s/.test(text[i - 1] || '') && /\s/.test(text[i + 1] || '')))) return true;
    }
    return false;
};

const toOperand = (text, viewport) => {
    const clean = text.replace(ENV_SAFE_AREA, '0rem').replace(DYNAMIC_UNITS, '$1$2');
    const sum = evaluate(clean);
    const folded = /^calc\(/i.test(clean) || hasTopLevelOperator(clean) ? fold(clean, sum) : clean;
    return {
        // An argument written as math without calc() (`100% - 2rem`) needs it once it stands alone.
        text: hasTopLevelOperator(folded) ? `calc(${folded})` : folded,
        px: referencePx(sum, viewport),
    };
};

const firstWithout = (operands, pattern) => operands.find((operand) => !pattern.test(operand.text)) || operands[0];

// The operand min()/max() would give in the reference; the ones the reference cannot size are left out.
const pick = (kind, operands) => {
    const sized = operands.filter((operand) => operand.px !== null);
    if (sized.length === 0) return null;
    return sized.reduce((best, operand) => {
        return (kind === 'min' ? operand.px < best.px : operand.px > best.px) ? operand : best;
    });
};

const resolveCall = (name, args, viewport, isCap) => {
    const operands = args.map((arg) => toOperand(arg, viewport));
    if (isCap && name === 'min') {
        const guard = operands.find((operand) => operand.px === null && /%/.test(operand.text));
        if (guard) return guard.text;
    }
    let chosen;
    if (name === 'clamp' && operands.length === 3) {
        const [low, value, high] = operands;
        const upper = pick('min', [value, high]);
        chosen = pick('max', [low, upper].filter(Boolean));
    } else {
        chosen = pick(name, operands);
    }
    return (chosen || firstWithout(operands, /%/)).text;
};

// `value` with every min()/max()/clamp() replaced, innermost calls first.
const resolveValue = (value, viewport = VIEWPORT, isCap = false) => {
    let result = '';
    let rest = value;
    for (;;) {
        const match = CALL.exec(rest);
        if (!match) return result + rest;
        const open = match.index + match[0].length - 1;
        const end = closing(rest, open);
        if (end === -1) return result + rest;
        // Only a call that is the whole value of a max-* property is the cap.
        const whole = isCap && match.index === 0 && end === rest.length - 1 && result === '';
        const args = splitArgs(rest.slice(open + 1, end)).map((arg) => resolveValue(arg, viewport));
        result += rest.slice(0, match.index) + resolveCall(match[1], args, viewport, whole);
        rest = rest.slice(end + 1);
    }
};

// The viewport of the reference for a declaration: the TV's, or the smaller one that an enclosing
// @media (max-width: Npx) / (max-height: Npx) limits it to.
const viewportOf = (decl) => {
    const viewport = { ...VIEWPORT };
    for (let node = decl.parent; node; node = node.parent) {
        if (node.type !== 'atrule' || node.name !== 'media') continue;
        const width = /max-width:\s*([\d.]+)px/.exec(node.params);
        const height = /max-height:\s*([\d.]+)px/.exec(node.params);
        if (width) viewport.width = Math.min(viewport.width, parseFloat(width[1]));
        if (height) viewport.height = Math.min(viewport.height, parseFloat(height[1]));
    }
    return viewport;
};

const plugin = () => ({
    postcssPlugin: 'webos-math-functions',
    Declaration(decl, { result }) {
        if (!CALL.test(decl.value)) return;
        const resolved = resolveValue(decl.value, viewportOf(decl), /^max-(width|height)$/.test(decl.prop));
        if (resolved === decl.value) return;
        result.messages.push({
            type: 'webos-math-functions',
            plugin: 'webos-math-functions',
            text: `${decl.prop}: ${decl.value} -> ${resolved}`,
        });
        decl.value = resolved;
    },
});

plugin.postcss = true;
plugin.resolveValue = resolveValue;
plugin.CALL = CALL;

module.exports = plugin;
