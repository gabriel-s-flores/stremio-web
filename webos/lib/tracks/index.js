// webOS player tracks (F5.4): the audio and embedded subtitle lists of the Player menus, built from
// the header probe (F5.2) and the video element's audioTracks, and the initial audio track picked
// by the C8 rules (F5.3). Pure functions; the video decorator and the hook call them. See README.md.

const { evaluate, normalizeLanguage } = require('../c8-rules');

// The prefix the Player and stremio-video use for tracks inside the file.
const TRACK_ID_PREFIX = 'EMBEDDED_';

const CODEC_TEXT = {
    aac: 'AAC', ac3: 'AC-3', eac3: 'E-AC-3', truehd: 'TrueHD', dts: 'DTS', flac: 'FLAC', mp3: 'MP3',
    opus: 'Opus', vorbis: 'Vorbis', pcm: 'PCM', ac4: 'AC-4',
    srt: 'SRT', ass: 'ASS', ssa: 'SSA', webvtt: 'WebVTT', tx3g: 'TX3G', ttml: 'TTML',
};
const CHANNELS_TEXT = { 1: '1.0', 2: '2.0', 3: '2.1', 6: '5.1', 7: '6.1', 8: '7.1' };
// Profiles that say more than the codec (the DTS variant, TrueHD Atmos).
const PROFILE_CODECS = ['dts', 'truehd'];

const trackId = (index) => TRACK_ID_PREFIX + index;

const trackIndex = (id) => {
    if (typeof id !== 'string' || id.indexOf(TRACK_ID_PREFIX) !== 0) return null;
    const index = parseInt(id.slice(TRACK_ID_PREFIX.length), 10);
    return isNaN(index) || index < 0 ? null : index;
};

const codecText = (codec) => (codec ? CODEC_TEXT[codec] || String(codec).toUpperCase() : null);

// "AC-3 5.1", "DD+ Atmos 5.1", "DTS-HD MA 7.1", "AAC 2.0".
const audioTechnical = (track) => {
    const audio = track.audio || {};
    let text = codecText(track.codec);
    if (track.codec === 'eac3' && audio.atmos === true) text = 'DD+ Atmos';
    else if (PROFILE_CODECS.indexOf(track.codec) !== -1 && audio.profile) text = audio.profile;
    const channels = audio.channels ? CHANNELS_TEXT[audio.channels] || audio.channels + 'ch' : null;
    return [text, channels].filter(Boolean).join(' ');
};

const simplified = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The track name and the technical description, without repeating a name that only says the
// codec ("AC3 5.1" next to "AC-3 5.1").
const joinLabel = (name, technical) => {
    if (!name) return technical;
    if (!technical || simplified(name) === simplified(technical)) return name;
    return name + ' · ' + technical;
};

// The element's AudioTrackList as plain objects ([] without the API or before the metadata).
const readElementTracks = (videoElement) => {
    const list = videoElement ? videoElement.audioTracks : null;
    const tracks = [];
    if (!list) return tracks;
    for (let i = 0; i < list.length; i++) {
        tracks.push({ language: list[i].language || '', label: list[i].label || '', enabled: list[i].enabled === true });
    }
    return tracks;
};

const enabledIndex = (elementTracks) => {
    for (let i = 0; i < elementTracks.length; i++) {
        if (elementTracks[i].enabled) return i;
    }
    return null;
};

// rules: the c8-rules evaluate() result of the same probe (statuses per probe track id).
const statusById = (rules) => {
    const statuses = {};
    if (rules && rules.audio) {
        rules.audio.tracks.forEach((track) => {
            statuses[track.id] = track.status;
        });
    }
    return statuses;
};

// The audio menu. Each entry is an upstream AudioTrack (id, lang, label, origin, embedded, mode)
// plus `index` (position in the file and in video.audioTracks), `probeId`, `codec`, `channels`
// and `status` (c8-rules). The ids follow the file order, so `EMBEDDED_<n>` is audioTracks[n].
// - probe and element agree (or the element has no tracks yet): the probe's tracks, with the
//   element's language where the file has none;
// - no probe, or a different number of tracks: the element's tracks (language and label only);
// - tracks that do not play on the C8 (TrueHD…) are left out while another one plays.
const buildAudioTracks = ({ probe, rules, elementTracks, selectedIndex }) => {
    const element = elementTracks || [];
    const probeAudio = probe ? probe.tracks.filter((track) => track.type === 'audio') : [];
    const statuses = statusById(rules);
    let tracks;
    if (probeAudio.length > 0 && (element.length === 0 || element.length === probeAudio.length)) {
        tracks = probeAudio.map((track, index) => ({
            index,
            probeId: track.id,
            lang: track.language || (element[index] ? element[index].language : '') || '',
            label: joinLabel(track.name, audioTechnical(track)),
            codec: track.codec,
            channels: track.audio ? track.audio.channels : null,
            status: statuses[track.id] || null,
        }));
    } else {
        tracks = element.map((track, index) => ({
            index,
            probeId: null,
            lang: track.language,
            label: track.label,
            codec: null,
            channels: null,
            status: null,
        }));
    }
    if (tracks.some((track) => track.status !== 'unsupported')) {
        tracks = tracks.filter((track) => track.status !== 'unsupported');
    }
    return tracks.map((track) => Object.assign({
        id: trackId(track.index),
        lang: track.lang,
        label: track.label,
        origin: 'EMBEDDED',
        embedded: true,
        mode: track.index === selectedIndex ? 'showing' : 'disabled',
    }, track));
};

// Embedded text subtitles, listed only (showing them is F5.5). `EMBEDDED_<n>` counts every
// subtitle track of the file, so n stays the file position; bitmap ones (PGS, VobSub) are hidden.
const buildSubtitleTracks = ({ probe }) => {
    if (!probe) return [];
    return probe.tracks
        .filter((track) => track.type === 'subtitle')
        .map((track, index) => ({ track, index }))
        .filter(({ track }) => !track.subtitle || track.subtitle.text !== false)
        .map(({ track, index }) => ({
            id: trackId(index),
            lang: track.language || '',
            label: joinLabel(track.name, codecText(track.codec)) + (track.forced ? ' · forced' : ''),
            origin: 'EMBEDDED',
            embedded: true,
            mode: 'disabled',
            index,
            probeId: track.id,
            codec: track.codec,
            forced: track.forced === true,
        }));
};

// The track to select on its own: with the probe, the C8 rules (a track that plays, in the first
// preferred language that has one); without it, the first preferred language found, keeping the
// selected track when it already matches. null: leave the pipeline's choice.
const chooseAudioTrack = ({ tracks, probe, stream, languages, selectedId }) => {
    const preferred = (languages || []).map(normalizeLanguage).filter((code) => code !== null);
    if (probe && tracks.some((track) => track.probeId !== null)) {
        const initial = evaluate({ probe, stream, preferences: { audioLanguages: preferred } }).audio.initialTrack;
        return initial ? tracks.filter((track) => track.probeId === initial.id)[0] || null : null;
    }
    const selected = tracks.filter((track) => track.id === selectedId)[0] || null;
    for (let i = 0; i < preferred.length; i++) {
        if (selected && normalizeLanguage(selected.lang) === preferred[i]) return selected;
        const match = tracks.filter((track) => normalizeLanguage(track.lang) === preferred[i])[0];
        if (match) return match;
    }
    return null;
};

module.exports = {
    TRACK_ID_PREFIX,
    trackId,
    trackIndex,
    readElementTracks,
    enabledIndex,
    buildAudioTracks,
    buildSubtitleTracks,
    chooseAudioTrack,
};
