/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest, beforeAll, afterEach */
// F6.3: the Player error layer override (Error.webos.js) over a stand-in of the upstream Error with
// the same render shape: the message of the dead link and its hint replace the upstream message, a
// link that answers leaves the upstream one, and the layer asks the check once per stream.

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const path = require('path');

const ERROR_DIR = path.join(__dirname, '..', '..', '..', '..', 'src', 'routes', 'Player', 'Error');

jest.mock('../../../../src/routes/Player/Error/Error.js', () => {
    const MockReact = require('react');
    const h = MockReact.createElement;
    // Like the upstream one: the code 2 hint, and the "Open in external player" button when the stream
    // has the external player playlist.
    const Upstream = MockReact.forwardRef(({ className, code, message, stream }, ref) => h('div', { ref, className },
        h('div', { className: 'error-label' }, message),
        code === 2 ? h('div', { className: 'error-sub' }, 'external player hint') : null,
        stream && stream.deepLinks && stream.deepLinks.externalPlayer && stream.deepLinks.externalPlayer.playlist && stream.deepLinks.externalPlayer.fileName ?
            h('a', { className: 'playlist-button', href: stream.deepLinks.externalPlayer.playlist }, 'PLAYER_OPEN_IN_EXTERNAL')
            :
            null));
    Upstream.propTypes = {};
    return Upstream;
});
jest.mock('../../../../src/routes/Player/Error/styles', () => ({ 'error-sub': 'error-sub' }), { virtual: true });
jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key, options) => `${key}|${options.defaultValue}` }),
}));
jest.mock('../index', () => {
    const actual = jest.requireActual('../index');
    return Object.assign({}, actual, { diagnose: jest.fn() });
});

const debridLink = require('../index');

beforeAll(() => jest.spyOn(console, 'warn').mockImplementation(() => null));
const Error = require(path.join(ERROR_DIR, 'Error.webos.js'));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;
let container = null;

const render = async (props) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root.render(React.createElement(Error, props));
    });
};

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    debridLink.diagnose.mockReset();
    debridLink.rememberStream(undefined);
});

const stream = { url: 'https://resolver.example/resolve/KEY/file.mkv' };

describe('Error.webos', () => {
    it('shows the upstream message while nothing is known about the link', async () => {
        debridLink.diagnose.mockReturnValue(new Promise(() => null));
        await render({ code: 83, message: 'Video is not supported', stream });
        expect(container.querySelector('.error-label').textContent).toBe('Video is not supported');
        expect(container.querySelector('.error-sub')).toBeNull();
    });

    it('replaces it with the message and the hint of an expired link', async () => {
        debridLink.diagnose.mockResolvedValue({ kind: 'expired', status: 403, source: 'request', host: 'cdn.example' });
        await render({ code: 83, message: 'Video is not supported', stream });
        expect(debridLink.diagnose).toHaveBeenCalledWith(stream, 83);
        expect(container.querySelector('.error-label').textContent).toContain('WEBOS_LINK_EXPIRED|This link has expired');
        expect(container.querySelector('.error-sub').textContent).toContain('WEBOS_LINK_EXPIRED_HINT|Go back');
        expect(container.firstChild.getAttribute('data-link-problem')).toBe('expired');
    });

    it('drops the external player hint of code 2 when the link is the problem', async () => {
        debridLink.diagnose.mockResolvedValue({ kind: 'not-found', status: 404, source: 'probe', host: 'cdn.example' });
        await render({ code: 2, message: 'Stream is not supported', stream });
        expect(container.querySelectorAll('.error-sub')).toHaveLength(1);
        expect(container.querySelector('.error-sub').textContent).toContain('WEBOS_LINK_NOT_FOUND_HINT');
    });

    it('keeps the upstream message when the link answers', async () => {
        debridLink.diagnose.mockResolvedValue({ kind: 'ok', status: 206, source: 'request', host: 'cdn.example' });
        await render({ code: 83, message: 'Video is not supported', stream });
        expect(container.querySelector('.error-label').textContent).toBe('Video is not supported');
        expect(container.firstChild.getAttribute('data-link-problem')).toBeNull();
    });

    it('masks the certificate proxy token if the message carries the proxy URL (F3.7b)', async () => {
        debridLink.diagnose.mockReturnValue(new Promise(() => null));
        const token = '0123456789abcdef0123456789abcdef';
        await render({ code: 70, message: `Failed http://127.0.0.1:47443/proxy?t=${token}&url=x`, stream });
        expect(container.querySelector('.error-label').textContent).toBe('Failed http://127.0.0.1:47443/proxy?t=***&url=x');
        expect(container.querySelector('.error-label').getAttribute('title')).toBeNull();
        expect(container.innerHTML).not.toContain(token);
    });

    it('reads the stream the Player loaded when the state no longer has it', async () => {
        debridLink.rememberStream(stream);
        debridLink.diagnose.mockResolvedValue({ kind: 'network', status: null, source: 'request', host: 'cdn.example' });
        await render({ code: 81, message: 'Error occurred when downloading', stream: null });
        expect(debridLink.diagnose).toHaveBeenCalledWith(stream, 81);
        expect(container.querySelector('.error-label').textContent).toContain('WEBOS_LINK_NETWORK|Could not reach');
    });

    it('no external player on the TV (F8.4): no "Open in external player" button and no code 2 hint', async () => {
        const withLinks = Object.assign({}, stream, {
            deepLinks: { player: '#/player/x', externalPlayer: { playlist: 'data:application/vnd.apple.mpegurl;base64,AA', fileName: 'playlist.m3u' } },
        });
        debridLink.diagnose.mockResolvedValue({ kind: 'ok', status: 206, source: 'request', host: 'cdn.example' });
        await render({ code: 2, message: 'Stream is not supported', stream: withLinks });
        expect(container.querySelector('.error-label').textContent).toBe('Stream is not supported');
        expect(container.querySelector('.playlist-button')).toBeNull();
        expect(container.querySelector('.error-sub')).toBeNull();
        // The link check still gets the real stream and code.
        expect(debridLink.diagnose).toHaveBeenCalledWith(withLinks, 2);
    });

    it('no external player button either when the link is the problem', async () => {
        const withLinks = Object.assign({}, stream, { deepLinks: { externalPlayer: { playlist: 'data:x', fileName: 'playlist.m3u' } } });
        debridLink.diagnose.mockResolvedValue({ kind: 'expired', status: 410, source: 'request', host: 'cdn.example' });
        await render({ code: 83, message: 'Video is not supported', stream: withLinks });
        expect(container.querySelector('.playlist-button')).toBeNull();
        expect(container.querySelector('.error-label').textContent).toContain('WEBOS_LINK_EXPIRED');
    });

    it('a Torrentio notice (debrid access denied) replaces "Stream failed to load" with what the notice says', async () => {
        debridLink.diagnose.mockResolvedValue({ kind: 'notice-access-denied', status: 206, source: 'request', redirected: true, host: 'torrentio.strem.fun' });
        await render({ code: 3, message: 'Stream failed to load', stream });
        expect(container.querySelector('.error-label').textContent).toContain('WEBOS_LINK_NOTICE_ACCESS_DENIED|The debrid service denied access');
        expect(container.querySelector('.error-sub').textContent).toContain('WEBOS_LINK_NOTICE_ACCESS_DENIED_HINT|Check the API key');
        expect(container.firstChild.getAttribute('data-link-problem')).toBe('notice-access-denied');
    });

    it('checks nothing for a stream without an HTTP URL', async () => {
        await render({ code: 83, message: 'Video is not supported', stream: { ytId: 'abc' } });
        expect(debridLink.diagnose).not.toHaveBeenCalled();
    });
});
