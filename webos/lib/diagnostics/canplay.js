// The media types the diagnostics screen asks `canPlayType` (and MSE) about: the rows of the C8
// table in PESQUISA.md. Strings are the ones the emulator probe used (webos/tools/probe).
// `canPlayType` only says "does the pipeline know this", never "will it play": the real answer
// is the Phase 8 checklist on the TV.

const MEDIA_TYPES = [
    { group: 'Video', label: 'H.264 High', type: 'video/mp4; codecs="avc1.640028"' },
    { group: 'Video', label: 'HEVC Main10 (hvc1)', type: 'video/mp4; codecs="hvc1.2.4.L153.B0"' },
    { group: 'Video', label: 'HEVC Main10 (hev1)', type: 'video/mp4; codecs="hev1.2.4.L153.B0"' },
    { group: 'Video', label: 'VP9 Profile 2', type: 'video/webm; codecs="vp09.02.51.10"' },
    { group: 'Video', label: 'AV1 10-bit', type: 'video/mp4; codecs="av01.0.08M.10"' },
    { group: 'Dolby Vision', label: 'DV P5 (dvh1.05)', type: 'video/mp4; codecs="dvh1.05.06"' },
    { group: 'Dolby Vision', label: 'DV P5 (dvhe.05)', type: 'video/mp4; codecs="dvhe.05.06"' },
    { group: 'Dolby Vision', label: 'DV P8 (dvh1.08)', type: 'video/mp4; codecs="dvh1.08.06"' },
    { group: 'Dolby Vision', label: 'DV P8 (dvhe.08)', type: 'video/mp4; codecs="dvhe.08.06"' },
    { group: 'Dolby Vision', label: 'DV P7 (dvhe.07)', type: 'video/mp4; codecs="dvhe.07.06"' },
    // JOC (Atmos) rides on the ec-3 codec string: canPlayType cannot tell it from plain E-AC-3.
    { group: 'Audio', label: 'AAC-LC', type: 'audio/mp4; codecs="mp4a.40.2"' },
    { group: 'Audio', label: 'AC-3', type: 'audio/mp4; codecs="ac-3"' },
    { group: 'Audio', label: 'E-AC-3 / JOC (ec-3)', type: 'audio/mp4; codecs="ec-3"' },
    { group: 'Audio', label: 'HEVC + E-AC-3', type: 'video/mp4; codecs="hvc1.2.4.L153.B0, ec-3"' },
    { group: 'Audio', label: 'TrueHD (mlpa)', type: 'audio/mp4; codecs="mlpa"' },
    { group: 'Audio', label: 'DTS (dtsc)', type: 'audio/mp4; codecs="dtsc"' },
    { group: 'Audio', label: 'DTS-HD (dtsh)', type: 'audio/mp4; codecs="dtsh"' },
    { group: 'Audio', label: 'DTS Express (dtse)', type: 'audio/mp4; codecs="dtse"' },
    { group: 'Audio', label: 'DTS:X (dtsx)', type: 'audio/mp4; codecs="dtsx"' },
    { group: 'Audio', label: 'FLAC', type: 'audio/flac' },
    { group: 'Audio', label: 'Opus', type: 'audio/webm; codecs="opus"' },
    { group: 'Container', label: 'MKV', type: 'video/x-matroska' },
    { group: 'Container', label: 'MKV + HEVC', type: 'video/x-matroska; codecs="hev1"' },
    { group: 'Container', label: 'MPEG-TS', type: 'video/mp2t' },
    { group: 'Container', label: 'HLS', type: 'application/vnd.apple.mpegurl' },
];

module.exports = { MEDIA_TYPES };
