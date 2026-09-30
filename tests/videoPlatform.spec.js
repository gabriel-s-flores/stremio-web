const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const { toVideoPlatform, getVideoPlatformError } = require('../src/common/Platform/videoPlatform');

test.each(['webos', 'android', 'ios', 'linux', 'tizen', 'windows', '', 'unknown', null, undefined])('maps only webos: %p', name => {
    expect(toVideoPlatform(name)).toBe(name === 'webos' ? 'webOS' : name);
});

// Execute the actual Player load effect, without mounting unrelated menus/core hooks.
const source = fs.readFileSync('src/routes/Player/Player.js', 'utf8');
const ast = ts.createSourceFile('Player.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
let effect;
const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'React.useEffect' && node.arguments[0].getText(ast).includes('video.load(')) effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
};
visit(ast);
const runLoad = (name, host) => {
    const video = { load: jest.fn(), unload: jest.fn() };
    const onError = jest.fn();
    vm.runInNewContext(`(${effect})()`, {
        video, onError, window: host, videoPlatform: toVideoPlatform(name), getVideoPlatformError,
        setError: jest.fn(), cancelKeyboardSeek: jest.fn(),
        player: { selected: {}, stream: { type: 'Ready', content: { url: 'https://example.org/video.mp4' } }, libraryItem: null },
        streamingServer: {}, streamSubtitles: [], forceTranscoding: false, casting: false,
        settings: {}, platform: { shell: { active: false, capabilities: {} } }, services: { chromecast: { active: false } }
    });
    return { video, onError };
};
test.each([undefined, {}, { webOS: {} }, { webOS: { service: { request: true } } }])('missing bridge blocks actual Player effect: %p', host => {
    const { video, onError } = runLoad('webos', host);
    expect(video.load).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ critical: true, message: expect.stringContaining('window.webOS.service.request') }));
});
test.each(['webos', 'linux', 'android', 'ios', 'tizen'])('Player sends mapped platform: %s', name => {
    const { video, onError } = runLoad(name, name === 'webos' ? { webOS: { service: { request: jest.fn() } } } : undefined);
    expect(onError).not.toHaveBeenCalled();
    expect(video.load).toHaveBeenCalledWith(expect.objectContaining({ platform: toVideoPlatform(name) }), { shellTransport: null, chromecastTransport: null });
});

describe('published 0.0.96 selector (real wrappers, no implementation mocks)', () => {
    let select;
    beforeAll(() => {
        global.window = { navigator: { userAgent: '' }, webOS: { service: { request: jest.fn() } } };
        global.document = { createElement: () => ({ canPlayType: () => '' }) };
        select = require('@stremio/stremio-video/src/StremioVideo/selectVideoImplementation');
    });
    afterAll(() => { delete global.window; delete global.document; });
    test.each([undefined, 'https://example.org'])('webOS selects WebOsVideo with server %p', streamingServerURL => {
        expect(select({ platform: toVideoPlatform('webos'), stream: { url: 'https://example.org/video.mp4' }, streamingServerURL }, {}).manifest.name).toContain('WebOsVideo');
    });
    test('external URL remains unsupported', () => {
        expect(select({ platform: 'webOS', stream: { externalUrl: 'https://example.org' } }, {})).toBe(null);
    });
    test('YouTube preserves iframe implementation', () => {
        expect(select({ platform: 'webOS', stream: { ytId: 'test' } }, {}).manifest.name).toContain('YouTubeIFrameVideo');
    });
    test('desktop retains HTMLVideo; shell retains precedence', () => {
        const args = { platform: 'linux', stream: { url: 'https://example.org/video.mp4' } };
        expect(select(args, {}).manifest.name).toContain('HTMLVideo');
        expect(select(args, { shellTransport: {} }).manifest.name).toContain('ShellVideo');
    });
});
