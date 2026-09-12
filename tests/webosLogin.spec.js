const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const React = require('react');

// Execute the real route, reducer, effects, OAuth hooks and keyboard handlers.
// Only the platform/core/router and DOM refs are simulated in this node suite.
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree)
    ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
function harness({ isTV = true, isMobile = false, form = 'login', reset = false } = {}) {
    let cursor = 0, tree, params = new URLSearchParams({ form });
    const slots = [], effects = [], listeners = {}, cache = {};
    const timers = new Map();
    const platform = { isTV, isMobile, openExternal: jest.fn() };
    const core = { transport: { dispatch: jest.fn() },
        on: jest.fn((event, fn) => { listeners[event] = fn; }), off: jest.fn() };
    const navigate = jest.fn(), fetch = jest.fn(async () => ({ json: async () => ({ user: {
        email: 'fixture@example.invalid', fbLoginToken: 'synthetic', token: 'synthetic', sub: 'synthetic'
    } }) }));
    const setTimeout = jest.fn(fn => { const id = timers.size + 1; timers.set(id, fn); return id; });
    const clearTimeout = jest.fn(id => timers.delete(id));
    const react = { ...React, useCallback: fn => fn, useMemo: fn => fn(),
        useRef: value => { const id = cursor++; return slots[id] || (slots[id] = { current: value }); },
        useState: initial => {
            const id = cursor++;
            if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
            return [slots[id], value => { slots[id] = typeof value === 'function' ? value(slots[id]) : value; }];
        },
        useReducer: (reducer, initial) => { const [state, set] = react.useState(initial); return [state, action => set(s => reducer(s, action))]; },
        useEffect: (fn, deps) => {
            const id = cursor++, previous = slots[id];
            if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
                effects.push(() => { previous?.cleanup?.(); slots[id] = { deps, cleanup: fn() }; });
            }
        }
    };
    const common = { usePlatform: () => platform, useBinaryState: initial => {
        const [value, set] = react.useState(initial); return [value, () => set(true), () => set(false)];
    } };
    function load(file) {
        if (cache[file]) return cache[file];
        const module = { exports: {} };
        const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            fileName: file.replace(/\.js$/, '.jsx'), compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true }
        }).outputText;
        vm.runInNewContext(source, { module, exports: module.exports, URLSearchParams, fetch, setTimeout, clearTimeout,
            window: { navigate: jest.fn() }, console: { error: jest.fn() }, require: id => {
                if (id === 'react') return react;
                if (id === 'stremio/common') return common;
                if (id === 'stremio/core') return { useCore: () => core };
                if (id === 'stremio/common/useRouteFocused') return { default: () => true };
                if (id === 'react-i18next') return { useTranslation: () => ({ t: key => key }) };
                if (id === 'react-router-dom') return { useNavigate: () => navigate, useSearchParams: () => [params, value => { params = value; }] };
                if (id === 'stremio/components') return { Button: 'button', Image: 'img', Checkbox: 'checkbox', ModalDialog: 'dialog', TextInput: 'input-wrapper' };
                if (id === 'stremio/router/Modal') return 'modal';
                if (id.includes('CredentialsTextInput')) return 'credentials';
                if (id === './PasswordResetModal') return 'reset';
                if (id === './useFacebookLogin') return load('src/routes/Intro/useFacebookLogin.ts');
                if (id === './useAppleLogin') return load('src/routes/Intro/useAppleLogin.ts');
                if (id === 'hat') return () => 'synthetic-state';
                if (id === './styles' || id.endsWith('.less')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key });
                if (id.startsWith('/assets/')) return '';
                return require(id);
            } });
        return cache[file] = module.exports;
    }
    const Component = load(reset ? 'src/routes/Intro/PasswordResetModal/PasswordResetModal.js' : 'src/routes/Intro/Intro.js');
    function render() {
        cursor = 0;
        tree = Component({ email: '', onCloseRequest: navigate });
        nodes(tree).forEach(node => {
            if (node.ref && typeof node.ref === 'object') {
                if (!node.ref.current) node.ref.current = { value: '', validity: { valid: true }, focus: jest.fn(), scrollIntoView: jest.fn() };
                if ('value' in node.props) node.ref.current.value = node.props.value;
            }
        });
        effects.splice(0).forEach(fn => fn());
        return tree;
    }
    const find = predicate => nodes(tree).find(predicate);
    const input = placeholder => find(n => n.props.placeholder === placeholder);
    const change = (placeholder, value, valid = true) => {
        const node = input(placeholder); node.ref.current.value = value; node.ref.current.validity.valid = valid;
        node.props.onChange({ currentTarget: { value } }); render();
    };
    const click = className => { find(n => n.props.className?.split(' ').includes(className)).props.onClick(); render(); };
    render();
    return { render, find, input, change, click, platform, core, navigate, fetch, setTimeout, clearTimeout, timers, load,
        get tree() { return tree; }, emit: (kind, event) => { listeners[kind](event); render(); },
        unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}
const error = h => h.find(n => n.props.className === 'error-message')?.props.children;
const login = h => { h.change('EMAIL', 'fixture@example.invalid'); h.change('PASSWORD', 'synthetic'); };
const toggle = (h, link) => { h.find(n => n.type === 'checkbox' && (n.props.link === link || n.props.label === link)).props.onChange(); h.render(); };

test.each(['login', 'signup'])('TV %s has no OAuth controls, fetch, external calls or polling on mount/cleanup', form => {
    const h = harness({ form });
    expect(h.tree.props.className).toContain('tv');
    expect(nodes(h.tree).some(n => /facebook-button|apple-button|google-button/.test(n.props.className))).toBe(false);
    h.unmount();
    for (const spy of [h.fetch, h.platform.openExternal, h.setTimeout, h.core.transport.dispatch]) expect(spy).not.toHaveBeenCalled();
    expect(h.core.off.mock.calls).toEqual(h.core.on.mock.calls);
});

test.each([false, true])('Desktop/mobile OAuth buttons retain real start, polling and dispatch (mobile=%s)', async isMobile => {
    for (const provider of ['facebook', 'apple']) {
        const h = harness({ isTV: false, isMobile });
        expect(h.tree.props.className).not.toContain('tv');
        expect(h.platform.openExternal).not.toHaveBeenCalled();
        expect(h.fetch).not.toHaveBeenCalled();
        h.click(provider + '-button');
        expect(h.platform.openExternal).toHaveBeenCalledWith(expect.stringContaining(provider === 'facebook' ? '/login-fb/' : '/login-apple/'));
        expect(h.setTimeout).toHaveBeenCalledWith(expect.any(Function), provider === 'facebook' ? 1000 : 2000);
        [...h.timers.values()][0]();
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(h.fetch).toHaveBeenCalledTimes(1);
        expect(h.core.transport.dispatch).toHaveBeenCalledWith({ action: 'Ctx', args: { action: 'Authenticate', args: provider === 'facebook'
            ? { type: 'Login', email: 'fixture@example.invalid', password: 'synthetic', facebook: true }
            : { type: 'Apple', token: 'synthetic', sub: 'synthetic', email: 'fixture@example.invalid', name: '' } } });
        h.unmount(); expect(h.clearTimeout).toHaveBeenCalled();
    }
});

test('Email validation and exact core contract; success and authentication error close loader', () => {
    const h = harness();
    h.click('submit-button'); expect(error(h)).toBe('INVALID_EMAIL');
    h.change('EMAIL', 'invalid', false); h.click('submit-button'); expect(error(h)).toBe('INVALID_EMAIL');
    h.change('EMAIL', 'fixture@example.invalid'); h.click('submit-button'); expect(error(h)).toBe('INVALID_PASSWORD');
    expect(h.core.transport.dispatch).not.toHaveBeenCalled();
    login(h); h.click('submit-button');
    expect(h.core.transport.dispatch).toHaveBeenCalledWith({ action: 'Ctx', args: { action: 'Authenticate', args: { type: 'Login', email: 'fixture@example.invalid', password: 'synthetic' } } });
    expect(h.find(n => n.type === 'modal')).toBeDefined();
    h.emit('error', { event: 'Unrelated' }); expect(h.find(n => n.type === 'modal')).toBeDefined();
    h.emit('error', { event: 'UserAuthenticated' }); expect(h.find(n => n.type === 'modal')).toBeUndefined();
    expect(h.navigate).not.toHaveBeenCalled();
    h.click('submit-button'); h.emit('event', 'UserAuthenticated');
    expect(h.find(n => n.type === 'modal')).toBeUndefined(); expect(h.navigate).toHaveBeenCalledWith('/');
});

test.each([false, true])('Registration requires confirmation, terms and privacy; marketing optional (%s)', marketing => {
    const h = harness({ form: 'signup' });
    h.click('submit-button'); expect(error(h)).toBe('INVALID_EMAIL');
    h.change('EMAIL', 'fixture@example.invalid'); h.click('submit-button'); expect(error(h)).toBe('INVALID_PASSWORD');
    login(h); h.change('PASSWORD_CONFIRM', 'different'); h.click('submit-button'); expect(error(h)).toBe('PASSWORDS_NOMATCH');
    h.change('PASSWORD_CONFIRM', 'synthetic'); h.click('submit-button'); expect(error(h)).toBe('MUST_ACCEPT_TERMS');
    expect(h.find(n => n.props.link === 'TOS').props.href).toBe('https://www.stremio.com/tos');
    expect(h.find(n => n.props.link === 'PRIVACY_POLICY').props.href).toBe('https://www.stremio.com/privacy');
    toggle(h, 'TOS'); h.click('submit-button'); expect(error(h)).toBe('MUST_ACCEPT_PRIVACY_POLICY');
    expect(h.core.transport.dispatch).not.toHaveBeenCalled();
    toggle(h, 'PRIVACY_POLICY'); if (marketing) toggle(h, 'MARKETING_AGREE'); h.click('submit-button');
    expect(h.core.transport.dispatch).toHaveBeenCalledWith({ action: 'Ctx', args: { action: 'Authenticate', args: {
        type: 'Register', email: 'fixture@example.invalid', password: 'synthetic', gdpr_consent: { tos: true, privacy: true, marketing, from: 'web' }
    } } });
});

test('Guest requires terms; switching forms clears credentials and retains recovery', () => {
    const h = harness({ form: 'signup' });
    h.click('guest-login-button'); expect(error(h)).toBe('MUST_ACCEPT_TERMS');
    toggle(h, 'TOS'); h.click('guest-login-button'); expect(h.navigate).toHaveBeenCalledWith('/');
    login(h); h.click('login-form-button'); h.render();
    expect(h.input('EMAIL').props.value).toBe(''); expect(h.input('PASSWORD_CONFIRM')).toBeUndefined();
    h.click('forgot-password-link'); expect(h.find(n => n.type === 'reset')).toBeDefined();
    h.click('signup-form-button'); h.render(); expect(h.input('PASSWORD_CONFIRM')).toBeDefined();
});

test('Reset modal validates email for Send and Enter and delegates only to platform.openExternal', () => {
    const h = harness({ reset: true });
    const send = () => { h.tree.props.buttons[1].props.onClick(); h.render(); };
    send(); expect(error(h)).toBe('INVALID_EMAIL');
    h.change('EMAIL', 'invalid', false); h.input('EMAIL').props.onSubmit(); h.render(); expect(error(h)).toBe('INVALID_EMAIL');
    expect(h.platform.openExternal).not.toHaveBeenCalled();
    h.change('EMAIL', 'fixture@example.invalid'); expect(error(h)).toBeUndefined(); send();
    expect(h.platform.openExternal).toHaveBeenCalledWith('https://www.strem.io/reset-password/fixture@example.invalid');
    expect(h.fetch).not.toHaveBeenCalled();
    h.tree.props.buttons[0].props.onClick(); expect(h.navigate).toHaveBeenCalled();
});

test.each(['login', 'signup'])('Real input chain preserves native types, masking and keyboard attributes (%s)', form => {
    const h = harness({ form });
    const Credentials = h.load('src/routes/Intro/CredentialsTextInput/CredentialsTextInput.js');
    const TextInput = h.load('src/components/TextInput/TextInput.tsx').default;
    for (const placeholder of ['EMAIL', 'PASSWORD', ...(form === 'signup' ? ['PASSWORD_CONFIRM'] : [])]) {
        const node = h.input(placeholder);
        const wrapper = Credentials.render(node.props, node.ref);
        const input = TextInput.render(wrapper.props, node.ref);
        expect(input.type).toBe('input'); expect(input.props.type).toBe(placeholder === 'EMAIL' ? 'email' : 'password');
        expect(input.props).toMatchObject({ autoCapitalize: 'off', autoCorrect: 'off', autoComplete: 'off', spellCheck: false });
        expect(input.props.inputMode).toBeUndefined();
    }
    login(h);
    const enter = placeholder => {
        const node = h.input(placeholder), wrapper = Credentials.render(node.props, node.ref);
        TextInput.render(wrapper.props, node.ref).props.onKeyDown({ key: 'Enter', nativeEvent: {} }); h.render();
    };
    enter('EMAIL'); expect(h.input('PASSWORD').ref.current.focus).toHaveBeenCalled();
    enter('PASSWORD');
    if (form === 'login') expect(h.core.transport.dispatch).toHaveBeenCalledTimes(1);
    else { expect(h.input('PASSWORD_CONFIRM').ref.current.focus).toHaveBeenCalled(); expect(h.core.transport.dispatch).not.toHaveBeenCalled(); }
});

test('Auth components never access webOS/Luna/keyboard APIs or implement a JS password mask', () => {
    const files = fs.readdirSync('src/routes/Intro', { recursive: true }).filter(file => /\.(js|ts|tsx)$/.test(file));
    for (const file of files) {
        const source = fs.readFileSync('src/routes/Intro/' + file, 'utf8');
        expect(source).not.toMatch(/\b(?:webOS|PalmSystem|PalmServiceBridge|webOSSystem)\b|luna:\/\/|inputMode|webkitTextSecurity/);
    }
});
