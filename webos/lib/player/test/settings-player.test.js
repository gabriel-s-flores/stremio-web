/* global describe, it, expect, beforeEach, jest */
// The Settings Player override (src/routes/Settings/Player/Player.webos.tsx, F5.5) rendered over the
// real upstream Player.tsx: only the ASS subtitles styling option is dropped and the ref still
// reaches the Section. The jest transform here has no TypeScript, so both .tsx files are transpiled
// with the typescript package and loaded with their imports mapped to the doubles below (each
// double renders its label, so the markup shows which options are on screen).

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const React = require('react');
const PropTypes = require('prop-types');
const { renderToStaticMarkup } = require('react-dom/server');
const player = require('..');

const SETTINGS_PLAYER_DIR = path.join(__dirname, '..', '..', '..', '..', 'src', 'routes', 'Settings', 'Player');
const ASS_STYLING_LABEL = 'SETTINGS_ASS_SUBTITLES_STYLING';

const h = React.createElement;
const received = { sectionRef: undefined };
const Section = React.forwardRef((props, ref) => {
    received.sectionRef = ref;
    return h('div', { 'data-section': props.label }, props.children);
});
Section.propTypes = { label: PropTypes.string, children: PropTypes.node };
const Category = ({ label, children }) => h('div', { 'data-category': label }, children);
const Option = ({ label, children }) => h('div', { 'data-option': label }, children);
const control = (name) => (props) => h('span', { 'data-control': name, 'data-value': props.value });
const usePlayerOptions = jest.fn();
// webOS: no shell, so the upstream shell-only options stay out (as in the app on the TV).
const usePlatform = () => ({ name: 'webos', shell: { active: false, capabilities: {} } });

const load = (file, modules) => {
    const source = fs.readFileSync(path.join(SETTINGS_PLAYER_DIR, file), 'utf8');
    const { outputText } = ts.transpileModule(source, {
        fileName: file,
        compilerOptions: { jsx: 'react', module: 'commonjs', target: 'es2017', esModuleInterop: true },
    });
    const module = { exports: {} };
    const requireMapped = (request) => {
        if (!Object.prototype.hasOwnProperty.call(modules, request)) throw new Error(`${file}: unexpected import ${request}`);
        return modules[request];
    };
    new Function('require', 'module', 'exports', outputText)(requireMapped, module, module.exports);
    return module.exports;
};

const upstream = load('Player.tsx', {
    'react': React,
    'stremio/components': { ColorInput: control('ColorInput'), MultiselectMenu: control('MultiselectMenu'), Toggle: control('Toggle') },
    'stremio/common': { usePlatform },
    '../components': { Category, Option, Section },
    './usePlayerOptions': { __esModule: true, default: usePlayerOptions },
});
const webos = load('Player.webos.tsx', {
    'react': React,
    './Player.tsx': upstream,
    '../../../../webos/lib/player': player,
});

const PROFILE = { settings: { subtitlesSize: 100 } };
const OPTIONS = [
    'subtitlesLanguageSelect', 'subtitlesSizeSelect', 'subtitlesTextColorInput', 'subtitlesBackgroundColorInput',
    'subtitlesOutlineColorInput', 'assSubtitlesStylingToggle', 'audioLanguageSelect', 'surroundSoundToggle',
    'seekTimeDurationSelect', 'seekShortTimeDurationSelect', 'playInExternalPlayerSelect', 'nextVideoPopupDurationSelect',
    'bingeWatchingToggle', 'playInBackgroundToggle', 'hardwareDecodingToggle', 'gpuVideoProcessingToggle',
    'videoModeSelect', 'pauseOnMinimizeToggle',
];

const render = (Component, ref) => renderToStaticMarkup(h(Component, { ref, profile: PROFILE }));
const labels = (markup, attribute) => Array.from(markup.matchAll(new RegExp(`data-${attribute}="([^"]+)"`, 'g'))).map((match) => match[1]);

describe('Settings Player.webos', () => {
    beforeEach(() => {
        received.sectionRef = undefined;
        usePlayerOptions.mockReset();
        usePlayerOptions.mockImplementation(() => OPTIONS.reduce((options, name) => Object.assign(options, { [name]: { value: name } }), {}));
    });

    it('the upstream section has the ASS styling option (the case is not empty)', () => {
        expect(labels(render(upstream.default), 'option')).toContain(ASS_STYLING_LABEL);
    });

    it('drops the ASS subtitles styling option and its toggle', () => {
        const markup = render(webos.default);
        expect(labels(markup, 'option')).not.toContain(ASS_STYLING_LABEL);
        expect(markup).not.toContain('assSubtitlesStylingToggle');
    });

    it('keeps every other upstream option, in the upstream order', () => {
        const markup = render(webos.default);
        const expected = labels(render(upstream.default), 'option').filter((label) => label !== ASS_STYLING_LABEL);
        expect(labels(markup, 'option')).toEqual(expected);
        expect(labels(markup, 'option')).toEqual(expect.arrayContaining([
            'SETTINGS_SUBTITLES_LANGUAGE', 'SETTINGS_SUBTITLES_SIZE', 'SETTINGS_SUBTITLES_COLOR',
            'SETTINGS_DEFAULT_AUDIO_TRACK', 'SETTINGS_SURROUND_SOUND',
        ]));
        expect(labels(markup, 'category')).toEqual(labels(render(upstream.default), 'category'));
        expect(labels(markup, 'category')).toEqual(expect.arrayContaining(['SETTINGS_SECTION_SUBTITLES', 'SETTINGS_SECTION_AUDIO']));
        expect(markup).toContain('data-value="subtitlesSizeSelect"');
        expect(markup).toContain('data-value="surroundSoundToggle"');
    });

    it('passes the profile to usePlayerOptions and the forwarded ref to the Section', () => {
        const ref = React.createRef();
        render(webos.default, ref);
        expect(usePlayerOptions).toHaveBeenCalledWith(PROFILE);
        expect(received.sectionRef).toBe(ref);
        expect(webos.default.displayName).toBe('Player');
    });
});
