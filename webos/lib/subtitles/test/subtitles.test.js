/* global describe, it, expect */
// Pipeline colors for the subtitle settings and the tlsproxy for add-on subtitles (F5.5).

const {
    parseColor,
    toWebOsTextColor,
    toWebOsBackgroundColor,
    proxifySubtitlesTracks,
    originalUrl,
    restoreSubtitlesTracksUrls,
} = require('../index');
const { proxyUrlFor } = require('../../../tlsproxy/client');

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

describe('originalUrl and restoreSubtitlesTracksUrls (F3.7b)', () => {
    const TOKEN = '0123456789abcdef0123456789abcdef';
    const URLS = [
        'https://debrid-link.com/subs/pt-BR.srt',
        'https://debrid-link.com/a b/ç.srt?x=1&y=2#frag',
        'https://image.tmdb.org/sub.ass?token=a%26b',
    ];

    it('undoes proxyUrlFor for any URL', () => {
        URLS.forEach((url) => {
            expect(originalUrl(proxyUrlFor(47443, TOKEN, url))).toBe(url);
            expect(originalUrl(proxyUrlFor(1234, 'abc-DEF_9', url))).toBe(url);
        });
    });

    it('leaves everything else as it is', () => {
        ['https://example.com/a.srt', 'http://127.0.0.1:11470/subs.srt', 'http://127.0.0.1:47443/status?t=x', 'blob:abc', '', undefined, null, 5].forEach((value) => {
            expect(originalUrl(value)).toBe(value);
        });
        const broken = 'http://127.0.0.1:47443/proxy?t=x&url=%E0%A4%A';
        expect(originalUrl(broken)).toBe(broken);
    });

    it('restores url and fallbackUrl of the tracks and returns the same array when nothing changes', () => {
        const [first, second] = URLS;
        const tracks = [
            { id: 'a', url: proxyUrlFor(47443, TOKEN, first), fallbackUrl: proxyUrlFor(47443, TOKEN, second), lang: 'eng' },
            { id: 'b', url: 'https://example.com/b.srt', lang: 'por' },
            { id: 'c', content: 'text', lang: 'spa' },
        ];
        const restored = restoreSubtitlesTracksUrls(tracks);
        expect(restored[0]).toEqual({ id: 'a', url: first, fallbackUrl: second, lang: 'eng' });
        expect(restored[1]).toBe(tracks[1]);
        expect(restored[2]).toBe(tracks[2]);
        expect(JSON.stringify(restored)).not.toContain(TOKEN);
        expect(tracks[0].url).toContain(TOKEN);
        const plain = [tracks[1], tracks[2]];
        expect(restoreSubtitlesTracksUrls(plain)).toBe(plain);
        expect(restoreSubtitlesTracksUrls(undefined)).toBe(undefined);
    });

    it('is the inverse of proxifySubtitlesTracks', () => {
        const proxify = (url) => proxyUrlFor(47443, TOKEN, url);
        const tracks = URLS.map((url, i) => ({ id: String(i), url, fallbackUrl: url, lang: 'eng' }));
        expect(restoreSubtitlesTracksUrls(proxifySubtitlesTracks(tracks, proxify))).toEqual(tracks);
    });
});
