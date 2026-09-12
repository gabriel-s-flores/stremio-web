const fs = require('fs');
const path = require('path');
const less = require('less');

const root = path.resolve(__dirname, '..');
const files = [
    'App/styles.less',
    'components/ActionMenu/ActionMenu.less',
    'components/NavBar/HorizontalNavBar/styles.less',
    'routes/MetaDetails/styles.less',
];
const unsupported = /\b(?:env|min|max|clamp)\s*\(/i;
const iosInset = 'min(env(safe-area-inset-bottom, 0rem), max(1rem, calc(var(--viewport-height-diff) - env(safe-area-inset-top, 0rem))))';

// Resolve the source/package aliases used by less-loader, including App's router CSS.
const aliases = {
    install(lessInstance, pluginManager) {
        const manager = new lessInstance.FileManager();
        manager.supports = (filename) => filename.startsWith('~');
        manager.loadFile = (filename) => {
            const resolved = filename.startsWith('~stremio/')
                ? path.join(root, 'src', filename.slice('~stremio/'.length))
                : filename.startsWith('~stremio-router/')
                    ? path.join(root, 'src/router', filename.slice('~stremio-router/'.length))
                    : require.resolve(filename.slice(1), { paths: [root] });
            return Promise.resolve({ filename: resolved, contents: fs.readFileSync(resolved, 'utf8') });
        };
        pluginManager.addFileManager(manager);
    },
};

async function compile(file, webos) {
    const filename = path.join(root, 'src', file);
    const { css } = await less.render(fs.readFileSync(filename, 'utf8'), {
        filename,
        plugins: [aliases],
        strictMath: true,
        ieCompat: false,
        modifyVars: webos === undefined ? {} : { webos: String(webos) },
    });
    const tree = await less.parse(css);
    const declarations = [];
    const text = (node) => Array.isArray(node) ? node.map(text).join('')
        : typeof node === 'string' ? node : node.toCSS({});
    function walk(node, selectors = [], media = []) {
        if (node.selectors) selectors = node.selectors.map((selector) => text(selector).trim());
        if (node.type === 'Media') media = [...media, text(node.features).trim()];
        if (node.type === 'Declaration') {
            declarations.push({ selectors, media, property: text(node.name), value: text(node.value) });
        }
        for (const child of node.rules || []) walk(child, selectors, media);
    }
    walk(tree);
    return { css, declarations };
}

function values(compiled, selector, property, media = []) {
    return compiled.declarations.filter((item) => item.selectors.includes(selector)
        && item.property === property && JSON.stringify(item.media) === JSON.stringify(media))
        .map((item) => item.value);
}

describe.each([false, true])('safe areas and CSS math (webos=%s)', (webos) => {
    let compiled;
    beforeAll(async () => {
        compiled = new Map(await Promise.all(files.map(async (file) => [file, await compile(file, webos)])));
    });

    test.each(files)('%s emits only the functions appropriate to the build', (file) => {
        if (webos) expect(compiled.get(file).css).not.toMatch(unsupported);
        else expect(compiled.get(file).css).toMatch(unsupported);
    });

    test('root insets and the complete iOS standalone formula retain their scope', () => {
        const app = compiled.get(files[0]);
        for (const side of ['top', 'right', 'bottom', 'left']) {
            expect(values(app, ':root', `--safe-area-inset-${side}`))
                .toEqual([webos ? (['left', 'right'].includes(side) ? '48px' : '27px') : `env(safe-area-inset-${side}, 0rem)`]);
        }
        expect(values(app, ':root', '--safe-area-inset-bottom', ['(display-mode: standalone)']))
            .toEqual([webos ? '27px' : iosInset]);
    });

    test('ActionMenu has bounded dimensions', () => {
        const menu = compiled.get(files[1]);
        expect(values(menu, '.menu-container', 'max-width'))
            .toEqual([webos ? '14rem' : 'min(14rem, calc(100vw - 1rem))']);
        expect(values(menu, '.menu-container', 'max-height'))
            .toEqual([webos ? '21rem' : 'min(calc(3rem * 7), calc(100vh - 1rem))']);
    });

    test('back button and MetaDetails spacing keep their original clamps on desktop', () => {
        expect(values(compiled.get(files[2]), '.horizontal-nav-bar-container .back-button-container', 'margin-left'))
            .toEqual([webos ? '0px' : 'max(0rem, calc(1rem - var(--safe-area-inset-left)))']);
        expect(values(compiled.get(files[3]), '.metadetails-container .metadetails-content .meta-preview', 'padding-left'))
            .toEqual([webos ? '15px' : 'max(1rem, calc(4rem - var(--safe-area-inset-left)))']);
    });
});

test('CSS functions occur only in the four guarded source files (Grid minmax is excluded)', () => {
    const found = [];
    function scan(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) scan(filename);
            else if (['.less', '.css'].includes(path.extname(entry.name))) {
                const source = fs.readFileSync(filename, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
                if (unsupported.test(source)) found.push(path.relative(path.join(root, 'src'), filename).replace(/\\/g, '/'));
            }
        }
    }
    scan(path.join(root, 'src'));
    expect(found.sort()).toEqual([...files].sort());
});

test.each(files)('%s defaults to the unchanged desktop path without modifyVars', async (file) => {
    expect((await compile(file)).css).toBe((await compile(file, false)).css);
});
