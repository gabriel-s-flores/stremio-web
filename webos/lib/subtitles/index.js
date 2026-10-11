// webOS player subtitles (F5.5): what the app changes on the way to stremio-video for the subtitles.
// Pure functions; the tracks decorator (webos/lib/tracks/withC8Tracks.js) and the useVideo override
// call them. See README.md.

// The colors the pipeline draws embedded subtitles with (Luna setSubtitleCharacterColor and
// setSubtitleBackgroundColor), as the stremio-video WebOsVideo keys that select each one.
const WEBOS_COLORS = [
    { name: 'white', rgb: [255, 255, 255], key: '#FFFFFFFF' },
    { name: 'yellow', rgb: [255, 255, 0], key: '#FFFF00FF' },
    { name: 'red', rgb: [255, 0, 0], key: '#FF0000FF' },
    { name: 'green', rgb: [0, 255, 0], key: '#00FF00FF' },
    { name: 'blue', rgb: [0, 0, 255], key: '#0000FFFF' },
    { name: 'black', rgb: [0, 0, 0], key: '#000000FF' },
];
// WebOsVideo's key for "no background".
const TRANSPARENT_KEY = 'rgba(0, 0, 0, 0)';

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?)\s*)?\)$/i;

// '#RGB', '#RGBA', '#RRGGBB', '#RRGGBBAA' (the settings use this one), 'rgb()' and 'rgba()' (alpha
// 0–1, or 0–255 as WebOsVideo also reads it) -> { rgb: [r, g, b], alpha: 0–1 }, null otherwise.
const parseColor = (color) => {
    if (typeof color !== 'string') return null;
    const value = color.trim();
    const hex = HEX.exec(value);
    if (hex) {
        let digits = hex[1];
        if (digits.length <= 4) digits = digits.split('').map((digit) => digit + digit).join('');
        const bytes = [];
        for (let i = 0; i < digits.length; i += 2) bytes.push(parseInt(digits.slice(i, i + 2), 16));
        return { rgb: bytes.slice(0, 3), alpha: bytes.length === 4 ? bytes[3] / 255 : 1 };
    }
    const rgb = RGB.exec(value);
    if (rgb) {
        const alpha = rgb[4] === undefined ? 1 : parseFloat(rgb[4]);
        return {
            rgb: [1, 2, 3].map((i) => Math.min(255, Math.round(parseFloat(rgb[i])))),
            alpha: alpha > 1 ? Math.min(1, alpha / 255) : alpha,
        };
    }
    return null;
};

const nearestColor = (rgb) => {
    let best = WEBOS_COLORS[0];
    let bestDistance = Infinity;
    WEBOS_COLORS.forEach((color) => {
        const distance = color.rgb.reduce((sum, channel, i) => sum + (channel - rgb[i]) * (channel - rgb[i]), 0);
        if (distance < bestDistance) {
            best = color;
            bestDistance = distance;
        }
    });
    return best;
};

// The subtitles text color of the settings as a value WebOsVideo maps to a pipeline color: the
// nearest of the six (WebOsVideo itself only knows the exact ones and falls back to white). The
// text opacity is another setting (subtitlesOpacity). Unreadable values pass unchanged.
const toWebOsTextColor = (color) => {
    const parsed = parseColor(color);
    return parsed ? nearestColor(parsed.rgb).key : color;
};

// The background color: transparent stays without background; any other alpha gets the nearest
// color, opaque (WebOsVideo sends the background opacity as 0 or 255).
const toWebOsBackgroundColor = (color) => {
    const parsed = parseColor(color);
    if (!parsed) return color;
    return parsed.alpha === 0 ? TRANSPARENT_KEY : nearestColor(parsed.rgb).key;
};

// Add-on subtitles go through the tlsproxy (F3.7) when their host has a Let's Encrypt certificate
// (known, or learned when the core worker fetched the add-on through the proxy): the page fetch of
// withHTMLSubtitles fails on them with net::ERR_INSECURE_RESPONSE. `proxify` is the tlsproxy one
// (null while the proxy for a known host is starting: the URL is kept, like upstream). Tracks with
// a local buffer or inline content, and other URLs, are not changed; with nothing to change, the
// same array comes back.
const proxifySubtitlesTracks = (tracks, proxify) => {
    if (!Array.isArray(tracks) || typeof proxify !== 'function') return tracks;
    const through = (url) => {
        if (typeof url !== 'string') return url;
        const proxied = proxify(url);
        return typeof proxied === 'string' ? proxied : url;
    };
    const result = tracks.map((track) => {
        if (!track || typeof track !== 'object') return track;
        const url = through(track.url);
        const fallbackUrl = through(track.fallbackUrl);
        if (url === track.url && fallbackUrl === track.fallbackUrl) return track;
        const proxied = Object.assign({}, track, { url });
        if (track.fallbackUrl !== undefined) proxied.fallbackUrl = fallbackUrl;
        return proxied;
    });
    return result.some((track, i) => track !== tracks[i]) ? result : tracks;
};

// The tlsproxy URL of a subtitle (http://127.0.0.1:<port>/proxy?t=<token>&url=<encoded>, see
// webos/tlsproxy/client.js proxyUrlFor) back to the URL it stands for; anything else comes back as is.
const PROXY_URL = /^http:\/\/127\.0\.0\.1:\d+\/proxy\?t=[\w-]*&url=([^&#]+)$/;
const originalUrl = (url) => {
    const match = typeof url === 'string' ? PROXY_URL.exec(url) : null;
    if (!match) return url;
    try {
        return decodeURIComponent(match[1]);
    } catch (error) {
        return url;
    }
};

// The add-on subtitles tracks of the video state with the URLs the add-on gave, not the proxy ones
// (F3.7b): the Player shows them ("Copy subtitle URL", the link of "Download subtitles", which the
// external links dialog turns into a QR), and a proxy URL is a loopback address with the proxy token.
// The pipeline keeps getting the proxy URL (proxifySubtitlesTracks, on the way in). With nothing to
// change, the same array comes back.
const restoreSubtitlesTracksUrls = (tracks) => {
    if (!Array.isArray(tracks)) return tracks;
    const result = tracks.map((track) => {
        if (!track || typeof track !== 'object') return track;
        const url = originalUrl(track.url);
        const fallbackUrl = originalUrl(track.fallbackUrl);
        if (url === track.url && fallbackUrl === track.fallbackUrl) return track;
        const restored = Object.assign({}, track, { url });
        if (track.fallbackUrl !== undefined) restored.fallbackUrl = fallbackUrl;
        return restored;
    });
    return result.some((track, i) => track !== tracks[i]) ? result : tracks;
};

module.exports = {
    WEBOS_COLORS,
    TRANSPARENT_KEY,
    parseColor,
    toWebOsTextColor,
    toWebOsBackgroundColor,
    proxifySubtitlesTracks,
    originalUrl,
    restoreSubtitlesTracksUrls,
};
