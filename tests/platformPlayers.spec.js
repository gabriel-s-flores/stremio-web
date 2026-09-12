const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const CONSTANTS = require('../src/common/CONSTANTS');
const source = ts.transpileModule(fs.readFileSync('src/routes/Settings/Player/usePlayerOptions.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText;
const options = (name, playerType) => {
    const exports = {};
    const dispatch = jest.fn();
    vm.runInNewContext(source, { exports, require: id => {
        if (id === 'react') return { useMemo: fn => fn() };
        if (id === 'react-i18next') return { useTranslation: () => ({ t: key => key }) };
        if (id === 'stremio/core') return { useCore: () => ({ transport: { dispatch } }) };
        if (id === 'stremio/common') return { CONSTANTS, languageNames: {}, useLanguageSorting: () => ({ sortedOptions: [] }), usePlatform: () => ({ name }) };
        throw Error(id);
    } });
    return { select: exports.default({ settings: { playerType } }).playInExternalPlayerSelect, dispatch };
};
test.each([null, 'vlc', 'm3u', 'unknown'])('webOS recovers legacy %p selection', playerType => {
    const { select, dispatch } = options('webos', playerType);
    expect(select.options).toEqual([{ value: null, label: 'EXTERNAL_PLAYER_DISABLED' }]);
    expect(select.value).toBe(null);
    expect(select.title()).toBe('EXTERNAL_PLAYER_DISABLED');
    select.onSelect(null);
    expect(dispatch.mock.calls[0][0].args.args.playerType).toBe(null);
});
test.each(['ios', 'visionos', 'android', 'windows'])('%s retains VLC', name => {
    const { select } = options(name, 'vlc');
    expect(select.options.some(option => option.value === 'vlc')).toBe(true);
    expect(select.value).toBe('vlc');
});

const streamSource = ts.transpileModule(fs.readFileSync('src/routes/MetaDetails/StreamsList/Stream/Stream.js', 'utf8'), {
    fileName: 'Stream.jsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
}).outputText;
const streamButton = (name, deepLinks) => {
    const module = { exports: {} };
    const show = jest.fn(), dispatch = jest.fn();
    vm.runInNewContext(streamSource, { module, require: id => {
        if (id === 'react') return { ...require('react'), useMemo: fn => fn(), useCallback: fn => fn, useEffect: () => {}, useState: init => [init, () => {}], Fragment: 'fragment' };
        if (id === 'stremio/core') return { useCore: () => ({ transport: { dispatch } }) };
        if (id === 'stremio/common') return { useProfile: () => ({ settings: { playerType: 'vlc' } }), usePlatform: () => ({ name }), useToast: () => ({ show }), useBinaryState: () => [false, () => {}, () => {}, () => {}] };
        if (id === 'stremio/common/useRouteFocused') return { default: () => true };
        if (id === 'stremio/common/clipboard') return require('../src/common/clipboard');
        if (id === 'stremio/components/ClipboardFallbackModal') return () => null;
        if (id === 'stremio/components') return { Button: 'button', Image: 'img', Popup: 'popup' };
        if (id === '@stremio/stremio-icons/react') return { default: 'svg' };
        if (id === './StreamPlaceholder' || id === './styles') return {};
        return require(id);
    } });
    const root = module.exports({ deepLinks, videoId: 'video' });
    const popup = root && root.props && root.props.renderLabel ? root : (Array.isArray(root.props.children) ? root.props.children[0] : root.props.children);
    return { button: popup.props.renderLabel({}).props, show, dispatch };
};
test.each([
    { player: '#/player/test', externalPlayer: { openPlayer: { windows: 'vlc://test' }, playlist: 'https://example.org/list.m3u' } },
    { player: '#/player/test', externalPlayer: { web: 'https://example.org/player' } },
    { player: '#/player/test' },
    { externalPlayer: { openPlayer: {} } },
    null,
])('webOS stream uses an internal link or null: %p', deepLinks => {
    const { button, show, dispatch } = streamButton('webos', deepLinks);
    expect(button.href).toBe(deepLinks?.player || null);
    expect(button.target).toBe(null);
    expect(button.download).toBe(null);
    button.onClick({ nativeEvent: {} });
    expect(show).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
});
test('Windows keeps its external player action', () => {
    const { button, show, dispatch } = streamButton('windows', { externalPlayer: { openPlayer: { windows: 'vlc://test' } } });
    expect(button.href).toBe('vlc://test');
    button.onClick({ nativeEvent: {} });
    expect(show).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
});
