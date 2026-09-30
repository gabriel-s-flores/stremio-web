const fs = require('fs');
const path = require('path');
const less = require('less');

const root = path.resolve(__dirname, '..');
const CELL = 'routes/Calendar/Table/Cell/Cell.less';
const CONDITION = 'not (aspect-ratio: 2 / 3)';

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

const find = (declarations, selector, property, supports) => declarations.find((item) =>
    item.property === property
    && item.supports.length === supports.length
    && item.supports.every((condition, index) => condition === supports[index])
    && item.selectors.some((candidate) => candidate === selector)
);

// aspect-ratio drops the spaces around the slash when it round-trips through LESS.
const normalized = (value) => value.replace(/\s*\/\s*/g, '/');

describe.each([false, true])('aspect-ratio fallback (webos=%s)', (webos) => {
    let compiled;
    beforeAll(async () => {
        compiled = await compile(CELL, webos);
    });

    test('Calendar Cell is the only file using aspect-ratio', () => {
        const files = [];
        const extensions = new Set(['.less', '.css']);
        function scan(directory) {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const filename = path.join(directory, entry.name);
                if (entry.isDirectory()) scan(filename);
                else if (extensions.has(path.extname(entry.name)) && /aspect-ratio\s*:/.test(fs.readFileSync(filename, 'utf8'))) {
                    files.push(path.relative(path.join(root, 'src'), filename).replace(/\\/g, '/'));
                }
            }
        }
        scan(path.join(root, 'src'));
        expect(files).toEqual([CELL]);
    });

    test('keeps native aspect-ratio outside any feature query', () => {
        const item = find(compiled, '.cell .items .item', 'aspect-ratio', []);
        const poster = find(compiled, '.cell .items .item .poster', 'aspect-ratio', []);
        expect(item).toBeDefined();
        expect(poster).toBeDefined();
        expect(normalized(item.value)).toBe('2/3');
        expect(normalized(poster.value)).toBe('2/3');
    });

    test('native path keeps the poster in flow and the icon statically positioned', () => {
        expect(find(compiled, '.cell .items .item .poster', 'position', [])).toBeUndefined();
        expect(find(compiled, '.cell .items .item .icon', 'top', [])).toBeUndefined();
        expect(find(compiled, '.cell .items .item .poster', 'position', [CONDITION])).toBeDefined();
    });

    test('fallback block gives the items row a definite height for old Blink', () => {
        expect(find(compiled, '.cell .items', 'flex-basis', [CONDITION])).toMatchObject({ value: 'auto' });
        expect(find(compiled, '.cell .items', 'height', [CONDITION])).toMatchObject({ value: 'calc(100% - 2rem)' });
        expect(find(compiled, '.cell .items', 'height', [])).toBeUndefined();
    });

    test('fallback block turns the item into a measured box', () => {
        // JS pins the width; the CSS fallback only needs a positioned block-ish box.
        expect(find(compiled, '.cell .items .item', 'position', [CONDITION])).toMatchObject({ value: 'relative' });
        expect(find(compiled, '.cell .items .item', 'display', [CONDITION])).toMatchObject({ value: 'inline-block' });
        expect(find(compiled, '.cell .items .item', 'max-width', [CONDITION])).toBeUndefined();
    });

    test('fallback block recenters the icon without relying on static position', () => {
        expect(find(compiled, '.cell .items .item .icon', 'top', [CONDITION])).toMatchObject({ value: '50%' });
        expect(find(compiled, '.cell .items .item .icon', 'left', [CONDITION])).toMatchObject({ value: '50%' });
        expect(find(compiled, '.cell .items .item .icon', 'transform', [CONDITION])).toMatchObject({ value: 'translate(-50%, -50%)' });
    });

    test('fallback block stretches the poster over the measured item box', () => {
        const poster = (property, value) => expect(
            find(compiled, '.cell .items .item .poster', property, [CONDITION])
        ).toMatchObject({ property, value });
        poster('position', 'absolute');
        poster('top', '0');
        poster('right', '0');
        poster('bottom', '0');
        poster('left', '0');
        poster('width', '100%');
        poster('height', '100%');
        expect(find(compiled, '.cell .items .item .poster', 'object-fit', [])).toMatchObject({ value: 'cover' });
    });

    test('fallback declarations come after the native ones in source order', () => {
        const aspectIndexes = compiled
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => item.property === 'aspect-ratio')
            .map(({ index }) => index);
        const fallbackIndexes = compiled
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => item.supports.length > 0)
            .map(({ index }) => index);
        expect(aspectIndexes).toHaveLength(2);
        expect(fallbackIndexes.length).toBeGreaterThan(0);
        expect(Math.min(...fallbackIndexes)).toBeGreaterThan(Math.max(...aspectIndexes));
    });

    test('compiled output contains a single @supports block with the negated query', () => {
        const supportsBlocks = [...new Set(compiled.flatMap((item) => item.supports))];
        expect(supportsBlocks).toEqual([CONDITION]);
    });
});
