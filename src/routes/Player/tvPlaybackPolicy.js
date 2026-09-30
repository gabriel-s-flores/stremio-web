// Error codes belong to @stremio/stremio-video, not MediaError's DOM codes.
const getTVPlayerErrorKey = (code) => {
    if (code === 10001) return 'TV_STREAMING_GUIDE';
    if ([2, 60, 82, 83].includes(code)) return 'TV_PLAYER_CODEC_ERROR';
    if ([3, 80, 81].includes(code)) return 'TV_PLAYER_NETWORK_ERROR';
    if (code === 70) return 'TV_PLAYER_SUBTITLE_ERROR';
    return null;
};

const isASSSubtitle = (track) => /\.(ass|ssa)(?:$|[?#])/i.test(track?.url || track?.name || '');

module.exports = { getTVPlayerErrorKey, isASSSubtitle };
