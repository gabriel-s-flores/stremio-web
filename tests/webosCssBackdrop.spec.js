const fs = require('fs');
const path = require('path');
const less = require('less');

const root = path.resolve(__dirname, '..');
const condition = '(backdrop-filter: blur(1px))';
const dark = 'rgba(12, 11, 17, 0.95)';
const modal = 'var(--modal-background-color)';
const cases = [
    ['common/Toast/ToastItem/styles.less', '.toast-item-container', modal, modal, '10px'],
    ['components/ActionsGroup/ActionsGroup.less', '.group-container', dark, 'var(--overlay-color)', '5px'],
    ['components/EventModal/styles.less', '.event-modal.event-modal', dark, 'rgba(0, 0, 0, 0.4)', '10px'],
    ['components/MetaPreview/ActionButton/styles.less', '.action-button-container', dark, 'var(--overlay-color)', '5px'],
    ['components/MetaPreview/MetaLinks/styles.less', '.meta-links-container .links-container .link-container', '#0c0b11', 'var(--overlay-color)', '5px'],
    ['routes/MetaDetails/styles.less', '.metadetails-container .metadetails-content .videos-list', dark, 'rgba(0, 0, 0, 0.4)', '15px'],
    ['routes/Player/styles.less', '.player-container .layer.menu-layer', modal, modal, '15px'],
    ['routes/Player/SideDrawer/SideDrawer.less', '.side-drawer', modal, modal, '15px'],
];

// Resolve the same source/package aliases used by less-loader, without stubbing imports.
const aliases = {
    install(lessInstance, pluginManager) {
        const manager = new lessInstance.FileManager();
        manager.supports = (filename) => filename.startsWith('~');
        manager.loadFile = (filename) => {
            const resolved = filename.startsWith('~stremio/')
                ? path.join(root, 'src', filename.slice('~stremio/'.length))
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
        modifyVars: { webos: String(webos) },
    });
    // Parse emitted CSS, not source nesting, so assertions cover LESS bubbling and order.
    const tree = await less.parse(css);
    const declarations = [];
    const text = (node) => Array.isArray(node) ? node.map(text).join('')
        : typeof node === 'string' ? node : node.toCSS({});
    function walk(node, selectors = [], supports = []) {
        if (node.selectors) selectors = node.selectors.map((selector) => text(selector).trim());
        if (node.name === '@supports') supports = [...supports, text(node.value).trim()];
        if (node.type === 'Declaration') {
            declarations.push({ selectors, supports, property: text(node.name), value: text(node.value) });
        }
        for (const child of node.rules || []) walk(child, selectors, supports);
    }
    walk(tree);
    return declarations;
}

// These selectors contain only classes and simple states. Apply specificity before source order.
function background(declarations, selector, supported, extraSelectors = []) {
    const selectors = [selector.replace(/:(hover|focus)$/, ''), selector, ...extraSelectors];
    const matches = declarations.filter((item) => item.property === 'background-color'
        && (supported || item.supports.length === 0)
        && item.selectors.some((candidate) => selectors.includes(candidate)));
    const specificity = (item) => Math.max(...item.selectors.filter((s) => selectors.includes(s))
        .map((s) => (s.match(/[.:]/g) || []).length));
    matches.sort((a, b) => specificity(a) - specificity(b));
    return matches.length ? matches[matches.length - 1].value : undefined;
}

describe.each([false, true])('backdrop progressive enhancement (webos=%s)', (webos) => {
    let compiled;
    beforeAll(async () => {
        compiled = new Map(await Promise.all(cases.map(async ([file]) => [file, await compile(file, webos)])));
    });

    test('all eight source occurrences compile exclusively inside the feature query', () => {
        const files = [];
        function scan(directory) {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const filename = path.join(directory, entry.name);
                if (entry.isDirectory()) scan(filename);
                else if (entry.name.endsWith('.less') && /backdrop-filter\s*:\s*blur/.test(fs.readFileSync(filename, 'utf8'))) {
                    files.push(path.relative(path.join(root, 'src'), filename).replace(/\\/g, '/'));
                }
            }
        }
        scan(path.join(root, 'src'));
        expect(files.sort()).toEqual(cases.map(([file]) => file).sort());
        const blurs = [...compiled.values()].flat().filter((item) => item.property === 'backdrop-filter');
        expect(blurs).toHaveLength(8);
        for (const blur of blurs) expect(blur.supports).toEqual([condition]);
    });

    test.each(cases)('%s preserves fallback and supported backgrounds', (file, selector, fallback, original, radius) => {
        const declarations = compiled.get(file);
        expect(background(declarations, selector, false)).toBe(fallback);
        expect(background(declarations, selector, true)).toBe(original);
        expect(declarations.findIndex((item) => item.property === 'background-color'
            && item.selectors.includes(selector) && item.supports.length === 0))
            .toBeLessThan(declarations.findIndex((item) => item.property === 'backdrop-filter'));
        expect(declarations.find((item) => item.property === 'backdrop-filter')).toMatchObject({
            selectors: expect.arrayContaining([selector]), value: `blur(${radius})`, supports: [condition],
        });
        if (file === 'routes/MetaDetails/styles.less') {
            const streams = selector.replace('videos-list', 'streams-list');
            expect(background(declarations, streams, false)).toBe(fallback);
            expect(background(declarations, streams, true)).toBe(original);
        }
    });

    test.each(['hover', 'focus'])('%s keeps buttons dark without support and restores original states with support', (state) => {
        const action = compiled.get(cases[3][0]);
        const links = compiled.get(cases[4][0]);
        expect(background(action, `${cases[3][1]}:${state}`, false)).toBe(dark);
        expect(background(action, `${cases[3][1]}:${state}`, true)).toBe('transparent');
        expect(background(links, `${cases[4][1]}:${state}`, false)).toBe('#2d2c32');
        expect(background(links, `${cases[4][1]}:${state}`, true)).toBe('hsla(0, 0%, 100%, 0.3)');
    });

    test('EventModal wins over ModalDialog in either stylesheet order', async () => {
        const event = compiled.get(cases[2][0]);
        const dialog = await compile('components/ModalDialog/styles.less', webos);
        for (const declarations of [[...event, ...dialog], [...dialog, ...event]]) {
            expect(background(declarations, cases[2][1], false, ['.modal-container'])).toBe(dark);
            expect(background(declarations, cases[2][1], true, ['.modal-container'])).toBe('rgba(0, 0, 0, 0.4)');
        }
    });
});
