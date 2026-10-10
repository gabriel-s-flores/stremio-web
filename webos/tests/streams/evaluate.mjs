#!/usr/bin/env node
// Checks the output of webos/tests/streams/emulator.sh (F6.2): the list the app showed against
// the C8 ranking computed here with the same library, the same streams and the same probes (the
// files the media server log says were read, probed again from disk), plus the probe budget.
// MODE sem-toque: the probes reorder the untouched list, then the remote enters it; MODE entrada:
// the remote entered the list before the probes landed, and nothing may move under the focus.
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
// Only the test addon items: the guest profile has other addons that may answer too (e.g. links to
// streaming services, with no file name), which the list mixes in on the "all addons" view.
const isTestItem = (item) => STREAMS.some((entry) => fileNameOf(entry) === item.file);
const ids = (list) => list.filter(isTestItem).map((item) => idOfFile(item.file));

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

const MODE = fs.readFileSync(path.join(OUT, 'modo.txt'), 'utf8').trim();
const timeline = read('timeline.json');
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
// The log lines name the media server request (through the latency proxy too).

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
const lastList = timeline[timeline.length - 1].list;
check('o torrent (infoHash) não aparece (F6.1)', ids(lastList).indexOf('torrent') === -1, ids(lastList));
check('o 1º probe só começa depois da lista na tela', (() => {
    const firstProbed = timeline.filter((sample) => sample.list.some((item) => item.source === 'probe'))[0];
    return first && firstProbed && firstProbed.t > first.t;
})(), timeline.map((sample) => ({ t: sample.t, probed: sample.list.filter((item) => item.source === 'probe').length })));
check('cada arquivo é lido por no máximo 3 pedidos Range', Object.keys(requests).every((file) => requests[file] <= 3), requests);
check('o stream não cacheado ([RD download]) nunca é lido', probedIds.indexOf('uncached-hdr10') === -1, probedIds);
const byId = (list, id) => list.filter((item) => idOfFile(item.file) === id)[0];
const files = (list) => list.map((item) => item.file);

if (MODE === 'entrada') {
    const before = read('lista-entrada-antes.json');
    const entered = read('lista-entrada.json');
    const samples = fs.readFileSync(path.join(OUT, 'amostras.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const finalList = read('lista-final.json');
    const focusedAt = (list) => list.map((item, index) => (item.focused ? `${index} ${item.file}` : null)).filter(Boolean);
    check('a 1ª tecla (DOWN a partir da página) leva o foco a um item da lista, antes de os probes chegarem',
        focusedAt(entered).length === 1 && entered.every((item) => item.source !== 'probe') && before.every((item) => !item.focused),
        { entered: focusedAt(entered), sources: entered.map((item) => item.source) });
    check('parado no item, o stream focado não muda enquanto os probes chegam (achado 1 da revisão c1)',
        samples.every((sample) => JSON.stringify(focusedAt(sample.list)) === JSON.stringify(focusedAt(entered))),
        samples.map((sample) => ({ t: sample.t, focused: focusedAt(sample.list) })));
    // Streams of an addon that answers later may only come after the ones on screen.
    const keepsOrder = (list) => JSON.stringify(files(list).slice(0, entered.length)) === JSON.stringify(files(entered));
    check('a ordem na tela fica igual à da entrada (o que chega depois só entra no fim)',
        samples.every((sample) => keepsOrder(sample.list)) &&
        timeline.filter((entry) => entry.list.some((item) => item.focused)).every((entry) => keepsOrder(entry.list)),
        { entered: files(entered), final: files(finalList) });
    check('os probes chegaram com o foco parado (rótulos atualizados no lugar)',
        byId(finalList, 'remux-unnamed').source === 'probe' && byId(finalList, 'remux-unnamed').labels.join() === 'DV P5: cores erradas,TrueHD: sem som nesta TV',
        finalList.map((item) => ({ id: idOfFile(item.file), source: item.source, labels: item.labels })));
    check('sem o congelamento, esses probes teriam reordenado a lista (o caso não é vazio)',
        JSON.stringify(probedOrder) !== JSON.stringify(ids(entered)),
        { unfrozen: probedOrder, shown: ids(finalList) });
} else {
    const afterProbes = read('lista-apos-probes.json');
    const afterFocus = read('lista-apos-foco.json');
    const entered = read('entrada.json');
    const expectedProbes = ranking.pickProbeTargets(ranker.rank(media.streams, { preferences }), ranking.LIST_SETTINGS.initialProbes).map(idOfStream);
    check('probes automáticos: os 4 primeiros da lista (sem o não-cacheado), e só quem entrou no topo depois',
        JSON.stringify(probedIds.slice(0, 4)) === JSON.stringify(expectedProbes) && probedIds.length <= ranking.LIST_SETTINGS.maxAutoProbes + 1,
        { probed: probedIds, expectedFirst: expectedProbes });
    check('depois dos probes, a ordem na tela é a da biblioteca com os mesmos probes',
        JSON.stringify(ids(afterProbes)) === JSON.stringify(ranker.rank(media.streams, {
            preferences,
            // The streams that had their probe at that moment (the walk with the remote reads more later).
            probeOf: (stream) => (afterProbes.some((item) => isTestItem(item) && item.source === 'probe' && idOfFile(item.file) === idOfStream(stream)) ? probes.get(stream.url) : null),
        }).map((entry) => idOfStream(entry.stream))),
        { shown: ids(afterProbes) });
    const others = afterProbes.filter((item) => !isTestItem(item));
    check('itens de outros addons (sem sinais para as regras) ficam neutros: tier ok, nota 0, sem rótulos',
        others.every((item) => item.tier === 'ok' && item.score === '0' && item.labels.length === 0),
        others.map((item) => ({ file: item.file, name: item.name, tier: item.tier, score: item.score })));
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
        JSON.stringify(afterFocus.map((item) => item.file)) === JSON.stringify(afterProbes.map((item) => item.file)),
        { focused, before: ids(afterProbes), after: ids(afterFocus) });
    check('sem o foco/ordem congelada, o Atmos subiria o item (prova de que a ordem foi mantida)',
        probedOrder.indexOf('web-unnamed-atmos') < ids(afterFocus).indexOf('web-unnamed-atmos'),
        { unfrozen: probedOrder.indexOf('web-unnamed-atmos'), shown: ids(afterFocus).indexOf('web-unnamed-atmos') });

    check('o controle entra na lista a partir da página (DOWN no body) no 1º item',
        entered.length === 1 && entered[0] === `0 ${afterProbes[0].file}`, entered);
    check('depois de entrar, a ordem não muda mais (nem com o probe do foco)',
        timeline.filter((entry) => entry.list.some((item) => item.focused)).every((entry) => JSON.stringify(files(entry.list)) === JSON.stringify(files(afterProbes))),
        { afterProbes: files(afterProbes) });
}
const errors = consoleData.errors.concat(consoleData.console.filter((entry) => entry.level === 'error'));
check('sem erros de página no console', errors.length === 0, errors.slice(0, 10));

const ok = checks.every((entry) => entry.ok);
process.stdout.write(`${JSON.stringify({ ok, settings, nameOrder, probedOrder, probedIds, checks }, null, 2)}\n`);
process.exit(ok ? 0 : 1);
