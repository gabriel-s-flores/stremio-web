// The overrides of F4.1b, rendered: each file is transpiled here (jest has no TypeScript/JSX
// transform) and run with a stand-in for the upstream component it wraps, which records its props.
// What is checked is what each override changes: the tab index (side bar, profile button, settings
// controls) and the steps and focus order of the interface zoom.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const load = (file, stubs) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React, esModuleInterop: true },
    });
    const module = { exports: {} };
    const requireStub = (name) => {
        if (name === 'react') return React;
        if (name in stubs) return stubs[name];
        throw new Error(`unexpected import ${name} in ${file}`);
    };
    new Function('require', 'module', 'exports', outputText)(requireStub, module, module.exports);
    return module.exports.default || module.exports;
};

const esModule = (value) => ({ __esModule: true, default: value });

describe('NavTabButton.webos.js', () => {
    test('the upstream link, focusable', () => {
        const Upstream = ({ href, label }) => React.createElement('a', { href, title: label, tabIndex: -1, className: 'nav-tab-button' }, label);
        const NavTabButton = load('src/components/NavBar/VerticalNavBar/NavTabButton/NavTabButton.webos.js', { './NavTabButton.js': Upstream });
        const html = renderToStaticMarkup(React.createElement(NavTabButton, { href: '#/library', label: 'Library' }));
        expect(html).toBe('<a href="#/library" title="Library" tabindex="0" class="nav-tab-button">Library</a>');
    });
});

describe('NavMenu.webos.js', () => {
    test('the profile button rendered by renderLabel, focusable', () => {
        const Upstream = (props) => props.renderLabel({ className: 'label', onClick: () => {}, children: null });
        const NavMenu = load('src/components/NavBar/HorizontalNavBar/NavMenu/NavMenu.webos.js', { './NavMenu.js': Upstream });
        const renderLabel = ({ className }) => React.createElement('div', { className, tabIndex: -1 }, 'profile');
        const html = renderToStaticMarkup(React.createElement(NavMenu, { renderLabel }));
        expect(html).toBe('<div class="label" tabindex="0">profile</div>');
    });
});

describe('Option.webos.tsx', () => {
    test('a control with tabIndex -1 gets 0, the others are left alone', () => {
        const Upstream = ({ label, children }) => React.createElement('div', { 'data-label': label }, children);
        const Option = load('src/routes/Settings/components/Option/Option.webos.tsx', { './Option.tsx': esModule(Upstream) });
        const html = renderToStaticMarkup(React.createElement(Option, { label: 'SETTINGS_GAMEPAD' },
            React.createElement('div', { tabIndex: -1, className: 'toggle' }),
            React.createElement('div', { className: 'menu' }),
            'text'));
        expect(html).toBe('<div data-label="SETTINGS_GAMEPAD"><div tabindex="0" class="toggle"></div><div class="menu"></div>text</div>');
    });
});

describe('Scale.webos.tsx', () => {
    test('the TV steps only, and the range input out of the focus order', () => {
        let received = null;
        const Upstream = (props) => {
            received = props;
            return null;
        };
        const Scale = load('src/components/Scale/Scale.webos.tsx', {
            './Scale.tsx': esModule(Upstream),
            '../../common/interfaceScale.webos': { TV_INTERFACE_SCALES: [100, 125] },
        });
        const onChange = () => {};
        renderToStaticMarkup(React.createElement(Scale, { min: 75, max: 175, step: 25, value: 100, options: [75, 100, 125, 150, 175], onChange }));
        expect(received).toEqual({ min: 100, max: 125, step: 25, value: 100, options: [100, 125], tabIndex: -1, onChange });
    });
});
