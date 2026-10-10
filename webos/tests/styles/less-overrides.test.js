// webos/webpack/less-overrides.js and the extension order of webos/webpack/app.js (F2.3).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findOverride } = require('../../webpack/less-overrides');
const app = require('../../webpack/app');

const ROOT = path.resolve(__dirname, '..', '..', '..');

describe('findOverride', () => {
    let dir;
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'less-overrides-'));
        ['A.less', 'A.webos.less', 'B.less'].forEach((name) => fs.writeFileSync(path.join(dir, name), ''));
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('finds the .webos.less next to a relative .less request', () => {
        expect(findOverride('./A.less', dir)).toBe(path.join(dir, 'A.webos.less'));
    });

    test('leaves alone a style sheet without an override', () => {
        expect(findOverride('./B.less', dir)).toBeNull();
    });

    test('leaves alone a request that already names an override, other files and packages', () => {
        expect(findOverride('./A.webos.less', dir)).toBeNull();
        expect(findOverride('./A.js', dir)).toBeNull();
        expect(findOverride('some-package/styles.less', dir)).toBeNull();
        expect(findOverride('style-loader!./A.less', dir)).toBeNull();
    });

    test('resolves the stremio/ alias to src/', () => {
        expect(findOverride('stremio/components/Scale/Scale.less', dir))
            .toBe(path.join(ROOT, 'src', 'components', 'Scale', 'Scale.webos.less'));
    });
});

describe('the overrides of the repository', () => {
    test('every .webos.less imports the file it overrides, and that file exists', () => {
        const found = [];
        const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).forEach((entry) => {
            const file = path.join(folder, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (entry.name.endsWith('.webos.less')) found.push(file);
        });
        walk(path.join(ROOT, 'src'));
        expect(found.length).toBeGreaterThan(0);
        found.forEach((file) => {
            const original = `${path.basename(file, '.webos.less')}.less`;
            expect(fs.existsSync(path.join(path.dirname(file), original))).toBe(true);
            expect(fs.readFileSync(file, 'utf8')).toContain(`'./${original}'`);
        });
    });
});

describe('webos/webpack/app resolve.extensions', () => {
    test('puts .webos.less after the scripts, so ./Table finds Table.tsx and not Table.webos.less', () => {
        // The plugins app.js replaces are found by constructor name.
        class EnvironmentPlugin { constructor() { this.defaultValues = {}; } }
        class CopyPlugin {}
        class HtmlWebpackPlugin {}
        class GenerateSW {}
        const config = app({
            entry: { main: './src/index.js' },
            output: {},
            plugins: [new EnvironmentPlugin(), new CopyPlugin(), new HtmlWebpackPlugin(), new GenerateSW()],
            resolve: { extensions: ['.tsx', '.ts', '.js', '.json', '.less', '.wasm'] },
        });
        const { extensions } = config.resolve;
        expect(extensions.indexOf('.tsx')).toBeGreaterThan(extensions.indexOf('.webos.js'));
        expect(extensions.indexOf('.webos.less')).toBeGreaterThan(extensions.indexOf('.js'));
        expect(extensions.indexOf('.webos.less')).toBeLessThan(extensions.indexOf('.less'));
    });
});
