const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

// Real DOM/React focus effects; layout remains explicitly simulated (not a TV gate).
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLIFrameElement', 'MutationObserver']) {
    Object.defineProperty(global, name, { configurable: true, value: dom.window[name] });
}
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
global.requestAnimationFrame = callback => setTimeout(callback, 16);
global.cancelAnimationFrame = handle => clearTimeout(handle);
dom.window.requestAnimationFrame = global.requestAnimationFrame;
dom.window.cancelAnimationFrame = global.cancelAnimationFrame;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLElement.prototype.getClientRects = function() {
    return this.closest('[hidden]') || getComputedStyle(this).display === 'none' ? [] : [this.getBoundingClientRect()];
};
dom.window.HTMLElement.prototype.scrollIntoView = function() {};

const React = require('react');
const { createRoot } = require('react-dom/client');

function loader(webos = true, mocks = {}) {
    const cache = new Map();
    const load = file => {
        file = path.resolve(file);
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} };
        cache.set(file, module);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018, jsx: ts.JsxEmit.React, esModuleInterop: true }
        }).outputText;
        vm.runInNewContext(code, {
            module, exports: module.exports, process: { env: { WEBOS: webos } },
            window, document, navigator, HTMLElement, HTMLInputElement, MutationObserver, getComputedStyle,
            IntersectionObserver: global.IntersectionObserver, KeyboardEvent: window.KeyboardEvent,
            setTimeout, clearTimeout, requestAnimationFrame: global.requestAnimationFrame, cancelAnimationFrame: global.cancelAnimationFrame,
            console,
            require: id => {
                if (id in mocks) return mocks[id];
                if (/\.less$|^\.\/styles$/.test(id)) return new Proxy({}, { get: (_, key) => key });
                if (id.startsWith('.') || id.startsWith('stremio/')) {
                    const base = id.startsWith('.') ? path.resolve(path.dirname(file), id) : path.resolve('src', id.slice(8));
                    const candidate = ['', '.js', '.ts', '.tsx', '/index.js', '/index.ts'].map(ext => base + ext).find(p => fs.existsSync(p) && fs.statSync(p).isFile());
                    if (candidate && candidate.endsWith('.json')) return JSON.parse(fs.readFileSync(candidate, 'utf8'));
                    if (candidate) return load(candidate);
                }
                return require(id);
            }
        }, { filename: file });
        return module.exports;
    };
    return load;
}

function mount(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    React.act(() => root.render(element));
    return {
        container,
        render: element => React.act(() => root.render(element)),
        unmount: () => { React.act(() => root.unmount()); container.remove(); }
    };
}

async function tick(ms = 20) {
    await React.act(async () => {
        await Promise.resolve();
        jest.advanceTimersByTime(ms);
    });
}

module.exports = { React, loader, mount, tick };
