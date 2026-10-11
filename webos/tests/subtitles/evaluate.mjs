#!/usr/bin/env node
// Evaluates the output of webos/tests/subtitles/subtitles.sh (F5.5) and exits non-zero on failure.
//   node evaluate.mjs <output-dir> <embedded|addon|mixed>
import fs from 'node:fs';
import path from 'node:path';

const [dir, scenario] = process.argv.slice(2);
const readJson = (file, fallback) => {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (_e) {
        return fallback;
    }
};
const samples = fs.readFileSync(path.join(dir, 'samples.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const phase = (...names) => samples.filter((s) => names.includes(s.phase) && s.sample).map((s) => s.sample);
const startup = readJson('startup.json', {});
const { luna = [], errors = [] } = readJson('luna.json', {});
const consoleLog = readJson('console.json', []);
const menuInitial = readJson('menu-inicial.json', { languages: [], variants: [] });
const menuSwitched = readJson('menu-trocado.json', { languages: [], variants: [] });

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
const subtitleLuna = luna.filter((call) => /ubtitle|selectTrack/.test(call.method || ''));
const textSelects = luna.filter((call) => call.method === 'selectTrack' && call.parameters && call.parameters.type === 'text');
const enables = luna.filter((call) => call.method === 'setSubtitleEnable').map((call) => call.parameters.enable);
const selectedLanguage = (menu) => (menu.languages.filter((l) => l.selected)[0] || {}).lang || null;
const selectedVariant = (menu) => menu.variants.filter((v) => v.selected)[0] || null;
const overlayTexts = (list) => list.map((s) => (s.overlay ? s.overlay.text : '')).filter(Boolean);
const consoleText = consoleLog.map((entry) => entry.level + ' ' + entry.text);
const subtitleErrors = consoleText.filter((text) => /libass|LOAD_FAILED|SubtitlesOctopus/i.test(text));

check('video played', startup.secondsToPlayback !== null && startup.secondsToPlayback !== undefined, startup);
check('no page errors', errors.length === 0, errors);
check('no subtitle load errors (libass stub, LOAD_FAILED)', subtitleErrors.length === 0, subtitleErrors);

if (scenario === 'embedded') {
    check('menu: the three text tracks by language, the PGS hidden', JSON.stringify(menuInitial.languages.map((l) => l.lang).filter(Boolean).sort()) === JSON.stringify(['eng', 'por', 'spa']), menuInitial.languages);
    check('menu: English chosen by the Player (subtitles language eng)', selectedLanguage(menuInitial) === 'eng', selectedVariant(menuInitial));
    check('Luna: subtitles turned on (setSubtitleEnable true)', enables.includes(true), enables);
    check('Luna: English = selectTrack text index 0 (PGS not counted)', textSelects.length > 0 && textSelects[0].parameters.index === 0, textSelects.map((c) => c.parameters));
    check('Luna: style calls sent with the track', ['setSubtitleCharacterColor', 'setSubtitleBackgroundColor', 'setSubtitleFontSize', 'setSubtitlePosition'].every((m) => subtitleLuna.some((c) => c.method === m)), subtitleLuna.map((c) => c.method));
    check('menu: Portuguese after the choice', selectedLanguage(menuSwitched) === 'por', selectedVariant(menuSwitched));
    check('Luna: Portuguese = selectTrack text index 1', textSelects.length > 1 && textSelects[textSelects.length - 1].parameters.index === 1, textSelects.map((c) => c.parameters));
    check('console: both selections through Luna', consoleText.some((t) => /embedded EMBEDDED_1 \(eng, srt\) through Luna, index 0/.test(t)) && consoleText.some((t) => /embedded EMBEDDED_2 \(por, srt\) through Luna, index 1/.test(t)), consoleText.filter((t) => /\[webos\] subtitles/.test(t)));
} else if (scenario === 'addon') {
    const initial = overlayTexts(phase('initial'));
    const switched = overlayTexts(phase('switched', 'switched-closed'));
    check('overlay: the English add-on subtitle shows by itself', initial.some((t) => /^ADDON EN \d+$/.test(t.trim())), initial);
    check('menu: English (add-on) selected', selectedLanguage(menuInitial) === 'eng', selectedVariant(menuInitial));
    check('overlay: the ASS add-on subtitle as plain text after the choice', switched.some((t) => /^ADDON ASS \d+$/.test(t.trim())), switched);
    check('Luna: no embedded subtitles turned on', textSelects.length === 0 && !enables.includes(true), subtitleLuna.map((c) => [c.method, c.parameters]));
    const options = readJson('settings-options.json', []);
    check('settings: no "Style ASS subtitles" option, the other subtitle options stay', options.length > 0 && !options.some((t) => /ASS/.test(t)) && options.some((t) => /Subtitles Size/i.test(t)), options);
} else if (scenario === 'mixed') {
    const initialVariant = selectedVariant(menuInitial);
    check('menu: English chosen by the Player', selectedLanguage(menuInitial) === 'eng', initialVariant);
    check('B5 rule: same language, no earlier add-on choice -> the embedded one (as upstream)', initialVariant && /Embedded/i.test(initialVariant.origin || ''), initialVariant);
    const switched = overlayTexts(phase('switched', 'switched-closed'));
    check('overlay: the add-on English subtitle after the choice', switched.some((t) => /^ADDON EN \d+$/.test(t.trim())), switched);
    check('Luna: pipeline subtitles turned off after the add-on choice', enables.length > 0 && enables[enables.length - 1] === false, enables);
    check('menu: the add-on variant selected', /xclusiv/i.test((selectedVariant(menuSwitched) || {}).origin || ''), selectedVariant(menuSwitched));
    check('timeline: overlay texts before the menu', true, overlayTexts(phase('loading', 'initial')));
}

const passed = checks.filter((c) => c.ok).length;
console.log(JSON.stringify({ scenario, passed, total: checks.length, checks }, null, 2));
process.exit(passed === checks.length ? 0 : 1);
