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
    // "DV P5", "DoVi.P8.1", "P7", "Profile 5": the profile alone is enough (it only exists for DV).
    dvProfile: re('(?:dv|dovi)?[ ._-]?p(?:rofile)?[ ._-]?([5789])(?:\\.([1-4]))?' + E),
    // FEL and MEL are profile 7 enhancement layers; also words in Portuguese, so they need "DV".
    dvEnhancementLayer: re('(?:fel|mel)' + E),
    hdr10plus: re('(?:hdr10\\+|hdr10[ ._-]?plus|hdr\\+)'),
    hdr10: re('hdr[ ._-]?10' + E),
    hdr: re('hdr' + E),
    hlg: re('hlg' + E),
    sdr: re('sdr' + E),
    atmos: re('atmos' + E),
    hevc: re('(?:hevc|[hx][ .]?265)' + E),
    avc: re('(?:avc|[hx][ .]?264)' + E),
    av1: re('av1' + E),
    vp9: re('vp9' + E),
};

const AUDIO_PATTERNS = [
    ['truehd', re('true[ ._-]?hd' + E)],
    ['eac3', re('(?:ddp|dd\\+|eac-?3|dolby[ ._-]?digital[ ._-]?plus)')],
    ['ac3', re('(?:ac-?3' + E + '|dd(?![p+])(?:[0-9]|' + E + ')|dolby[ ._-]?digital(?![ ._-]?plus))')],
    ['dts', re('dts(?:hd|x)?' + E)],
    ['aac', re('aac(?:[0-9]|' + E + ')')],
    ['flac', re('flac(?:[0-9]|' + E + ')')],
    ['opus', re('opus(?:[0-9]|' + E + ')')],
    ['pcm', re('l?pcm' + E)],
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
    const profileMatch = PATTERNS.dvProfile.exec(text);
    let dvProfile = null;
    if (profileMatch) dvProfile = profileMatch[2] ? profileMatch[1] + '.' + profileMatch[2] : profileMatch[1];
    const dolbyVision = has('dolbyVision') || dvProfile !== null;
    if (dvProfile === null && dolbyVision && has('dvEnhancementLayer')) dvProfile = '7';
    const audioCodecs = AUDIO_PATTERNS.filter((entry) => entry[1].test(text)).map((entry) => entry[0]);
    const atmos = has('atmos');
    // Atmos belongs to E-AC-3 or TrueHD; with both (or neither) in the name it cannot be told.
    let atmosCodec = null;
    if (atmos) {
        const eac3 = audioCodecs.indexOf('eac3') !== -1;
        const truehd = audioCodecs.indexOf('truehd') !== -1;
        if (eac3 && !truehd) atmosCodec = 'eac3';
        if (truehd && !eac3) atmosCodec = 'truehd';
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
