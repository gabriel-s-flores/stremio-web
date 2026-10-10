#!/usr/bin/env node
// Checks the output of webos/tests/streams/emulator.sh (F6.2): the list the app showed against
// the C8 ranking computed here with the same library, the same streams and the same probes (the
// files the media server log says were read, probed again from disk), plus the probe budget.
//   node webos/tests/streams/evaluate.mjs <output-dir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rules = require('../../lib/c8-rules');
const ranking = require('../../lib/stream-ranking');
const { STREAMS, fileNameOf } = require('../addon/catalog.js');
const { setup } = require('./helpers.js');

const OUT = path.resolve(process.argv[2] || '.');
const read = (file) => JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));
const idOfFile = (file) => (STREAMS.filter((entry) => fileNameOf(entry) === file)[0] || { id: `?${file}` }).id;
const ids = (list) => list.map((item) => idOfFile(item.file));

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

const timeline = read('timeline.json');
const afterProbes = read('lista-apos-probes.json');
const afterFocus = read('lista-apos-foco.json');
const settings = read('settings.json');
const consoleData = read('console.json');
const mediaLog = fs.readFileSync(path.join(OUT, 'media-server.log.txt'), 'utf8');

// Files the app read (Range GETs after the debrid-like redirect), in order of first read.
const reads = [];
const requests = {};
mediaLog.split('\n').forEach((line) => {
    const match = /\sGET \/((?:kit|headers|fixtures)\/\S+) (bytes=\S+) -> 206/.exec(line);
    if (match) {
        if (reads.indexOf(match[1]) === -1) reads.push(match[1]);
        requests[match[1]] = (requests[match[1]] || 0) + 1;
    }
});
const probedIds = reads.map((media) => (STREAMS.filter((entry) => entry.media === media)[0] || { id: `?${media}` }).id);

const media = setup();
const preferences = ranking.preferencesOf(settings);
const probes = new Map();
for (const stream of media.streams) {
    const entry = STREAMS.filter((candidate) => candidate.description === stream.description)[0];
    if (probedIds.indexOf(entry.id) !== -1) {
        probes.set(stream.url, await media.probeUrl(stream.url));
    }
}
const ranker = ranking.createRanker({ rules });
const idOfStream = (stream) => STREAMS.filter((entry) => entry.description === stream.description)[0].id;
const nameOrder = ranker.rank(media.streams, { preferences }).map((entry) => idOfStream(entry.stream));
const probedOrder = ranker.rank(media.streams, { preferences, probeOf: (stream) => probes.get(stream.url) || null }).map((entry) => idOfStream(entry.stream));
media.cleanup();

const first = timeline.filter((sample) => sample.list.length > 0)[0];
check('a lista abre ordenada só pelos nomes (1ª amostra, todos com source=name)',
    first && first.list.every((item) => item.source === 'name') && JSON.stringify(ids(first.list)) === JSON.stringify(nameOrder),
    { t: first && first.t, shown: first && ids(first.list), expected: nameOrder });
check('o torrent (infoHash) não aparece (F6.1)', ids(afterProbes).indexOf('torrent') === -1, ids(afterProbes));
check('o 1º probe só começa depois da lista na tela', (() => {
    const firstProbed = timeline.filter((sample) => sample.list.some((item) => item.source === 'probe'))[0];
    return first && firstProbed && firstProbed.t > first.t;
})(), timeline.map((sample) => ({ t: sample.t, probed: sample.list.filter((item) => item.source === 'probe').length })));
const expectedProbes = ranking.pickProbeTargets(ranker.rank(media.streams, { preferences }), ranking.LIST_SETTINGS.initialProbes).map(idOfStream);
check('probes automáticos: os 4 primeiros da lista (sem o não-cacheado), e só quem entrou no topo depois',
    JSON.stringify(probedIds.slice(0, 4)) === JSON.stringify(expectedProbes) && probedIds.length <= ranking.LIST_SETTINGS.maxAutoProbes + 1,
    { probed: probedIds, expectedFirst: expectedProbes });
check('o stream não cacheado ([RD download]) nunca é lido', probedIds.indexOf('uncached-hdr10') === -1, probedIds);
check('cada arquivo é lido por no máximo 3 pedidos Range', Object.keys(requests).every((file) => requests[file] <= 3), requests);
check('depois dos probes, a ordem na tela é a da biblioteca com os mesmos probes',
    JSON.stringify(ids(afterProbes)) === JSON.stringify(ranker.rank(media.streams, {
        preferences,
        probeOf: (stream) => (probedIds.indexOf(idOfStream(stream)) !== -1 && idOfStream(stream) !== 'web-unnamed-atmos' ? probes.get(stream.url) : null),
    }).map((entry) => idOfStream(entry.stream))),
    { shown: ids(afterProbes) });
const byId = (list, id) => list.filter((item) => idOfFile(item.file) === id)[0];
check('rótulos: DV no MP4, HDR10 nesta TV + Atmos, DV P5/TrueHD/DTS/AV1 avisados',
    byId(afterProbes, 'web-dv-p81-mp4').labels.join() === 'DV' &&
    byId(afterProbes, 'web-dv-hdr10-atmos-mkv').labels.join() === 'HDR10 nesta TV,Atmos' &&
    byId(afterProbes, 'remux-dv-p5-truehd').labels.join() === 'DV P5: cores erradas,TrueHD: pode ficar sem som' &&
    byId(afterProbes, 'remux-unnamed').labels.join() === 'DV P5: cores erradas,TrueHD: sem som nesta TV' &&
    byId(afterProbes, 'dts-hd-ma').labels.join() === 'DTS a confirmar' &&
    byId(afterProbes, 'web-av1').labels.join() === 'AV1: não toca nesta TV' && byId(afterProbes, 'web-av1').tier === 'hidden',
    afterProbes.map((item) => ({ id: idOfFile(item.file), tier: item.tier, source: item.source, labels: item.labels })));
const focused = afterFocus.filter((item) => item.focused)[0];
check('foco pelo controle: o item parado ganha o probe (Atmos) e a ordem não muda',
    focused && idOfFile(focused.file) === 'web-unnamed-atmos' && focused.labels.join() === 'Atmos' && focused.source === 'probe' &&
    JSON.stringify(ids(afterFocus)) === JSON.stringify(ids(afterProbes)),
    { focused, before: ids(afterProbes), after: ids(afterFocus) });
check('sem o foco/ordem congelada, o Atmos subiria o item (prova de que a ordem foi mantida)',
    probedOrder.indexOf('web-unnamed-atmos') < ids(afterFocus).indexOf('web-unnamed-atmos'),
    { unfrozen: probedOrder.indexOf('web-unnamed-atmos'), shown: ids(afterFocus).indexOf('web-unnamed-atmos') });
const errors = consoleData.errors.concat(consoleData.console.filter((entry) => entry.level === 'error'));
check('sem erros de página no console', errors.length === 0, errors.slice(0, 10));

const ok = checks.every((entry) => entry.ok);
process.stdout.write(`${JSON.stringify({ ok, settings, nameOrder, probedOrder, probedIds, checks }, null, 2)}\n`);
process.exit(ok ? 0 : 1);
