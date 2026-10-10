#!/usr/bin/env node
/* eslint-disable no-console */
// Dev tool (Node only, not shipped): runs the header probe on a file, URL or probe fixture and
// prints what the C8 rules decide for it. Without a source, only the stream name is used.
//
//   node tools/evaluate.mjs [<url|file|fixture:<id>>] [--name "<stream name/title>"] [--lang por,eng]
//                           [--no-sniff] [--profile overrides.json] [--brief]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { probe, probeUrl } = require('../../header-probe');
const { loadFixture, replayReadRange } = require('../../header-probe/test/replay');
const { evaluate, mergeProfile, DEFAULT_PROFILE } = require('../index.js');

const args = process.argv.slice(2);
const flag = (name) => {
    const index = args.indexOf(name);
    if (index === -1) return null;
    const value = args[index + 1];
    args.splice(index, 2);
    return value;
};
const toggle = (name) => {
    const index = args.indexOf(name);
    if (index !== -1) args.splice(index, 1);
    return index !== -1;
};

const name = flag('--name');
const lang = flag('--lang');
const profilePath = flag('--profile');
const noSniff = toggle('--no-sniff');
const brief = toggle('--brief');
const source = args[0] || null;
const options = noSniff ? { sniffFrames: false } : {};

const fileReadRange = (file) => {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    return (offset, length) => {
        const data = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
        if (data.length > 0) fs.readSync(fd, data, 0, data.length, offset);
        return Promise.resolve({ data: new Uint8Array(data.buffer, data.byteOffset, data.length), size });
    };
};

const runProbe = () => {
    if (source === null) return Promise.resolve(null);
    if (source.indexOf('fixture:') === 0) {
        const fixture = loadFixture(source.slice('fixture:'.length));
        return probe(replayReadRange(fixture), Object.assign({}, fixture.meta.options, options));
    }
    if (/^https?:\/\//.test(source)) return probeUrl(source, options);
    return probe(fileReadRange(path.resolve(source)), options);
};

const summarize = (result) => ({
    tier: result.tier,
    score: result.score,
    container: result.container,
    video: [result.video.codec, result.video.format, '→', result.video.output].map((part) => (part === null ? '-' : part)).join(' '),
    dolbyVision: result.video.dolbyVision,
    initialAudio: result.audio.initialTrack && {
        id: result.audio.initialTrack.id, codec: result.audio.initialTrack.codec, profile: result.audio.initialTrack.profile,
        language: result.audio.initialTrack.language, atmosOnTv: result.audio.initialTrack.atmosOnTv,
    },
    audioTracks: result.audio.tracks.map((track) => track.id + ' ' + track.codec + ' ' + (track.language || '-') + ' ' + track.status),
    labels: result.labels.map((label) => label.text + ' [' + label.source + ']'),
    warnings: result.warnings.map((warning) => warning.code + ' (' + warning.severity + ', ' + warning.score + '): ' + warning.message),
    hiddenSubtitles: result.subtitles.hidden.map((track) => track.codec + ' ' + (track.language || '-')),
    needsProbe: result.needsProbe,
});

runProbe().then((probeResult) => {
    const profile = profilePath ? mergeProfile(DEFAULT_PROFILE, JSON.parse(fs.readFileSync(profilePath, 'utf8'))) : DEFAULT_PROFILE;
    const result = evaluate({
        probe: probeResult,
        stream: name,
        preferences: { audioLanguages: lang ? lang.split(',') : [] },
        profile,
    });
    console.log(JSON.stringify(brief ? summarize(result) : result, null, 2));
}).catch((error) => {
    console.error((error && error.code ? error.code + ': ' : '') + (error && error.message ? error.message : error));
    console.error('uso: node ' + path.relative(process.cwd(), path.join(HERE, 'evaluate.mjs')) + ' [<url|arquivo|fixture:<id>>] [--name "..."] [--lang por,eng] [--no-sniff] [--profile f.json] [--brief]');
    process.exit(1);
});
