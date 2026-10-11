/* global describe, it, expect */
// Pipeline colors for the subtitle settings and the tlsproxy for add-on subtitles (F5.5).

const {
    parseColor,
    toWebOsTextColor,
    toWebOsBackgroundColor,
    proxifySubtitlesTracks,
} = require('../index');

describe('parseColor', () => {
    it('reads the settings format and the CSS forms WebOsVideo knows', () => {
        expect(parseColor('#FFFFFFFF')).toEqual({ rgb: [255, 255, 255], alpha: 1 });
        expect(parseColor('#00000080')).toEqual({ rgb: [0, 0, 0], alpha: 128 / 255 });
        expect(parseColor('#ff0')).toEqual({ rgb: [255, 255, 0], alpha: 1 });
        expect(parseColor('#00ff00')).toEqual({ rgb: [0, 255, 0], alpha: 1 });
        expect(parseColor('rgb(0, 0, 255)')).toEqual({ rgb: [0, 0, 255], alpha: 1 });
        expect(parseColor('rgba(0, 0, 0, 0)')).toEqual({ rgb: [0, 0, 0], alpha: 0 });
        expect(parseColor('rgba(255, 255, 255, 255)')).toEqual({ rgb: [255, 255, 255], alpha: 1 });
    });

    it('null for anything else', () => {
        expect(parseColor('white')).toBeNull();
        expect(parseColor('#12345')).toBeNull();
        expect(parseColor(null)).toBeNull();
    });
});

describe('pipeline colors', () => {
    it('text: the nearest of the six pipeline colors, as the key WebOsVideo maps', () => {
        expect(toWebOsTextColor('#FFFFFFFF')).toBe('#FFFFFFFF');
        expect(toWebOsTextColor('#F5F5DCFF')).toBe('#FFFFFFFF');
        expect(toWebOsTextColor('#FFD700FF')).toBe('#FFFF00FF');
        expect(toWebOsTextColor('#D02020FF')).toBe('#FF0000FF');
        expect(toWebOsTextColor('#20C040FF')).toBe('#00FF00FF');
        expect(toWebOsTextColor('#1E3CF0FF')).toBe('#0000FFFF');
        expect(toWebOsTextColor('#202020FF')).toBe('#000000FF');
        // the text alpha is another setting (opacity)
        expect(toWebOsTextColor('#FFFF0080')).toBe('#FFFF00FF');
        expect(toWebOsTextColor('unknown')).toBe('unknown');
    });

    it('background: transparent stays without background, any other alpha becomes opaque', () => {
        expect(toWebOsBackgroundColor('#00000000')).toBe('rgba(0, 0, 0, 0)');
        expect(toWebOsBackgroundColor('#FFFFFF00')).toBe('rgba(0, 0, 0, 0)');
        expect(toWebOsBackgroundColor('#00000080')).toBe('#000000FF');
        expect(toWebOsBackgroundColor('#0000C0FF')).toBe('#0000FFFF');
    });
});

describe('proxifySubtitlesTracks', () => {
    const proxify = (url) => {
        if (url.indexOf('https://le.example/') === 0) return 'http://127.0.0.1:47443/proxy?t=x&url=' + encodeURIComponent(url);
        if (url.indexOf('https://starting.example/') === 0) return null;
        return url;
    };

    it('rewrites url and fallbackUrl of Let\'s Encrypt hosts and keeps the rest of the track', () => {
        const [track] = proxifySubtitlesTracks([{ id: 'a', lang: 'eng', url: 'https://le.example/a.ass', fallbackUrl: 'https://le.example/a.vtt' }], proxify);
        expect(track).toEqual({
            id: 'a',
            lang: 'eng',
            url: 'http://127.0.0.1:47443/proxy?t=x&url=' + encodeURIComponent('https://le.example/a.ass'),
            fallbackUrl: 'http://127.0.0.1:47443/proxy?t=x&url=' + encodeURIComponent('https://le.example/a.vtt'),
        });
        // the extension stays at the end: withHTMLSubtitles still sees an ASS file
        expect(/\.(ass|ssa)(?:$|[?#])/i.test(track.url)).toBe(true);
    });

    it('other hosts, a proxy still starting and tracks without url stay as they are (same array)', () => {
        const tracks = [
            { id: 'b', url: 'https://other.example/b.srt' },
            { id: 'c', url: 'https://starting.example/c.srt' },
            { id: 'd', buffer: new ArrayBuffer(1) },
            null,
        ];
        expect(proxifySubtitlesTracks(tracks, proxify)).toBe(tracks);
        expect(proxifySubtitlesTracks(undefined, proxify)).toBeUndefined();
        expect(proxifySubtitlesTracks(tracks, null)).toBe(tracks);
    });
});
