// node --test webos/tools/media-suite
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveExpectations, evaluate, normalizeLanguage, parseServerLog, summarizeRequests } from './evaluate.mjs';

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
const expectAll = { events: ['loadedmetadata', 'canplay', 'playing'], duration: [9, 11], size: '1280x720', minTimeupdates: 3, audioTracks: { count: 1, languages: ['en'] }, redirect: true, rangeSeek: true };

test('evaluate aprova um resultado correto', () => {
    const checks = evaluate(scenario, expectAll, good, requests);
    assert.ok(checks.length >= 10);
    assert.deepEqual(checks.filter((c) => !c.ok), []);
});

test('evaluate reprova erro, falta de seek, progresso e faixas erradas', () => {
    const bad = { ...good, error: 4, events: ['loadedmetadata@5ms', 'canplay@9ms', 'playing@10ms'], currentTime: 5.5, audioTracks: [{ language: 'pt' }, { language: 'en' }] };
    const failed = evaluate(scenario, expectAll, bad, { ...requests, redirects: 0, rangeOffsets: [] }).filter((c) => !c.ok).map((c) => c.name);
    assert.deepEqual(failed, ['sem erro do <video>', 'evento seeked', 'progresso (currentTime)', 'quantidade de faixas de áudio', 'idiomas das faixas', 'redirect 302 seguido', 'Range com offset > 0 (seek)']);
});

test('sem seek, o progresso mínimo só é checado se declarado', () => {
    const names = evaluate({ id: 'y' }, { events: [] }, good, requests).map((c) => c.name);
    assert.ok(!names.includes('progresso (currentTime)'));
    assert.ok(!names.includes('evento seeked'));
});
