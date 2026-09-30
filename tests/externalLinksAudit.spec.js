const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : /\.[jt]sx?$/.test(file) ? [file.replace(/\\/g, '/')] : [];
});
// These destinations come from the core's internal deepLinks or router tab definitions.
const internal = new Set([
    'src/components/LibItem/LibItem.js', 'src/components/MetaItem/MetaItem.js',
    'src/components/MetaRow/MetaRow.js', 'src/components/MetaRow/MetaRowPlaceholder/MetaRowPlaceholder.js',
    'src/components/MetaPreview/MetaPreview.js',
    'src/components/NavBar/VerticalNavBar/VerticalNavBar.js',
    'src/components/NavBar/HorizontalNavBar/SearchBar/SearchBar.js',
    'src/routes/Calendar/Table/Cell/Cell.tsx', 'src/routes/Calendar/Details/Details.tsx',
    'src/routes/Calendar/List/Item/Item.tsx'
]);
const forwarding = new Set([
    'src/components/Button/Button.tsx', 'src/components/ExternalLink/index.tsx',
    'src/routes/Settings/components/Link/Link.tsx', 'src/components/MetaPreview/MetaLinks/MetaLinks.js',
    // Explicitly out of scope: webOS only exposes deepLinks.player (tested in platformPlayers).
    'src/routes/MetaDetails/StreamsList/Stream/Stream.js'
]);
test('all declarative external destinations use ExternalLink or an audited forwarding component', () => {
    const violations = [];
    for (const file of walk('src')) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = node => {
            if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
                const tag = node.tagName.getText(source);
                const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(source), a.initializer?.getText(source) || '']));
                const href = attrs.href;
                if (tag === 'ExternalLink' && href && /^\{?['"]#/.test(href)) violations.push(file + ': internal ExternalLink');
                if ((href !== undefined || /_blank/.test(attrs.target)) && tag !== 'ExternalLink' && !forwarding.has(file)) {
                    const internalLiteral = href && /^\{?['"`]#/.test(href);
                    const externalLiteral = href && /https?:/.test(href);
                    // Checkbox renders its own ExternalLink; Settings Link selects by destination.
                    const wrapper = tag === 'Checkbox' || (tag === 'Link' && file.includes('/Settings/'));
                    if (!wrapper && (!internalLiteral && !internal.has(file) || externalLiteral || /_blank/.test(attrs.target))) violations.push(file + ': ' + tag + ' ' + href);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    expect(violations).toEqual([]);
});
test('mixed URL lists select Button for internal routes', () => {
    const settings = fs.readFileSync('src/routes/Settings/components/Link/Link.tsx', 'utf8');
    const metadata = fs.readFileSync('src/components/MetaPreview/MetaLinks/MetaLinks.js', 'utf8');
    expect(settings).toContain("href && !href.startsWith('#') ? ExternalLink : Button");
    expect(metadata).toContain("href?.startsWith('#') ? Button : ExternalLink");
});
test('window.open remains confined to desktop seam', () => {
    const hits = walk('src').filter(file => /(?:window|windowObject)\.open\s*\(/.test(fs.readFileSync(file, 'utf8')));
    expect(hits).toEqual(['src/common/Platform/safeOpenExternal.js']);
    expect(fs.readFileSync('src/App/ExternalLinkFailureModal.js', 'utf8')).not.toMatch(/console\.|Sentry|analytics|transport\./);
});
