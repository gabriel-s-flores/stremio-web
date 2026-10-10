// Header probe: reads the first MB of an MKV or MP4 by HTTP Range and describes its tracks
// (type, codec, language, channels, default flag), subtitles and Dolby Vision configuration.
// Output format: see README.md in this folder.

const { createSource, ProbeError, DEFAULTS } = require('./source');
const { createFetchReadRange } = require('./fetch-reader');
const { probeMkv, isMkv } = require('./mkv');
const { probeMp4, isMp4 } = require('./mp4');
const { DV_COMPATIBILITY } = require('./codecs');

const VERSION = 1;
const ATMOS_CAPABLE = ['eac3', 'truehd', 'ac4'];

const hdrOf = (video) => {
    if (video.dolbyVision !== null) return 'dolby-vision';
    const transfer = video.colour ? video.colour.transfer : null;
    if (transfer === 'pq') return 'hdr10';
    if (transfer === 'hlg') return 'hlg';
    if (transfer !== null) return 'sdr';
    return null;
};

const summarize = (tracks) => {
    const videos = tracks.filter((track) => track.type === 'video' && track.video);
    const audios = tracks.filter((track) => track.type === 'audio' && track.audio);
    const main = videos.filter((track) => track.video.dolbyVision === null || track.video.dolbyVision.blPresent !== false)[0] || videos[0] || null;
    const dvTrack = videos.filter((track) => track.video.dolbyVision !== null)[0] || null;
    let hdr = main !== null ? main.video.hdr : null;
    let dolbyVision = null;
    const dualTrack = videos.length > 1 && dvTrack !== null && dvTrack.video.dolbyVision.blPresent === false;
    if (dvTrack !== null) {
        hdr = 'dolby-vision';
        dolbyVision = Object.assign({}, dvTrack.video.dolbyVision);
        // Dual-track profile 7 (MP4): the base layer lives in the other video track.
        if (dualTrack) dolbyVision.baseLayer = DV_COMPATIBILITY[dolbyVision.compatibilityId] || 'unknown';
    }
    const atmosValues = audios.map((track) => track.audio.atmos);
    const audioCodecs = [];
    audios.forEach((track) => {
        if (audioCodecs.indexOf(track.codec) === -1) audioCodecs.push(track.codec);
    });
    return {
        videoCodec: main !== null ? main.codec : null,
        width: main !== null ? main.video.width : null,
        height: main !== null ? main.video.height : null,
        hdr,
        dolbyVision,
        dolbyVisionDualTrack: dualTrack,
        atmos: atmosValues.indexOf(true) !== -1 ? true : (atmosValues.indexOf(null) !== -1 ? null : false),
        audioCodecs,
        audioTracks: audios.length,
        subtitleTracks: tracks.filter((track) => track.type === 'subtitle').length,
    };
};

const finalize = (result, source) => {
    result.tracks.forEach((track, index) => {
        track.index = index;
        if (track.type === 'video' && track.video) {
            track.video.hdr = hdrOf(track.video);
        }
        if (track.type === 'audio' && track.audio && ATMOS_CAPABLE.indexOf(track.codec) === -1) {
            track.audio.atmos = false;
        }
    });
    return Object.assign({ version: VERSION }, result, {
        size: source.size(),
        summary: summarize(result.tracks),
        stats: { requests: source.stats.requests, bytesRead: source.stats.bytesRead },
    });
};

// readRange(offset, length) -> Promise<{ data: Uint8Array, size: number | null }>
// options: blockSize, maxBytes, maxRequests (see source.js), sniffFrames (default true),
// sniffMaxBlocks, sniffMaxClusters (MKV).
const probe = (readRange, options) => {
    const opts = options || {};
    const source = createSource(readRange, opts);
    return source.read(0, 64).then((head) => {
        if (isMkv(head)) return probeMkv(source, opts);
        if (isMp4(head)) return probeMp4(source, opts);
        throw new ProbeError('UNSUPPORTED', 'not an MKV/WebM or MP4 file');
    }).then((result) => finalize(result, source));
};

// Probes a URL with fetch() + Range. Extra options: fetch, headers, timeout (see fetch-reader.js).
const probeUrl = (url, options) => probe(createFetchReadRange(url, options), options);

module.exports = {
    probe,
    probeUrl,
    createFetchReadRange,
    ProbeError,
    DEFAULTS,
    VERSION,
};
