#!/usr/bin/env node
// Evaluates the output of webos/tests/player/tracks.sh (F5.4, embedded subtitles as of F5.5) and
// exits non-zero on failure.
//   node tracks-evaluate.mjs <output-dir> <switch-to> [subtitles-to]
// The expected initial audio track and the embedded subtitles (id, Luna index) are computed by the
// same libraries (probe of the local file + C8 rules) with the languages of the app settings.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const { probe } = require(path.join(ROOT, 'webos', 'lib', 'header-probe'));
const { bufferReadRange } = require(path.join(ROOT, 'webos', 'lib', 'header-probe', 'test', 'replay'));
const { evaluate } = require(path.join(ROOT, 'webos', 'lib', 'c8-rules'));
const { buildAudioTracks, buildSubtitleTracks, chooseAudioTrack, trackIndex } = require(path.join(ROOT, 'webos', 'lib', 'tracks'));

const [dir, switchTo, subtitlesTo = 'por'] = process.argv.slice(2);
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
const readJson = (file, fallback) => {
    try {
        return JSON.parse(read(file));
    } catch (_e) {
        return fallback;
    }
};
const samples = read('samples.jsonl').trim().split('\n').map((line) => JSON.parse(line));
const phase = (name) => samples.filter((s) => s.phase === name && s.sample && s.sample.video).map((s) => s.sample);
const last = (list) => list[list.length - 1];
const enabledIndexes = (sample) => sample.audioTracks.map((track, i) => (track.enabled ? i : -1)).filter((i) => i !== -1);
const ffprobe = readJson('ffprobe.json', { streams: [] });
const audioStreams = ffprobe.streams.filter((stream) => stream.codec_type === 'audio');
const settings = readJson('settings.json', {});
const luna = readJson('luna.json', { luna: [], errors: [] });
const consoleLog = readJson('console.json', []);
const requests = readJson('requests.json', []);
const serverLog = read('media-server.log');

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

// Expected initial track: the libraries over the file the emulator played.
const file = /GET \/redirect\/(\S+)/.exec(serverLog);
const mediaDir = process.env.MEDIA_DIR || path.join(process.env.HOME, 'webos-tv-sdk', 'media-tests', 'suite');
const fileProbe = await probe(bufferReadRange(new Uint8Array(fs.readFileSync(path.join(mediaDir, file ? file[1] : 't2_multi.mkv')))));
const audioLanguage = settings.audioLanguage || 'eng';
const expectedTracks = buildAudioTracks({ probe: fileProbe, rules: evaluate({ probe: fileProbe }), elementTracks: [], selectedIndex: null });
const expectedInitial = chooseAudioTrack({ tracks: expectedTracks, probe: fileProbe, stream: null, languages: [audioLanguage] });
// Embedded subtitles: the Player's own choice is the first listed one (complete before forced) in
// the subtitles language of the settings; the manual one is the first in <subtitles-to>.
const subtitlesLanguage = settings.subtitlesLanguage || 'eng';
const expectedSubtitles = buildSubtitleTracks({ probe: fileProbe, selectedId: null });
const autoSubtitles = expectedSubtitles.filter((track) => track.lang === subtitlesLanguage)[0] || null;
const chosenSubtitles = expectedSubtitles.filter((track) => track.lang === subtitlesTo)[0] || null;

const startup = readJson('startup.json', {});
check('playback starts', startup.secondsToPlayback !== null && startup.secondsToPlayback !== undefined, startup);

const menuInitial = phase('menu-initial');
const menu = menuInitial.length ? last(menuInitial).menu : [];
check('the audio menu lists every audio track of the file, in file order', menu.length === audioStreams.length &&
    menu.every((entry, i) => entry.id === 'EMBEDDED_' + i), menu);
check('each entry has the language and the file track title', menu.length === audioStreams.length && menu.every((entry, i) => {
    const tags = audioStreams[i].tags || {};
    return entry.lang && entry.lang.length > 0 && (!tags.title || (entry.label || '').indexOf(tags.title) !== -1);
}), { menu: menu.map((entry) => [entry.lang, entry.label]), file: audioStreams.map((s) => s.tags) });

const initial = phase('initial');
const expectedIndex = expectedInitial ? trackIndex(expectedInitial.id) : null;
check('initial track = C8 rules with the language setting (' + audioLanguage + ')', initial.length > 0 &&
    JSON.stringify(enabledIndexes(last(initial))) === JSON.stringify([expectedIndex]) &&
    menu.filter((entry) => entry.selected).map((entry) => entry.id).join() === (expectedInitial ? expectedInitial.id : ''),
{ expected: expectedInitial && expectedInitial.id, enabled: initial.map(enabledIndexes), selectedInMenu: menu.filter((e) => e.selected).map((e) => e.id) });

const switched = phase('switched');
const switchIndex = trackIndex(switchTo);
check('after the menu choice only the chosen track is enabled (audioTracks[i].enabled)', switched.length > 0 &&
    switched.slice(1).every((s) => JSON.stringify(enabledIndexes(s)) === JSON.stringify([switchIndex])), switched.map(enabledIndexes));
const menuSwitched = phase('menu-switched');
check('the menu shows the chosen track as selected', menuSwitched.length > 0 &&
    last(menuSwitched).menu.filter((entry) => entry.selected).map((entry) => entry.id).join() === switchTo, menuSwitched.length ? last(menuSwitched).menu : null);
const times = switched.map((s) => s.video.currentTime);
check('the video keeps playing after the switch (time advances, no error)', switched.length >= 2 &&
    times[times.length - 1] > times[0] && switched.every((s) => s.video.error === null), { times, ended: switched.map((s) => s.video.ended) });

const subtitlesMenu = readJson('subtitles-menu.json', []);
const subtitleLanguages = ffprobe.streams.filter((stream) => stream.codec_type === 'subtitle').map((stream) => (stream.tags || {}).language);
check('the embedded subtitles are listed by language in the subtitles menu', subtitleLanguages.every((lang) => subtitlesMenu.some((entry) => entry.lang === lang)),
    { menu: subtitlesMenu, file: subtitleLanguages });
check('the probe read the header by Range (media server log)', /bytes=0-262143/.test(serverLog), null);
const probeLine = new RegExp(`\\[webos\\] tracks: probe mkv, ${audioStreams.length} audio, ${ffprobe.streams.filter((stream) => stream.codec_type === 'subtitle').length} subtitles`);
check('the probe result was used (console)', consoleLog.some((entry) => probeLine.test(entry.text)),
    consoleLog.filter((entry) => /\[webos\] tracks/.test(entry.text)).map((entry) => entry.text));
check('no request to the streaming server /tracks', !requests.some((url) => /11470/.test(url)) &&
    !consoleLog.some((entry) => /11470/.test(entry.text)), requests);
const mediaSubscribe = luna.luna.filter((c) => /com\.webos\.media/.test(c.uri) && (c.method === 'subscribe' || c.subscribe));
check('the app never subscribes to com.webos.media', mediaSubscribe.length === 0, mediaSubscribe);
// Luna selectTrack of type "text" is WebOsVideo's own subtitle path (an embedded subtitle chosen by
// the Player, F5.5); the audio switch is done on the element only.
check('the audio switch did not use Luna selectTrack', !luna.luna.some((c) => c.method === 'selectTrack' && (c.parameters || {}).type === 'audio'),
    luna.luna.map((c) => c.uri + '/' + c.method + (c.method === 'selectTrack' ? ' ' + JSON.stringify(c.parameters) : '')));
// Embedded subtitles (F5.5): turned on through Luna (setSubtitleEnable true + selectTrack text with
// the index among the text tracks), first by the Player (subtitles language of the settings), then by
// the menu choice; the menu shows each choice.
const textSelects = luna.luna.filter((c) => c.method === 'selectTrack' && (c.parameters || {}).type === 'text');
const enables = luna.luna.filter((c) => c.method === 'setSubtitleEnable').map((c) => (c.parameters || {}).enable);
const selectedLanguage = (entries) => entries.filter((entry) => entry.selected).map((entry) => entry.lang).join();
const throughLuna = (track) => track && consoleLog.some((entry) => entry.text.indexOf('[webos] subtitles: embedded ' + track.id + ' (' + track.lang + ', ' + track.codec + ') through Luna, index ' + track.lunaIndex) !== -1);
const subtitlesConsole = consoleLog.filter((entry) => /\[webos\] subtitles/.test(entry.text)).map((entry) => entry.text);
const subtitlesMenuAfter = readJson('subtitles-menu-after-choice.json', []);
check('the Player turned on the embedded subtitles in the settings language (' + subtitlesLanguage + ') by itself: the menu shows it selected',
    autoSubtitles && selectedLanguage(subtitlesMenu) === subtitlesLanguage, { expected: autoSubtitles && autoSubtitles.id, menu: subtitlesMenu });
check('Luna: subtitles turned on (setSubtitleEnable true)', enables.includes(true), enables);
check('Luna: the automatic choice = selectTrack text index ' + (autoSubtitles && autoSubtitles.lunaIndex), autoSubtitles && textSelects.length > 0 &&
    textSelects[0].parameters.index === autoSubtitles.lunaIndex, textSelects.map((c) => c.parameters));
check('console: the automatic choice through Luna (' + (autoSubtitles && autoSubtitles.id) + ')', throughLuna(autoSubtitles), subtitlesConsole);
check('the menu shows the subtitles chosen by hand (' + subtitlesTo + ') as selected', chosenSubtitles && selectedLanguage(subtitlesMenuAfter) === subtitlesTo,
    { expected: chosenSubtitles && chosenSubtitles.id, menu: subtitlesMenuAfter });
check('Luna: the manual choice = selectTrack text index ' + (chosenSubtitles && chosenSubtitles.lunaIndex) + ', subtitles still on', chosenSubtitles &&
    textSelects.length > 1 && textSelects[textSelects.length - 1].parameters.index === chosenSubtitles.lunaIndex && enables[enables.length - 1] === true,
{ selects: textSelects.map((c) => c.parameters), enables });
check('console: the manual choice through Luna (' + (chosenSubtitles && chosenSubtitles.id) + ')', throughLuna(chosenSubtitles), subtitlesConsole);
check('no page errors', luna.errors.length === 0, luna.errors);

const ok = checks.every((c) => c.ok);
// A page killed for memory (dmesg) makes a failed run inconclusive (emulator), as in switches-evaluate.mjs.
let systemLog = '';
try {
    systemLog = read('system.log');
} catch (_e) {
    // Older runs have no system.log.
}
const oom = systemLog.split('\n').filter((line) => /out of memory|killed process|oom-killer|oom_reaper/i.test(line));
const verdict = ok ? 'pass' : oom.length > 0 ? 'inconclusive (emulator)' : 'fail';
console.log(JSON.stringify({ ok, verdict, passed: checks.filter((c) => c.ok).length, total: checks.length, oom, checks }, null, 2));
process.exit(ok ? 0 : 1);
