const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const read = (file) => fs.readFileSync(file, 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
});
const sources = walk('src'); // T0.4 fixtures, tests and docs are outside src.

test('production sources do not access document.cookie (dot or bracket notation)', () => {
    const violations = [];
    for (const file of sources) {
        const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
        const visit = (node) => {
            if ((ts.isPropertyAccessExpression(node) && node.name.text === 'cookie') ||
                (ts.isElementAccessExpression(node) && node.argumentExpression &&
                    ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'cookie')) {
                violations.push(file + ':' + node.getText(source));
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    expect(violations).toEqual([]);
});

test('Sentry and translations have no cookie/cache plugins configured', () => {
    const entry = read('src/index.js');
    expect(entry).toMatch(/Sentry\.init\(\{\s*dsn:\s*process\.env\.SENTRY_DSN\s*\}\)/);
    expect(entry.match(/\.use\([^)]*\)/g)).toEqual(['.use(initReactI18next)']);
    const pkg = JSON.parse(read('package.json'));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(name =>
        /cookie|(?:i18next|sentry).*(?:cache|backend|detector)/i.test(name))).toEqual([]);
    for (const file of sources) {
        expect(read(file)).not.toMatch(/(?:i18next|sentry)[\w/-]*(?:cookie|cache|backend|detector)/i);
    }
});

test('core worker routes all storage operations through Bridge to the window', () => {
    const worker = read(require.resolve('@stremio/stremio-core-web/worker'));
    expect(worker).toMatch(/new Bridge\(self, self\)/);
    for (const [operation, method, args] of [['get', 'getItem', 'key'], ['set', 'setItem', 'key, value'], ['remove', 'removeItem', 'key']]) {
        const start = worker.indexOf('self.local_storage_' + operation + '_item =');
        expect(start).toBeGreaterThan(-1);
        const end = worker.indexOf('}();', start);
        expect(worker.slice(start, end)).toContain("bridge.call(['localStorage', '" + method + "'], [" + args + '])');
    }
    expect(read('src/core/createTransport.ts')).toContain('new Bridge(window, worker)');
});

test('Clear data remains wired to clear storage then reload', () => {
    const source = read('src/core/Error/Error.tsx');
    expect(source).toMatch(/const clearData = React\.useCallback\(\(\) => \{\s*window\.localStorage\.clear\(\);\s*window\.location\.reload\(\);\s*\}, \[\]\)/);
    expect(source).toMatch(/title=\{t\('CLEAR_DATA'\)\} onClick=\{clearData\}/);
});
