const React = require('react');
const { createRoot } = require('react-dom/client');
const { FileDropProvider, useFileDrop } = require('../src/common/FileDrop/FileDrop');
const { DiscordProvider, useDiscord } = require('../src/common/Discord/Discord');
const { default: UpdaterBanner } = require('../src/App/UpdaterBanner/UpdaterBanner');
const { default: Settings } = require('../src/routes/Settings/Settings');

const state = window.__t310;
const desktopLabels = ['SETTINGS_QUIT_ON_CLOSE', 'SETTINGS_FULLSCREEN_EXIT', 'SETTINGS_HWDEC', 'SETTINGS_GPU_VIDEO_PROCESSING', 'SETTINGS_VIDEO_MODE', 'SETTINGS_PAUSE_MINIMIZED'];
const delay = () => new Promise(resolve => setTimeout(resolve, 80));
let root;
function Consumer() {
    const fileDrop = useFileDrop();
    const discord = useDiscord();
    React.useEffect(() => {
        const listener = () => { state.filesDelivered++; };
        fileDrop.on('*', listener);
        discord.setActivity({ state: 'Playing fixture', details: 'Synthetic' });
        return () => fileDrop.off('*', listener);
    }, [fileDrop, discord.setActivity]);
    return <p data-test="consumer">Fixture child mounted</p>;
}
state.mount = async (mode) => {
    if (root) { root.unmount(); await delay(); }
    state.dragAdds = []; state.dragRemoves = []; state.shellCalls = []; state.filesDelivered = 0;
    state.player = false;
    const handlers = {};
    const shell = {
        active: mode === 'desktop', state: {}, capabilities: { gpuVideoProcessing: true },
        on: (name, listener) => { state.shellCalls.push(['on', name]); handlers[name] = listener; },
        off: (name, listener) => { state.shellCalls.push(['off', name]); if (handlers[name] === listener) delete handlers[name]; },
        send: name => state.shellCalls.push(['send', name]),
    };
    state.platform = { name: mode === 'desktop' ? 'windows' : 'webos', isTV: mode !== 'desktop', isMobile: false, shell };
    state.emit = (name, data) => { if (handlers[name]) handlers[name](data); };
    root = createRoot(document.getElementById('app'));
    state.render = () => root.render(<FileDropProvider><DiscordProvider><Consumer /><UpdaterBanner className="fixture-updater" /><Settings /></DiscordProvider></FileDropProvider>);
    state.render();
    await delay(); await delay();
};
state.snapshot = () => ({
    protocol: location.protocol, userAgent: navigator.userAgent,
    dragAdds: state.dragAdds.slice(), dragRemoves: state.dragRemoves.slice(),
    fileInputs: document.querySelectorAll('input[type="file"]').length,
    fileOverlays: document.querySelectorAll('[class*="file-drop-container"]').length,
    shellCalls: state.shellCalls.slice(),
    shortcutsButtons: document.querySelectorAll('[data-section="shortcuts"]').length,
    shortcutsSections: document.querySelectorAll('section[data-label="SETTINGS_NAV_SHORTCUTS"]').length,
    desktopControls: desktopLabels.filter(label => document.querySelector('[data-label="' + label + '"]')),
    updater: !!document.querySelector('[data-test="updater"]'),
    updaterVisible: !!document.querySelector('[data-test="updater"]:not([hidden])'),
    gamepad: !!document.querySelector('[data-label="SETTINGS_GAMEPAD"]'),
    child: !!document.querySelector('[data-test="consumer"]'),
    errors: state.errors.slice(), unhandledrejections: state.unhandledrejections.slice(),
});
state.unmount = async () => { root.unmount(); root = null; await delay(); };
state.mount('webos').then(() => { state.ready = true; });
