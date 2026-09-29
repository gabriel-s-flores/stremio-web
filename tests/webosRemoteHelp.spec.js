const fs = require('fs');
const { React, loader, mount, tick } = require('./helpers/tvDom');
let view;
beforeEach(() => { jest.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(async () => { if (view) view.unmount(); view = null; await tick(); jest.useRealTimers(); });

const locales = Object.fromEntries(['en-US', 'pt-BR', 'pt-PT'].map(lang => [lang, JSON.parse(fs.readFileSync(`src/common/TV/translations/${lang}.json`, 'utf8'))]));

test('all remote-help keys have English and Portuguese translations and other locales fall back', async () => {
    const i18n = require('i18next').createInstance();
    await i18n.init({ lng: 'fr', fallbackLng: 'en-US', resources: Object.fromEntries(Object.entries(locales).map(([key, value]) => [key, { translation: value }])) });
    for (const locale of Object.values(locales)) {
        expect(Object.keys(locale).sort()).toEqual(Object.keys(locales['en-US']).sort());
        Object.values(locale).forEach(value => expect(value.length).toBeGreaterThan(0));
    }
    expect(i18n.t('TV_REMOTE_TITLE')).toBe('Remote control help');
    await i18n.changeLanguage('pt-BR');
    expect(i18n.t('TV_REMOTE_TITLE')).toBe('Ajuda do controle remoto');
});

test('help contains the T4.3 color map and scrollable focus stops', () => {
    const { default: Help, remoteMappings } = loader(true, { 'react-i18next': { useTranslation: () => ({ t: key => locales['en-US'][key] || key }) } })('src/components/RemoteControlHelp/RemoteControlHelp.tsx');
    view = mount(React.createElement(Help));
    expect(remoteMappings.slice(-4)).toEqual([
        ['TV_REMOTE_RED', 'SETTINGS_SHORTCUT_MENU_SUBTITLES'],
        ['TV_REMOTE_GREEN', 'SETTINGS_SHORTCUT_MENU_AUDIO'],
        ['TV_REMOTE_YELLOW', 'TV_REMOTE_DETAILS'],
        ['TV_REMOTE_BLUE', 'SETTINGS_SHORTCUT_MENU_PLAYBACK_SPEED']
    ]);
    expect(view.container.querySelectorAll('[tabindex="0"]').length).toBe(11);
    expect(view.container.textContent).toContain('keyboard shortcuts are optional');
});

function shortcuts(webos, onShortcut) {
    const { ShortcutsProvider } = loader(webos)('src/common/Shortcuts/Shortcuts.tsx');
    view = mount(React.createElement(ShortcutsProvider, { onShortcut }, React.createElement('button', { id: 'focus' }, 'Focused')));
    document.getElementById('focus').focus();
}
const press = values => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...values }));

test('optional numeric remote shortcuts dispatch normalized keyCode and preserve input typing', () => {
    const action = jest.fn(); shortcuts(true, action);
    press({ key: 'Unidentified', keyCode: 50 });
    expect(action).toHaveBeenCalledWith('navigateTabs', 0, '2');
    const input = document.createElement('input'); document.body.appendChild(input); input.focus();
    press({ key: '3', code: 'Digit3' }); expect(action).toHaveBeenCalledTimes(1);
});

test('TV vertical arrows navigate without changing volume; desktop volume still dispatches', () => {
    const action = jest.fn(); shortcuts(true, action); press({ key: 'ArrowUp' }); expect(action).not.toHaveBeenCalled();
    view.unmount(); view = null; shortcuts(false, action); press({ key: 'ArrowUp' }); expect(action).toHaveBeenCalledWith('volume', 0, 'ArrowUp');
});

test('global keyboard tab switches cannot navigate behind an overlay', () => {
    const action = jest.fn(); shortcuts(true, action);
    const overlay = document.createElement('div'); overlay.dataset.focusLockDisabled = 'false'; document.body.appendChild(overlay);
    press({ key: '2' }); expect(action).not.toHaveBeenCalled();
});

test('remote help prevents media and color dispatch to the background player', () => {
    const action = jest.fn(); shortcuts(true, action);
    const overlay = document.createElement('div'); overlay.dataset.tvRemoteHelp = 'true'; document.body.appendChild(overlay);
    press({ key: 'MediaPlay' }); press({ key: 'Red' });
    expect(action).not.toHaveBeenCalled();
});

test('Settings opens remote help with OK-equivalent click and Back restores its opener', async () => {
    let back;
    const common = { useShortcuts: () => ({ grouped: [] }), useBackHandler: cb => { back = cb; }, BACK_HANDLER_PRIORITIES: { MODAL: 500 } };
    const Button = ({ children, ...props }) => React.createElement('button', props, children);
    const load = loader(true, {
        'react-i18next': { useTranslation: () => ({ t: key => locales['en-US'][key] || key }) },
        'stremio/common': common,
        'stremio/components': { Button, ShortcutsGroup: () => null },
        '../components': { Section: React.forwardRef(({ children }, ref) => React.createElement('section', { ref }, children)) },
        'stremio/services/GamepadContext': { useGamepad: () => null },
        '@stremio/stremio-icons/react': () => null,
    });
    const SettingsHelp = load('src/routes/Settings/Shortcuts/Shortcuts.tsx').default;
    view = mount(React.createElement(SettingsHelp));
    const opener = view.container.querySelector('button'); opener.focus();
    React.act(() => opener.click()); await tick();
    const lock = document.querySelector('[data-focus-lock-disabled="false"]');
    expect(lock).not.toBeNull(); expect(lock.contains(document.activeElement)).toBe(true);
    expect(lock.textContent).toContain('Remote control help');
    React.act(() => back()); await tick();
    expect(document.querySelector('[data-focus-lock-disabled="false"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
});

test('remote help locks gamepad background handlers and emits legacy arrow keycodes for the polyfill', async () => {
    const handlers = new Map();
    const gamepad = { lock: jest.fn(), unlock: jest.fn(), on: (name, id, cb) => handlers.set(name, cb), off: name => handlers.delete(name) };
    const onClose = jest.fn();
    const Help = loader(true, {
        'react-i18next': { useTranslation: () => ({ t: key => key }) },
        'stremio/common': { useShortcuts: () => ({ grouped: [] }), useBackHandler() {}, BACK_HANDLER_PRIORITIES: { MODAL: 500 } },
        'stremio/services/GamepadContext': { useGamepad: () => gamepad },
        'stremio/components': { Button: ({ children, ...props }) => React.createElement('button', props, children) },
        '@stremio/stremio-icons/react': () => null,
    })('src/App/ShortcutsModal/ShortcutsModal.tsx').default;
    view = mount(React.createElement(Help, { onClose })); await tick();
    expect(gamepad.lock).toHaveBeenCalledWith('tv-help-');
    const keydown = jest.fn(); document.activeElement.addEventListener('keydown', keydown);
    handlers.get('analog')('down'); expect(keydown.mock.calls[0][0].keyCode).toBe(40);
    handlers.get('buttonB')(); expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount(); view = null; expect(gamepad.unlock).toHaveBeenCalled(); expect(handlers.size).toBe(0);
});
