// C8 capability rules (plan D6 to D8): given the header probe output (F5.2) and/or the stream
// text from the addon, decides what the LG C8 will actually show and play: the initial audio
// track, quality labels ("DV", "HDR10 nesta TV", "Atmos"), warnings and a score for sorting.
// The device facts live in perfil-c8.json, so phase 8 can adjust them without code changes.
// API and output format: see README.md in this folder.

const DEFAULT_PROFILE = require('./perfil-c8.json');
const { parseStreamName } = require('./name');
const { normalizeLanguage } = require('./languages');

const VERSION = 1;
const PROBE_VERSION = 1;
const AUDIO_TIERS = { ok: 0, unconfirmed: 1, unknown: 2, unsupported: 3 };
const TIERS = { ok: 0, demoted: 1, hidden: 2 };
const BASE_LAYER_OUTPUT = { hdr10: 'hdr10', hlg: 'hlg', sdr: 'sdr' };
// Base layer implied by a Dolby Vision profile read from the stream name.
const NAME_BASE_LAYER = { '5': 'none', '7': 'hdr10', '8.1': 'hdr10', '8.2': 'sdr', '8.4': 'hlg' };
// Profiles tried when the name says "DV" without one: the usual forms of streaming releases.
const COMMON_DV_PROFILES = ['5', '8.1'];

const CODEC_NAMES = {
    eac3: 'E-AC-3', ac3: 'AC-3', aac: 'AAC', truehd: 'TrueHD', dts: 'DTS', flac: 'FLAC',
    opus: 'Opus', vorbis: 'Vorbis', mp3: 'MP3', pcm: 'PCM', ac4: 'AC-4', av1: 'AV1', vp9: 'VP9',
};
const STATUS_TEXT = {
    unsupported: 'não toca na C8',
    unconfirmed: 'tem suporte ainda não confirmado na C8',
    unknown: 'tem suporte desconhecido na C8',
};

// Commentary/description tracks by name (the MP4 has no commentary flag).
const SECONDARY_NAME = /comment|coment[aá]rio|commentaire|kommentar|audio ?descri/i;

const codecName = (codec) => CODEC_NAMES[codec] || String(codec).toUpperCase();

const describeTrack = (track) => (track.profile || codecName(track.codec)) + ' (' + (track.language || 'sem idioma') + ')';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Deep merge for profile overrides (phase 8 configuration): objects merge, anything else replaces.
const mergeProfile = (base, overrides) => {
    if (!isPlainObject(overrides)) return base;
    const out = {};
    Object.keys(base).forEach((key) => {
        out[key] = base[key];
    });
    Object.keys(overrides).forEach((key) => {
        out[key] = isPlainObject(base[key]) && isPlainObject(overrides[key]) ? mergeProfile(base[key], overrides[key]) : overrides[key];
    });
    return out;
};

const createReport = (profile) => {
    const warnings = [];
    const labels = [];
    return {
        warnings,
        labels,
        warn: (code, source, message, track) => {
            const rule = profile.warnings[code] || { severity: 'info', score: 0 };
            warnings.push({ code, severity: rule.severity, score: rule.score, source, track: track === undefined ? null : track, message });
        },
        label: (code, source) => {
            labels.push({ code, text: profile.labels[code] || code, source });
        },
    };
};

const mainVideoTrack = (probe) => {
    const videos = probe.tracks.filter((track) => track.type === 'video' && track.video);
    return videos.filter((track) => track.video.dolbyVision === null || track.video.dolbyVision.blPresent !== false)[0] || videos[0] || null;
};

const hasProbeWarning = (probe, code) => probe.warnings.some((warning) => warning.code === code);

// ---- Video -------------------------------------------------------------------------------------

const dvFromName = (name, probeHdr, source) => {
    let profile = name.dvProfile;
    // "P8" alone: the sub-profile follows the HDR hint; streaming P8 is almost always 8.1.
    if (profile === '8') profile = name.hlg ? '8.4' : (name.sdr ? '8.2' : '8.1');
    let baseLayer = profile !== null && NAME_BASE_LAYER[profile] ? NAME_BASE_LAYER[profile] : 'unknown';
    if (baseLayer === 'unknown') {
        // Only PQ/HLG colour from the probe counts: P5 often carries unspecified or BT.709 colour.
        if (probeHdr === 'hdr10' || probeHdr === 'hlg') baseLayer = probeHdr;
        else if (name.hdr10) baseLayer = 'hdr10';
        else if (name.hlg) baseLayer = 'hlg';
    }
    return { profile, baseLayer, dualTrack: false, source };
};

// In MKV HEVC without DV found, the probe is ambiguous when the first frame was not read
// (DV_UNKNOWN) or the colour says nothing against P5: unknown, or SDR on a video that is not
// known to be 8-bit (P5 often carries BT.709 VUI). PQ/HLG colour read with the frame is a real
// HDR10/HLG base layer, so then the probe wins over the name.
const probeIsAmbiguous = (probe) => {
    if (hasProbeWarning(probe, 'DV_UNKNOWN')) return true;
    const track = mainVideoTrack(probe);
    const hdr = track !== null ? track.video.hdr : probe.summary.hdr;
    if (hdr === null) return true;
    return hdr === 'sdr' && (track === null || track.video.bitDepth !== 8);
};

// The probe is authoritative for MP4 (the DV configuration is in the sample entry). In MKV it
// can miss DV (frame not read, or a malformed NAL read as "no RPU"), so the name decides when
// the probe is ambiguous (see probeIsAmbiguous).
const resolveDolbyVision = (probe, name) => {
    if (probe === null) {
        // DV only exists on HEVC here (P9 AVC and P10 AV1 are outside the C8 cases).
        const hevcOrUnknown = name.videoCodec === null || name.videoCodec === 'hevc';
        return name.dolbyVision && hevcOrUnknown ? dvFromName(name, null, 'name') : null;
    }
    const dv = probe.summary.dolbyVision;
    if (dv) {
        return { profile: dv.profileName, baseLayer: dv.baseLayer, dualTrack: probe.summary.dolbyVisionDualTrack === true, source: 'probe' };
    }
    const codec = probe.summary.videoCodec;
    if (probe.container === 'mp4' || (codec !== 'hevc' && codec !== null) || !name.dolbyVision) return null;
    if (!probeIsAmbiguous(probe)) return null;
    return dvFromName(name, probe.summary.hdr, 'name');
};

const dvMode = (profile, container, dvProfile, dualTrack) => {
    const table = profile.video.dolbyVision;
    const rules = table[container] || table[table.unknownContainer] || {};
    const major = dvProfile !== null ? String(dvProfile).split('.')[0] : null;
    const keys = [dualTrack && major !== null ? major + '-dual' : null, dvProfile, major, 'default'];
    for (const key of keys) {
        if (key !== null && rules[key]) return rules[key];
    }
    return 'base-layer';
};

const evaluateDolbyVision = (profile, container, dv, report) => {
    let mode = dvMode(profile, container, dv.profile, dv.dualTrack);
    if (dv.profile === null && COMMON_DV_PROFILES.every((candidate) => dvMode(profile, container, candidate, false) === 'dolby-vision')) {
        mode = 'dolby-vision';
    }
    const result = { profile: dv.profile, baseLayer: dv.baseLayer, dualTrack: dv.dualTrack, mode, source: dv.source };
    if (mode === 'dolby-vision') {
        report.label('dv', dv.source);
        return { output: 'dolby-vision', dolbyVision: result };
    }
    const where = container ? container.toUpperCase() : 'contêiner desconhecido (tratado como ' + profile.video.dolbyVision.unknownContainer.toUpperCase() + ')';
    const profileText = dv.profile !== null ? 'P' + dv.profile : 'de perfil desconhecido';
    if (dv.baseLayer === 'none') {
        report.warn('DV_WRONG_COLORS', dv.source, 'Dolby Vision ' + profileText + ' em ' + where + ': a C8 não ativa o DV e a imagem fica com as cores erradas (sem camada base HDR10).');
        return { output: 'wrong-colors', dolbyVision: result };
    }
    const output = BASE_LAYER_OUTPUT[dv.baseLayer];
    if (output) {
        report.label(output + '-on-tv', dv.source);
        report.warn('DV_BASE_LAYER', dv.source, 'Dolby Vision ' + profileText + ' em ' + where + ': a C8 mostra a camada base ' + output.toUpperCase() + '.');
        return { output, dolbyVision: result };
    }
    if (dv.profile === null && dvMode(profile, container, '5', false) !== 'dolby-vision') {
        report.warn('DV_WRONG_COLORS_POSSIBLE', dv.source, 'Dolby Vision ' + profileText + ' em ' + where + ': se for P5, a imagem fica com as cores erradas.');
    } else {
        report.warn('DV_BASE_LAYER_UNKNOWN', dv.source, 'Dolby Vision ' + profileText + ' em ' + where + ': a C8 não ativa o DV, e a camada base não é conhecida.');
    }
    return { output: null, dolbyVision: result };
};

const evaluateHdr = (profile, probe, name, report) => {
    const track = probe !== null ? mainVideoTrack(probe) : null;
    let format = track !== null ? track.video.hdr : null;
    let source = format !== null ? 'probe' : null;
    if (name.hdr10plus && (format === null || format === 'hdr10')) {
        source = format === null ? 'name' : 'probe+name';
        format = 'hdr10plus';
    } else if (format === null && (name.hdr10 || name.hlg)) {
        format = name.hdr10 ? 'hdr10' : 'hlg';
        source = 'name';
    }
    const output = format !== null ? profile.video.hdr[format] || null : null;
    if (output === 'hdr10' || output === 'hlg') report.label(format === output ? output : output + '-on-tv', source);
    return { format, output };
};

const evaluateVideo = (profile, probe, name, container, report) => {
    const codec = probe !== null ? probe.summary.videoCodec : name.videoCodec;
    const codecSource = probe !== null ? 'probe' : 'name';
    const status = codec !== null ? profile.video.codecs[codec] || profile.video.codecs.unknown : null;
    const video = { codec, status, format: null, output: null, dolbyVision: null };
    if (status === 'unsupported') {
        report.warn('VIDEO_UNSUPPORTED', codecSource, 'Vídeo ' + codecName(codec) + ': a C8 não decodifica este codec.');
        return video;
    }
    if (status === 'unknown') report.warn('VIDEO_UNKNOWN', codecSource, 'Vídeo ' + codecName(codec) + ': suporte desconhecido na C8.');
    const dv = resolveDolbyVision(probe, name);
    if (dv !== null) {
        const outcome = evaluateDolbyVision(profile, container, dv, report);
        video.format = 'dolby-vision';
        video.output = outcome.output;
        video.dolbyVision = outcome.dolbyVision;
        return video;
    }
    if (probe !== null && hasProbeWarning(probe, 'DV_UNKNOWN')) {
        report.warn('DV_UNVERIFIED', 'probe', 'MKV HEVC 10-bit cujo 1º quadro não foi lido: pode ser Dolby Vision (inclusive P5), e o nome do stream não diz.');
    }
    const hdr = evaluateHdr(profile, probe, name, report);
    video.format = hdr.format;
    video.output = hdr.output;
    return video;
};

// ---- Audio -------------------------------------------------------------------------------------

const audioStatus = (profile, codec, audioProfile, channels) => {
    const codecs = profile.audio.codecs;
    const entry = codecs[codec] || codecs.unknown || { status: 'unknown' };
    let status = (audioProfile && profile.audio.profiles[audioProfile]) || entry.status;
    if (status !== 'unsupported' && entry.maxChannels && channels > entry.maxChannels) status = 'unsupported';
    return status;
};

// The probe leaves atmos null when it could not read the first frame; the name can fill it in,
// but for one track only (a dub is rarely Atmos): the default one of that codec, else the first.
const nameAtmosTrack = (tracks, name) => {
    if (!name.atmos || name.atmosCodec === null) return null;
    const candidates = tracks.filter((track) => track.codec === name.atmosCodec && track.audio.atmos === null);
    return candidates.filter((track) => track.default)[0] || candidates[0] || null;
};

const atmosOf = (track, atmosByName) => {
    if (track.audio.atmos !== null) return { atmos: track.audio.atmos, source: 'probe' };
    return track === atmosByName ? { atmos: true, source: 'name' } : { atmos: null, source: null };
};

const preferenceIndex = (profile, track) => {
    const order = profile.audio.preference;
    const key = track.atmosOnTv ? track.codec + '-atmos' : track.codec;
    const index = order.indexOf(key) !== -1 ? order.indexOf(key) : order.indexOf(track.codec);
    return index !== -1 ? index : order.length;
};

// The label of a DTS initial track (F8.4): the variant the probe read. DTS:X plays as its DTS-HD MA
// part on the C8, so it gets the DTS-HD MA label; DTS-HD HRA and other DTS-HD, the DTS-HD one.
const dtsLabel = (track) => {
    if (track.codec !== 'dts' || track.status === 'unsupported') return null;
    const variant = track.profile || '';
    if (variant.indexOf('DTS-HD MA') === 0) return 'dts-hd-ma';
    return variant.indexOf('DTS-HD') === 0 ? 'dts-hd' : 'dts';
};

const byKeys = (keyOf) => (a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
};

const evaluateProbeAudio = (profile, probe, name, languages, report) => {
    const raw = probe.tracks.filter((track) => track.type === 'audio' && track.audio);
    const fallback = raw.filter((track) => track.default)[0] || raw[0] || null;
    const fallbackLanguage = fallback !== null ? normalizeLanguage(fallback.language) : null;
    const atmosByName = nameAtmosTrack(raw, name);
    const tracks = raw.map((track) => {
        const atmos = atmosOf(track, atmosByName);
        const language = normalizeLanguage(track.language);
        const preferred = language !== null ? languages.indexOf(language) : -1;
        let languageRank = languages.length + 1;
        if (preferred !== -1) languageRank = preferred;
        else if (language !== null && language === fallbackLanguage) languageRank = languages.length;
        return {
            index: track.index,
            id: track.id,
            codec: track.codec,
            profile: track.audio.profile,
            language,
            name: track.name,
            channels: track.audio.channels,
            default: track.default === true,
            atmos: atmos.atmos,
            atmosSource: atmos.source,
            atmosOnTv: atmos.atmos === true && profile.audio.atmosCodecs.indexOf(track.codec) !== -1,
            status: audioStatus(profile, track.codec, track.audio.profile, track.audio.channels),
            preferredLanguage: preferred !== -1,
            languageRank,
            secondary: track.commentary === true || track.visualImpaired === true || SECONDARY_NAME.test(track.name || ''),
        };
    });
    tracks.forEach((track) => {
        track.preference = preferenceIndex(profile, track);
    });
    // Playable first; among them the main track over commentary (an "unconfirmed" film track
    // beats an AC-3 commentary), then the codec status (ok before unconfirmed and unknown), the
    // language, the codec preference (DD+ Atmos, then DTS: F8.4), the default flag, channels, file order.
    tracks.sort(byKeys((track) => [track.status === 'unsupported' ? 1 : 0, track.secondary ? 1 : 0, AUDIO_TIERS[track.status],
        track.languageRank, track.preference, track.default ? 0 : 1, -(track.channels || 0), track.index]));
    const chosen = tracks.filter((track) => track.status !== 'unsupported')[0] || null;
    // Only a commentary plays, while the film track does not: that is no alternative (row 7).
    const onlySecondary = chosen !== null && chosen.secondary && tracks.some((track) => !track.secondary);
    // What a player without these rules would pick: the language match or the file's default.
    const natural = tracks.slice().sort(byKeys((track) => [track.languageRank, track.secondary ? 1 : 0, track.default ? 0 : 1, track.index]))[0] || null;
    if (tracks.length > 0 && chosen === null) {
        report.warn('AUDIO_UNSUPPORTED', 'probe', 'Nenhuma faixa de áudio toca na C8 (' + tracks.map(describeTrack).join(', ') + '): o vídeo ficaria mudo.');
    } else if (onlySecondary) {
        const main = tracks.filter((track) => !track.secondary);
        report.warn('AUDIO_ONLY_SECONDARY', 'probe', 'A faixa principal (' + main.map(describeTrack).join(', ') + ') não toca na C8; só sobra ' +
            describeTrack(chosen) + ', que é comentário ou audiodescrição.', chosen.id);
    }
    if (chosen !== null) {
        if (!onlySecondary && natural !== null && natural !== chosen && natural.status !== 'ok') {
            report.warn('AUDIO_TRACK_SKIPPED', 'probe', 'A faixa ' + describeTrack(natural) + ' ' + STATUS_TEXT[natural.status] + '; escolhida ' + describeTrack(chosen) + '.', natural.id);
        }
        if (chosen.status === 'unconfirmed') {
            report.warn('AUDIO_UNCONFIRMED', 'probe', 'A única opção de áudio é ' + describeTrack(chosen) + ', que ' + STATUS_TEXT.unconfirmed + '.', chosen.id);
        } else if (chosen.status === 'unknown') {
            report.warn('AUDIO_UNKNOWN', 'probe', 'A única opção de áudio é ' + describeTrack(chosen) + ', que ' + STATUS_TEXT.unknown + '.', chosen.id);
        }
        if (chosen.atmosOnTv) report.label('atmos', chosen.atmosSource === 'probe' ? 'probe' : 'probe+name');
        const dts = dtsLabel(chosen);
        if (dts !== null && profile.labels[dts]) report.label(dts, 'probe');
    }
    const status = chosen !== null ? chosen.status : (tracks.length > 0 ? 'unsupported' : null);
    return {
        status,
        initialTrack: chosen,
        tracks,
        atmos: chosen !== null ? chosen.atmosOnTv : false,
        preferredLanguage: chosen !== null && chosen.preferredLanguage && !onlySecondary,
    };
};

const evaluateNameAudio = (profile, name, report) => {
    const statuses = name.audioCodecs.map((codec) => audioStatus(profile, codec, null, null));
    let status = null;
    statuses.forEach((candidate) => {
        if (status === null || AUDIO_TIERS[candidate] < AUDIO_TIERS[status]) status = candidate;
    });
    const listed = name.audioCodecs.map(codecName).join(', ');
    if (status === 'unsupported') {
        report.warn('AUDIO_UNSUPPORTED_POSSIBLE', 'name', 'O nome do stream só cita ' + listed + ', que não toca na C8: pode não haver faixa de áudio compatível.');
    } else if (status === 'unconfirmed') {
        report.warn('AUDIO_UNCONFIRMED_POSSIBLE', 'name', 'O nome do stream só cita ' + listed + ', que ' + STATUS_TEXT.unconfirmed + '.');
    }
    const atmos = name.atmos && name.atmosCodec !== null && profile.audio.atmosCodecs.indexOf(name.atmosCodec) !== -1;
    if (atmos) report.label('atmos', 'name');
    return { status, initialTrack: null, tracks: [], atmos, preferredLanguage: false };
};

// ---- Subtitles ---------------------------------------------------------------------------------

const evaluateSubtitles = (profile, probe, report) => {
    if (probe === null) return { tracks: [], hidden: [] };
    const tracks = [];
    const hidden = [];
    probe.tracks.filter((track) => track.type === 'subtitle').forEach((track) => {
        const text = track.subtitle ? track.subtitle.text !== false : true;
        const entry = {
            index: track.index, id: track.id, codec: track.codec, language: normalizeLanguage(track.language),
            name: track.name, default: track.default === true, forced: track.forced === true, text,
        };
        if (profile.subtitles[text ? 'text' : 'bitmap'] === 'unsupported') hidden.push(entry);
        else tracks.push(entry);
    });
    if (hidden.length > 0) {
        report.warn('SUBTITLES_HIDDEN', 'probe', 'Legendas embutidas em imagem (' + hidden.map((track) => track.codec.toUpperCase() + ' ' + (track.language || 'sem idioma')).join(', ') + ') ficam ocultas: a C8 não as mostra.');
    }
    return { tracks, hidden };
};

// ---- Entry points ------------------------------------------------------------------------------

// input: { probe, stream, preferences: { audioLanguages: ['por', 'eng'] }, profile }
const evaluate = (input) => {
    const options = input || {};
    const profile = options.profile || DEFAULT_PROFILE;
    const report = createReport(profile);
    let probe = options.probe || null;
    if (probe !== null && probe.version !== PROBE_VERSION) {
        report.warn('PROBE_IGNORED', 'probe', 'Saída do probe na versão ' + probe.version + ', diferente da ' + PROBE_VERSION + ': ignorada.');
        probe = null;
    }
    const name = parseStreamName(options.stream === undefined ? null : options.stream);
    const preferences = options.preferences || {};
    const languages = (preferences.audioLanguages || []).map(normalizeLanguage).filter((code) => code !== null);
    const container = probe !== null ? probe.container : name.container;

    const video = evaluateVideo(profile, probe, name, container, report);
    const audio = probe !== null ? evaluateProbeAudio(profile, probe, name, languages, report) : evaluateNameAudio(profile, name, report);
    const subtitles = evaluateSubtitles(profile, probe, report);

    let score = 0;
    report.labels.forEach((label) => {
        score += profile.scoring.labels[label.code] || 0;
    });
    report.warnings.forEach((warning) => {
        score += warning.score;
    });
    if (audio.preferredLanguage) score += profile.scoring.preferredLanguage;
    let tier = 'ok';
    if (report.warnings.some((warning) => warning.severity === 'demote')) tier = 'demoted';
    if (report.warnings.some((warning) => warning.severity === 'hide')) tier = 'hidden';
    // Only the name, with a doubt the probe settles: audio by name, or DV in MKV/unknown container
    // (the probe can clear an explicit "DV P5" by reading a PQ base layer).
    const needsProbe = probe === null && (report.warnings.some((warning) => /_POSSIBLE$/.test(warning.code)) ||
        (video.format === 'dolby-vision' && container !== 'mp4'));

    return {
        version: VERSION,
        profileVersion: profile.version,
        sources: { probe: probe !== null, name: name.text.length > 0 },
        container,
        video,
        audio: { status: audio.status, initialTrack: audio.initialTrack, tracks: audio.tracks, atmos: audio.atmos },
        subtitles,
        playbackRates: profile.playback.rates.slice(),
        labels: report.labels,
        warnings: report.warnings,
        score,
        tier,
        needsProbe,
    };
};

// Order for the stream list (F6.2): ok before demoted before hidden, then score; 0 on a tie.
const compare = (a, b) => (TIERS[a.tier] - TIERS[b.tier]) || (b.score - a.score);

// Array#sort is not stable on Chromium 53 (V8 5.3 uses QuickSort above 10 items), so ties are
// broken by the original position: the addon's order survives among equal results.
// getResult(item) returns the evaluate() result of an item (default: the item itself).
const sortStreams = (items, getResult) => {
    const resultOf = getResult || ((item) => item);
    return items
        .map((item, index) => ({ item, index, result: resultOf(item) }))
        .sort((a, b) => compare(a.result, b.result) || (a.index - b.index))
        .map((entry) => entry.item);
};

module.exports = {
    VERSION,
    DEFAULT_PROFILE,
    evaluate,
    compare,
    sortStreams,
    mergeProfile,
    parseStreamName,
    normalizeLanguage,
};
