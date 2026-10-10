// node --test webos/tools/media-suite
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveExpectations, evaluate, maxKeyframeGap, normalizeLanguage, parseServerLog, summarizeRequests } from './evaluate.mjs';

test('normalizeLanguage converte ISO 639-2 para 639-1', () => {
    assert.equal(normalizeLanguage('eng'), 'en');
    assert.equal(normalizeLanguage('por'), 'pt');
    assert.equal(normalizeLanguage('und'), '');
    assert.equal(normalizeLanguage(undefined), '');
    assert.equal(normalizeLanguage('pt'), 'pt');
});

test('deriveExpectations lê duração, resolução e faixas do ffprobe', () => {
    const d = deriveExpectations({
        format: { duration: '20.04' },
        streams: [
            { codec_type: 'video', width: 1280, height: 720 },
            { codec_type: 'audio', tags: { language: 'eng' } },
            { codec_type: 'audio', tags: { language: 'por' } },
            { codec_type: 'subtitle' },
        ],
    });
    assert.deepEqual(d, { duration: [19, 22], size: '1280x720', audioTracks: { count: 2, languages: ['en', 'pt'] } });
});

const LOG = [
    '2026-10-09T20:00:00.000Z GET /redirect/a.mkv  -> 302 /a.mkv',
    '2026-10-09T20:00:00.100Z GET /a.mkv bytes=0- -> 206 0-99',
    '2026-10-09T20:00:01.000Z GET /a.mkv bytes=4347303- -> 206 4347303-9999999',
    '2026-10-09T20:00:01.500Z GET /b.mkv  -> 200 ',
    'linha inválida',
].join('\n');

test('parseServerLog e summarizeRequests', () => {
    const entries = parseServerLog(LOG);
    assert.equal(entries.length, 4);
    assert.deepEqual(summarizeRequests(entries, 'a.mkv'), { redirects: 1, requests: 2, rangeRequests: 2, rangeOffsets: [4347303] });
    assert.deepEqual(summarizeRequests(entries, 'b.mkv'), { redirects: 0, requests: 1, rangeRequests: 0, rangeOffsets: [] });
});

const scenario = { id: 'x', seek: 5 };
const good = {
    events: ['loadstart@1ms', 'loadedmetadata@5ms', 'canplay@9ms', 'playing@10ms', 'seeking@4000ms', 'seeked@4100ms'],
    duration: 10, size: '1280x720', currentTime: 8.2, timeupdates: 20, error: null,
    audioTracks: [{ language: 'en' }],
};
const requests = { redirects: 1, requests: 3, rangeRequests: 3, rangeOffsets: [5000] };
const expectAll = { events: ['loadedmetadata', 'canplay', 'playing'], duration: [9, 11], size: '1280x720', minTimeupdates: 3, audioTracks: { count: 1, languages: ['en'] }, redirect: true, rangeOffset: true };

test('evaluate aprova um resultado correto', () => {
    const checks = evaluate(scenario, expectAll, good, requests);
    assert.ok(checks.length >= 10);
    assert.deepEqual(checks.filter((c) => !c.ok), []);
});

test('evaluate reprova erro, falta de seek, progresso e faixas erradas', () => {
    const bad = { ...good, error: 4, events: ['loadedmetadata@5ms', 'canplay@9ms', 'playing@10ms'], currentTime: 5.5, audioTracks: [{ language: 'pt' }, { language: 'en' }] };
    const failed = evaluate(scenario, expectAll, bad, { ...requests, redirects: 0, rangeOffsets: [] }).filter((c) => !c.ok).map((c) => c.name);
    assert.deepEqual(failed, ['sem erro do <video>', 'evento seeked', 'progresso (currentTime)', 'quantidade de faixas de áudio', 'idiomas das faixas', 'redirect 302 seguido', 'Range com offset > 0']);
});

test('sem seek, o progresso mínimo só é checado se declarado', () => {
    const names = evaluate({ id: 'y' }, { events: [] }, good, requests).map((c) => c.name);
    assert.ok(!names.includes('progresso (currentTime)'));
    assert.ok(!names.includes('evento seeked'));
});

const failedNames = (result, req = requests) => evaluate(scenario, expectAll, result, req).filter((c) => !c.ok).map((c) => c.name);

test('evaluate reprova eventos ausentes, resolução e timeupdate insuficientes', () => {
    assert.deepEqual(failedNames({ ...good, events: ['seeked@1ms'] }), ['evento loadedmetadata', 'evento canplay', 'evento playing']);
    assert.deepEqual(failedNames({ ...good, size: '640x360' }), ['resolução']);
    assert.deepEqual(failedNames({ ...good, timeupdates: 2 }), ['timeupdate']);
});

test('evaluate reprova duração fora do intervalo nos dois limites', () => {
    assert.deepEqual(failedNames({ ...good, duration: 30 }), ['duração']);
    assert.deepEqual(failedNames({ ...good, duration: 11.01 }), ['duração']);
    assert.deepEqual(failedNames({ ...good, duration: 8.99 }), ['duração']);
    assert.deepEqual(failedNames({ ...good, duration: 11 }), []);
    assert.deepEqual(failedNames({ ...good, duration: 9 }), []);
});

test('evaluate reprova redirect sem a requisição ao arquivo depois do 302', () => {
    assert.deepEqual(failedNames(good, { ...requests, redirects: 1, requests: 0 }), ['redirect 302 seguido']);
    assert.deepEqual(failedNames(good, { ...requests, redirects: 0, requests: 3 }), ['redirect 302 seguido']);
});

test('maxKeyframeGap mede o maior intervalo entre keyframes, inclusive até o fim', () => {
    const one = '0.000000,K__\n0.041667,___\n0.083333,___';
    assert.equal(maxKeyframeGap(one, 10), 10);
    const dense = Array.from({ length: 10 }, (_, i) => `${i}.000000,K__\n${i + 0.5},___`).join('\n');
    assert.equal(maxKeyframeGap(dense, 10), 1);
    assert.equal(maxKeyframeGap('0.0,K__\n10.42,K__', 20), 10.42);
    assert.equal(maxKeyframeGap('', 10), Infinity);
});
