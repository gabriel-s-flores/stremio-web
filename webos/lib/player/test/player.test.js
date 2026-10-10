const React = require('react');
const { WEBOS_LOAD_ARGS, PLAYBACK_SPEED_SUPPORTED, toWebOsLoadArgs, removeElements } = require('..');

describe('toWebOsLoadArgs', () => {
    const upstreamArgs = {
        stream: { url: 'https://example.com/movie.mkv' },
        autoplay: true,
        time: 0,
        forceTranscoding: true,
        maxAudioChannels: 2,
        hardwareDecoding: true,
        platform: 'webOS',
        streamingServerURL: 'http://127.0.0.1:11470/',
        seriesInfo: null,
    };

    it('turns transcoding off, drops the streaming server and asks for every audio channel', () => {
        const args = toWebOsLoadArgs(upstreamArgs);
        expect(args.forceTranscoding).toBe(false);
        expect(args.streamingServerURL).toBeNull();
        expect(args.maxAudioChannels).toBe(32);
    });

    it('keeps everything else and does not touch the input', () => {
        const input = { ...upstreamArgs };
        const args = toWebOsLoadArgs(input);
        expect(args).toEqual({ ...upstreamArgs, ...WEBOS_LOAD_ARGS });
        expect(input).toEqual(upstreamArgs);
        expect(args.stream).toBe(upstreamArgs.stream);
    });

    it('keeps the platform the Player resolved (WebOsVideo needs "webOS")', () => {
        expect(toWebOsLoadArgs(upstreamArgs).platform).toBe('webOS');
    });
});

describe('PLAYBACK_SPEED_SUPPORTED', () => {
    it('is off on the C8', () => {
        expect(PLAYBACK_SPEED_SUPPORTED).toBe(false);
    });
});

describe('removeElements', () => {
    const h = React.createElement;
    const onSpeed = () => {};
    const onCast = () => {};
    const byClick = (handler) => (node) => node.props.onClick === handler;
    const types = (children) => React.Children.toArray(children).map((child) => child.props.id);

    const bar = () => h('div', { id: 'bar' },
        h('div', { id: 'top' }, h('span', { id: 'time' }, '1:00')),
        h('div', { id: 'menu' },
            h('button', { id: 'speed', onClick: onSpeed }),
            h('button', { id: 'cast', onClick: onCast }),
            null,
            false,
        ),
    );

    it('drops the matching element and keeps its siblings in order', () => {
        const result = removeElements(React, bar(), byClick(onSpeed));
        const [top, menu] = React.Children.toArray(result.props.children);
        expect(top.props.id).toBe('top');
        expect(types(menu.props.children)).toEqual(['cast']);
    });

    it('keeps the identity of untouched elements', () => {
        const element = bar();
        const result = removeElements(React, element, byClick(onSpeed));
        expect(result).not.toBe(element);
        const originalTop = element.props.children[0];
        const resultTop = React.Children.toArray(result.props.children)[0];
        expect(resultTop.type).toBe(originalTop.type);
        expect(resultTop.props).toBe(originalTop.props);
    });

    it('returns the same element when nothing matches', () => {
        const element = bar();
        expect(removeElements(React, element, byClick(() => {}))).toBe(element);
    });

    it('returns null when the root matches', () => {
        const element = h('button', { onClick: onSpeed });
        expect(removeElements(React, element, byClick(onSpeed))).toBeNull();
    });

    it('leaves text, null and render-prop children alone', () => {
        const renderProp = () => null;
        expect(removeElements(React, 'text', byClick(onSpeed))).toBe('text');
        expect(removeElements(React, null, byClick(onSpeed))).toBeNull();
        const element = h('div', null, renderProp);
        expect(removeElements(React, element, byClick(onSpeed))).toBe(element);
    });
});
