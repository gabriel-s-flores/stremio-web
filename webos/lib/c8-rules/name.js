// Signals read from the stream text an addon sends (name, title, description and
// behaviorHints.filename). They are the fallback when there is no probe and a second opinion
// when the probe is ambiguous (see index.js). Release names follow loose conventions, so every
// pattern is matched between non-alphanumeric boundaries: "DV" matches "4k DV | HDR" and
// "Movie.DV.HDR10" but not "DVDRip".

// Lookbehind is avoided on purpose (Chromium 53): the boundary before a token is consumed.
const B = '(?:^|[^a-z0-9])';
const E = '(?=$|[^a-z0-9])';
const re = (body) => new RegExp(B + body);

const PATTERNS = {
    dolbyVision: re('(?:dv|dovi|dolby[ ._-]?vision)' + E),
    // "DV P5", "DoVi.P8.1", "Profile 7": only read when a DV token is also present ("Season 1 P5").
    dvProfile: re('p(?:rofile)?[ ._-]?([5789])(?:\\.([1-4]))?' + E),
    // FEL and MEL are profile 7 enhancement layers; also words in Portuguese, so they need "DV".
    dvEnhancementLayer: re('(?:fel|mel)' + E),
    hdr10plus: re('(?:hdr10\\+|hdr10[ ._-]?plus|hdr\\+)'),
    hdr10: re('hdr[ ._-]?10' + E),
    hdr: re('hdr(?![ ._-]?rip)' + E),
    hlg: re('hlg' + E),
    sdr: re('sdr' + E),
    atmos: re('(?:atmos' + E + '|ddpa(?:[0-9]|' + E + '))'),
    hevc: re('(?:hevc|[hx][ .-]?265)' + E),
    avc: re('(?:avc|[hx][ .-]?264)' + E),
    av1: re('av1' + E),
    vp9: re('vp9' + E),
};

// Channel counts are often glued to the codec ("DDP5.1", "TrueHD7.1", "DTS5.1"), so a digit
// also ends a token.
const D = '(?:[0-9]|' + E + ')';
const AUDIO_PATTERNS = [
    ['truehd', re('true[ ._-]?hd' + D)],
    ['eac3', re('(?:ddp|dd\\+|eac-?3|ec-?3' + D + '|dolby[ ._-]?digital[ ._-]?(?:plus|\\+))')],
    ['ac3', re('(?:ac-?3' + D + '|dd(?![p+])' + D + '|dolby[ ._-]?digital(?![ ._-]?(?:plus|\\+)))')],
    ['dts', re('dts(?:[ .-]?hd(?:[ .-]?ma)?|x)?' + D)],
    ['aac', re('aac' + D)],
    ['flac', re('flac' + D)],
    ['opus', re('opus' + D)],
    ['pcm', re('l?pcm' + D)],
    ['mp3', re('mp3' + E)],
];

const CONTAINERS = { mkv: 'mkv', mp4: 'mp4', m4v: 'mp4', mov: 'mp4', webm: 'webm' };
const EXTENSION = /\.(mkv|mp4|m4v|mov|webm)$/;
const CONTAINER_TOKEN = re('(mkv|mp4|m4v|webm)' + E);

const textOf = (stream) => {
    if (stream === null || stream === undefined) return '';
    if (typeof stream === 'string') return stream;
    const hints = stream.behaviorHints || {};
    return [stream.name, stream.title, stream.description, hints.filename]
        .filter((part) => typeof part === 'string' && part.length > 0)
        .join('\n');
};

const containerOf = (stream, text) => {
    const filename = stream && typeof stream === 'object' && stream.behaviorHints ? stream.behaviorHints.filename : null;
    const fromName = typeof filename === 'string' ? EXTENSION.exec(filename.toLowerCase().trim()) : null;
    if (fromName) return CONTAINERS[fromName[1]];
    const token = CONTAINER_TOKEN.exec(text);
    return token ? CONTAINERS[token[1]] : null;
};

// stream: the addon stream object ({ name, title, description, behaviorHints }) or a string.
const parseStreamName = (stream) => {
    const raw = textOf(stream);
    // "E-AC-3" would also match AC-3 (the hyphen is a boundary), so it is folded first.
    const text = raw.toLowerCase().replace(/e-ac-?3/g, 'eac3');
    const has = (key) => PATTERNS[key].test(text);
    const dolbyVision = has('dolbyVision');
    const profileMatch = dolbyVision ? PATTERNS.dvProfile.exec(text) : null;
    let dvProfile = null;
    if (profileMatch) dvProfile = profileMatch[2] ? profileMatch[1] + '.' + profileMatch[2] : profileMatch[1];
    if (dvProfile === null && dolbyVision && has('dvEnhancementLayer')) dvProfile = '7';
    const audioCodecs = AUDIO_PATTERNS.filter((entry) => entry[1].test(text)).map((entry) => entry[0]);
    const atmos = has('atmos');
    // Atmos belongs to E-AC-3 or TrueHD; with both (or neither) in the name it cannot be told.
    // "DDPA" is the shorthand for DD+ Atmos.
    let atmosCodec = null;
    if (atmos) {
        const eac3 = audioCodecs.indexOf('eac3') !== -1;
        const truehd = audioCodecs.indexOf('truehd') !== -1;
        if (/(?:^|[^a-z0-9])ddpa/.test(text) && !truehd) atmosCodec = 'eac3';
        else if (eac3 && !truehd) atmosCodec = 'eac3';
        else if (truehd && !eac3) atmosCodec = 'truehd';
    }
    let videoCodec = null;
    if (has('av1')) videoCodec = 'av1';
    else if (has('hevc')) videoCodec = 'hevc';
    else if (has('avc')) videoCodec = 'avc';
    else if (has('vp9')) videoCodec = 'vp9';
    const hdr10plus = has('hdr10plus');
    return {
        text: raw,
        container: containerOf(stream, text),
        videoCodec,
        dolbyVision,
        dvProfile,
        hdr10plus,
        hdr10: hdr10plus || has('hdr10') || has('hdr'),
        hlg: has('hlg'),
        sdr: has('sdr'),
        atmos,
        atmosCodec,
        audioCodecs,
    };
};

module.exports = {
    parseStreamName,
};
