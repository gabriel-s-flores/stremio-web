/**
 * @jest-environment jsdom
 */
// src/common/interfaceScale.webos.ts is a copy of interfaceScale.ts with the changes below, resolved
// only by the webOS build. The first test keeps the copy in step with the upstream file; the others
// run the copy (transpiled here: jest has no TypeScript transform) against a fake zoom.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
// jsdom has no DOMRect: the polyfill the webOS page loads (F1.6).
const { install: installDOMRect } = require('../../polyfills/dom-rect');

installDOMRect(window);

const COMMON = path.resolve(__dirname, '..', '..', '..', 'src', 'common');
const read = (name) => fs.readFileSync(path.join(COMMON, name), 'utf8');

const UPSTREAM_CHECK = '        if (sheet.href && new URL(sheet.href).origin === location.origin) {\n';
const WEBOS_CHECK = '        if (sheet.href && new URL(sheet.href).origin === new URL(location.href).origin) {\n';

// The webOS additions, each back to the upstream text it replaces.
const CHANGES = [
    // The TV scale and the screen rects (F2.6): every line between `let cssScale` and normalizeInterfaceScale.
    [/(let cssScale = 1;\n)\n\/\/ webOS: [\s\S]*?\n(\nconst normalizeInterfaceScale)/, '$1$2'],
    [
        'const setInterfaceScale = (setting: number) => {\n    // webOS: the TV scale.\n    const scale = setting * TV_SCALE;\n',
        'const setInterfaceScale = (scale: number) => {\n',
    ],
    ['    // webOS: rects in screen pixels.\n    setRectScale(scale);\n', ''],
];

describe('src/common/interfaceScale.webos.ts', () => {
    test('differs from interfaceScale.ts only in the same-origin check, the TV scale and the screen rects', () => {
        const upstream = read('interfaceScale.ts');
        const webos = read('interfaceScale.webos.ts');
        expect(upstream).toContain(UPSTREAM_CHECK);
        // The fix itself: without it core-js gives main.css the origin "null" and no media query is rescaled.
        expect(webos).toContain(WEBOS_CHECK);
        expect(webos).not.toContain(UPSTREAM_CHECK);
        let body = webos
            .replace(/^(\/\/ .*\n)+\n/, '')
            .replace(/( {8}\/\/ .*\n)+(?= {8}if \(sheet\.href)/, '')
            .replace(WEBOS_CHECK, UPSTREAM_CHECK);
        CHANGES.forEach(([from, to]) => {
            const before = body;
            body = body.replace(from, to);
            expect(body).not.toBe(before);
        });
        expect(body).toBe(upstream);
    });
});

// The module, fresh, with its own copy of the Element prototype method it patches.
const load = () => {
    const { outputText } = ts.transpileModule(read('interfaceScale.webos.ts'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    });
    const module = { exports: {} };
    const requireStub = (name) => {
        if (name === './CONSTANTS') return { INTERFACE_SCALES: [75, 100, 125, 150, 175] };
        throw new Error(`unexpected import ${name}`);
    };
    new Function('require', 'module', 'exports', outputText)(requireStub, module, module.exports);
    return module.exports;
};

const SCREEN_WIDTH = 1920;

// jsdom has no layout: getBoundingClientRect() answers like Chromium 53 under the html zoom (unzoomed
// CSS pixels: html is 100vw over the zoom) or like Chromium 128+ (screen pixels).
const fakeEngine = (zoomedRects) => {
    const zoom = () => Number(document.documentElement.style.getPropertyValue('--interface-scale')) || 1;
    Element.prototype.getBoundingClientRect = function() {
        const factor = zoomedRects ? zoom() : 1;
        const width = this === document.documentElement ? SCREEN_WIDTH / zoom() : 100;
        return new DOMRect(10 * factor, 20 * factor, width * factor, 50 * factor);
    };
};

describe('setInterfaceScale on webOS', () => {
    const native = Element.prototype.getBoundingClientRect;

    beforeAll(() => {
        Object.defineProperty(window, 'innerWidth', { value: SCREEN_WIDTH, configurable: true });
    });

    afterEach(() => {
        Element.prototype.getBoundingClientRect = native;
        document.documentElement.style.removeProperty('--interface-scale');
    });

    test('the default setting (100%) zooms the page by the TV scale', () => {
        fakeEngine(false);
        const { setInterfaceScale, getInterfaceScale } = load();
        setInterfaceScale(1);
        expect(getInterfaceScale()).toBe(1.75);
        expect(document.documentElement.style.getPropertyValue('--interface-scale')).toBe('1.75');
        setInterfaceScale(1.5);
        expect(getInterfaceScale()).toBeCloseTo(2.625);
    });

    test('rects come in screen pixels on an engine that gives them unzoomed (Chromium 53)', () => {
        fakeEngine(false);
        const { setInterfaceScale, getInterfaceRect } = load();
        setInterfaceScale(1);
        const rect = document.body.getBoundingClientRect();
        expect([rect.left, rect.top, rect.width, rect.height]).toEqual([17.5, 35, 175, 87.5]);
        expect(document.documentElement.getBoundingClientRect().width).toBeCloseTo(SCREEN_WIDTH);
        // getInterfaceRect (popups, menus, tooltips) gets back the CSS pixels it positions with.
        const css = getInterfaceRect(document.body);
        expect([css.x, css.y, css.width, css.height]).toEqual([10, 20, 100, 50]);
    });

    test('rects are left alone on an engine that already zooms them (Chromium 128+)', () => {
        fakeEngine(true);
        const engine = Element.prototype.getBoundingClientRect;
        const { setInterfaceScale } = load();
        setInterfaceScale(1);
        expect(Element.prototype.getBoundingClientRect).toBe(engine);
        expect(document.body.getBoundingClientRect().width).toBeCloseTo(175);
    });

    test('the native method comes back when the zoom is 1 again', () => {
        fakeEngine(false);
        const engine = Element.prototype.getBoundingClientRect;
        const { setInterfaceScale } = load();
        setInterfaceScale(1);
        expect(Element.prototype.getBoundingClientRect).not.toBe(engine);
        setInterfaceScale(1 / 1.75);
        expect(Element.prototype.getBoundingClientRect).toBe(engine);
    });
});
