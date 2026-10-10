// What a stream item shows (F6.2): the rule labels ("DV", "HDR10 nesta TV", "Atmos"…, texts from
// perfil-c8.json) and a short text for each warning that demotes or hides the stream. Info
// warnings (DV_BASE_LAYER, SUBTITLES_HIDDEN…) are not shown: the label already tells the story.

const CODEC_NAMES = { truehd: 'TrueHD', dts: 'DTS', flac: 'FLAC', ac4: 'AC-4', opus: 'Opus', vorbis: 'Vorbis', av1: 'AV1' };

const codecsText = (codecs) => {
    const names = [];
    codecs.forEach((codec) => {
        const name = CODEC_NAMES[codec] || String(codec).toUpperCase();
        if (names.indexOf(name) === -1) names.push(name);
    });
    return names.join('/');
};

// Audio codecs behind an audio warning: the probe tracks when there is a probe, else the codecs
// the name cites that have the warning's status.
const audioCodecsOf = (result, nameCodecs, statuses) => {
    if (result.sources && result.sources.probe) {
        return result.audio.tracks.filter((track) => statuses.indexOf(track.status) !== -1).map((track) => track.codec);
    }
    return nameCodecs.filter((entry) => statuses.indexOf(entry.status) !== -1).map((entry) => entry.codec);
};

const withCodecs = (codecs, text, fallback) => (codecs.length > 0 ? codecsText(codecs) + ': ' + text : fallback);

const WARNING_TEXTS = {
    VIDEO_UNSUPPORTED: (result) => withCodecs(result.video.codec ? [result.video.codec] : [], 'não toca nesta TV', 'Não toca nesta TV'),
    DV_WRONG_COLORS: () => 'DV P5: cores erradas',
    DV_WRONG_COLORS_POSSIBLE: () => 'Pode ser DV P5',
    AUDIO_UNSUPPORTED: (result, name) => withCodecs(audioCodecsOf(result, name, ['unsupported']), 'sem som nesta TV', 'Sem som nesta TV'),
    AUDIO_UNSUPPORTED_POSSIBLE: (result, name) => withCodecs(audioCodecsOf(result, name, ['unsupported']), 'pode ficar sem som', 'Pode ficar sem som'),
    AUDIO_ONLY_SECONDARY: () => 'Só o comentário toca',
    AUDIO_UNCONFIRMED: () => 'DTS a confirmar',
    AUDIO_UNCONFIRMED_POSSIBLE: () => 'DTS a confirmar',
    AUDIO_UNKNOWN: (result, name) => withCodecs(audioCodecsOf(result, name, ['unknown']), 'suporte desconhecido', 'Áudio de suporte desconhecido'),
};

// result: c8-rules evaluate() output; nameCodecs: [{ codec, status }] of the codecs the stream name
// cites (only used without probe). Returns null when there is nothing to show.
const toDisplay = (result, nameCodecs) => {
    if (!result) return null;
    const codecs = nameCodecs || [];
    const labels = result.labels.map((label) => ({ code: label.code, text: label.text }));
    const warnings = [];
    result.warnings.forEach((warning) => {
        if (warning.severity === 'info') return;
        const text = WARNING_TEXTS[warning.code] ? WARNING_TEXTS[warning.code](result, codecs) : warning.message;
        if (warnings.some((shown) => shown.text === text)) return;
        warnings.push({ code: warning.code, text, severity: warning.severity, message: warning.message });
    });
    return {
        tier: result.tier,
        score: result.score,
        source: result.sources && result.sources.probe ? 'probe' : 'name',
        labels,
        warnings,
    };
};

module.exports = { WARNING_TEXTS, toDisplay };
