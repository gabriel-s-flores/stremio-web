// Lógica pura da bateria de mídia: expectativas derivadas do arquivo (ffprobe), avaliação do
// resultado do play-test.sh e leitura do log do media-server.mjs. Sem efeitos colaterais, para
// poder ser testada com `node --test` (evaluate.test.mjs).

// ffprobe usa ISO 639-2 ("eng", "por"); o webOS entrega 639-1 ("en", "pt") em audioTracks.
const LANG_639_1 = { eng: 'en', por: 'pt', spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ita: 'it', jpn: 'ja', und: '' };
export const normalizeLanguage = (lang) => {
    const l = String(lang || '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(LANG_639_1, l) ? LANG_639_1[l] : l.slice(0, 2);
};

// Converte a saída `ffprobe -print_format json -show_streams -show_format` em expectativas.
export function deriveExpectations(probe) {
    const streams = probe.streams || [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.filter((s) => s.codec_type === 'audio');
    const derived = {};
    const duration = Number(probe.format && probe.format.duration);
    if (duration > 0) derived.duration = [Math.floor(duration - 1), Math.ceil(duration + 1)];
    if (video) derived.size = `${video.width}x${video.height}`;
    derived.audioTracks = {
        count: audio.length,
        languages: audio.map((s) => normalizeLanguage(s.tags && s.tags.language)),
    };
    return derived;
}

// Linha do media-server: "<iso> GET /path bytes=1-2 -> 206 1-2" (o Range pode estar vazio).
export function parseServerLog(text) {
    const entries = [];
    for (const line of String(text).split('\n')) {
        const m = /^(\S+) (\S+) (\S+) (.*?) ?-> (\d+)(?: (.*))?$/.exec(line);
        if (!m) continue;
        const range = /bytes=(\d*)-(\d*)/.exec(m[4]);
        entries.push({
            time: Date.parse(m[1]),
            method: m[2],
            path: decodeURIComponent(m[3]),
            rangeStart: range && range[1] !== '' ? Number(range[1]) : null,
            status: Number(m[5]),
            extra: m[6] || '',
        });
    }
    return entries;
}

// Resumo das requisições de um arquivo: redirect seguido e Ranges com offset > 0.
export function summarizeRequests(entries, file) {
    const direct = entries.filter((e) => e.path === `/${file}`);
    const redirects = entries.filter((e) => e.path === `/redirect/${file}`);
    return {
        redirects: redirects.length,
        requests: direct.length,
        rangeRequests: direct.filter((e) => e.rangeStart !== null).length,
        rangeOffsets: direct.filter((e) => e.rangeStart > 0).map((e) => e.rangeStart),
    };
}

// Maior intervalo entre keyframes (s). `lines` vem de `ffprobe -select_streams v:0 -show_entries
// packet=pts_time,flags -of csv=p=0` ("0.000000,K__"); o último intervalo vai até `duration`.
export function maxKeyframeGap(lines, duration) {
    const keys = String(lines).split('\n')
        .map((l) => l.split(','))
        .filter((f) => f.length >= 2 && f[1].includes('K') && f[0] !== 'N/A')
        .map((f) => Number(f[0]))
        .sort((a, b) => a - b);
    if (keys.length === 0) return Infinity;
    let gap = 0;
    for (let i = 0; i < keys.length; i++) gap = Math.max(gap, (i + 1 < keys.length ? keys[i + 1] : duration) - keys[i]);
    return gap;
}

const eventName = (e) => String(e).split('@')[0];

// Devolve [{ name, ok, expected, actual }]. `expect` já inclui os valores derivados.
export function evaluate(scenario, expect, result, requests) {
    const checks = [];
    const check = (name, ok, expected, actual) => checks.push({ name, ok: Boolean(ok), expected, actual });
    const events = (result.events || []).map(eventName);

    if (expect.noError !== false) check('sem erro do <video>', !result.error, 'sem erro', result.error ? `código ${result.error}` : 'sem erro');
    for (const name of expect.events || []) check(`evento ${name}`, events.includes(name), 'ocorreu', events.includes(name) ? 'ocorreu' : 'ausente');
    if (scenario.seek !== undefined && scenario.seek !== null && scenario.seek !== '' && expect.seeked !== false) {
        check('evento seeked', events.includes('seeked'), 'ocorreu', events.includes('seeked') ? 'ocorreu' : 'ausente');
    }
    if (expect.duration) {
        const [min, max] = expect.duration;
        check('duração', result.duration >= min && result.duration <= max, `${min}–${max} s`, `${result.duration} s`);
    }
    if (expect.size) check('resolução', result.size === expect.size, expect.size, result.size);
    const minTime = expect.minCurrentTime !== undefined
        ? expect.minCurrentTime
        : (scenario.seek ? Number(scenario.seek) + 1 : undefined);
    if (minTime !== undefined) check('progresso (currentTime)', result.currentTime >= minTime, `≥ ${minTime} s`, `${Number(result.currentTime).toFixed(2)} s`);
    if (expect.minTimeupdates !== undefined) check('timeupdate', result.timeupdates >= expect.minTimeupdates, `≥ ${expect.minTimeupdates}`, result.timeupdates);
    if (expect.audioTracks) {
        const tracks = result.audioTracks || [];
        if (expect.audioTracks.count !== undefined) check('quantidade de faixas de áudio', tracks.length === expect.audioTracks.count, expect.audioTracks.count, tracks.length);
        if (expect.audioTracks.languages) {
            const got = tracks.map((t) => normalizeLanguage(t.language));
            const want = expect.audioTracks.languages;
            check('idiomas das faixas', JSON.stringify(got) === JSON.stringify(want), want.join(',') || '(sem idioma)', got.join(',') || '(sem idioma)');
        }
    }
    if (expect.redirect) check('redirect 302 seguido', requests.redirects > 0 && requests.requests > 0, '302 e depois o arquivo', `${requests.redirects} redirect(s), ${requests.requests} requisição(ões) ao arquivo`);
    // Só mostra que o pipeline leu o arquivo a partir de um offset: em MKV o índice Cues também gera
    // isso sem seek. A prova do seek é 'evento seeked' + 'progresso (currentTime)'.
    if (expect.rangeOffset) check('Range com offset > 0', requests.rangeOffsets.length > 0, '≥ 1', requests.rangeOffsets.length);
    return checks;
}
