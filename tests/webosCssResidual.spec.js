const fs = require('fs');
const path = require('path');
const { compile, root } = require('./helpers/compileFocusLess');

// Preserve quoted URLs/strings while removing both LESS and CSS comments.
const uncomment = (source) => source.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (match, quoted) => quoted || '');
const forbidden = /(?:^|[;{}]\s*)\s*(?:inset(?:-[\w-]+)?|(?:min-|max-)?(?:inline|block)-size|(?:margin|padding|scroll-margin|scroll-padding|border)-(?:inline|block)(?:-[\w-]+)?|border-(?:start|end)-(?:start|end)-radius)\s*:|:(?:is|where)\s*\(/i;
function unguardedSnap(source) {
    const stack = [];
    const hits = [];
    for (const token of uncomment(source).matchAll(/([^{};]*)([{};])/g)) {
        const [, text, end] = token;
        if (/scroll-snap-[\w-]+\s*:/.test(text) && !stack.some((s) => /when\s*\(\s*@webos\s*=\s*false\s*\)/.test(s))) hits.push(text.trim());
        if (end === '{') stack.push(text);
        if (end === '}') stack.pop();
    }
    return hits;
}
const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter((f) => /\.(less|css)$/.test(f));
test.each(files)('residual CSS: %s', (file) => {
    const source = uncomment(fs.readFileSync(path.join(root, 'src', file), 'utf8'));
    expect(source).not.toMatch(forbidden);
    expect(unguardedSnap(source)).toEqual([]);
});
test('scanner rejects residuals and snap hidden inside unrelated guards', () => {
    for (const declaration of ['inset: 0', 'inset-inline-start: 0', 'margin-inline: 0', 'padding-block-end: 0', 'max-inline-size: 2px', 'border-start-end-radius: 2px', 'scroll-padding-block-start: 0']) {
        expect(`.a { ${declaration}; }`).toMatch(forbidden);
    }
    expect('.a:is(.b) {}').toMatch(forbidden);
    expect('.a:where(.b) {}').toMatch(forbidden);
    expect(unguardedSnap('@supports (display: grid) { .a { scroll-snap-align: start; } }')).toHaveLength(1);
    expect(unguardedSnap('& when (@webos = false) { .a { scroll-snap-align: start; } }')).toEqual([]);
    expect(unguardedSnap('/* scroll-snap-align: start; */ // scroll-snap-type: x;')).toEqual([]);
    expect(uncomment('/* inset: 0; */ // :is(x)\n.a { color: red; }')).not.toMatch(forbidden);
});
test('compiled webOS removes all snap; desktop retains both declarations', async () => {
    const file = 'components/MetaRow/styles.less';
    expect(await compile(file, true)).not.toMatch(/scroll-snap-/);
    const desktop = await compile(file, false);
    expect(desktop).toContain('scroll-snap-type: x mandatory;');
    expect(desktop).toContain('scroll-snap-align: start;');
});
test.each([true, false])('Calendar keeps physical padding behind supports (webOS=%s)', async (webos) => {
    const css = await compile('routes/Calendar/List/List.less', webos);
    expect(css).toContain('@supports (scroll-padding-top: 0.15rem)');
    expect(css).toContain('scroll-padding-top: 0.15rem;');
    expect(css).not.toContain('scroll-padding-block');
});
