#!/usr/bin/env node
// Evaluates the output of webos/tests/player/emulator.sh (F5.1) and exits non-zero on failure.
//   node evaluate.mjs <output-dir> <expected-duration-s>
import fs from 'node:fs';
import path from 'node:path';

const [dir, expectedArg] = process.argv.slice(2);
const expectedDuration = Number(expectedArg);
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
const samples = read('samples.jsonl').trim().split('\n').map((line) => JSON.parse(line));
const luna = JSON.parse(read('luna.json'));
const speed = JSON.parse(read('speed.json'));
const serverLog = read('media-server.log');

// "0:07" / "1:02:03" -> seconds
const parseLabel = (label) => (typeof label === 'string' && /^\d+(:\d+)+$/.test(label.trim()) ?
    label.trim().split(':').reduce((total, part) => total * 60 + Number(part), 0) : null);

const videos = (phase) => samples.filter((s) => s.phase === phase && s.sample && s.sample.video).map((s) => s.sample);
const playing = videos('playing');
const paused = videos('paused');
const resumed = videos('resumed');
const last = (list) => list[list.length - 1];
const times = (list) => list.map((s) => s.video.currentTime);
const increasing = (list) => list.length >= 2 && times(list).every((t, i, all) => i === 0 || t >= all[i - 1]) && last(times(list)) > times(list)[0];

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

const startup = JSON.parse(read('startup.json'));
check('playback starts (route opened -> video moving)', startup.secondsToPlayback !== null, startup);

check('video element present and no media error', playing.length > 0 && playing.every((s) => s.video.error === null), playing.map((s) => s.video.error));
const durations = playing.map((s) => s.video.duration).filter((d) => Number.isFinite(d));
check('duration matches the file (±0.5 s)', durations.length > 0 && Math.abs(last(durations) - expectedDuration) <= 0.5, { expected: expectedDuration, got: last(durations) });
check('currentTime advances while playing (no frozen time)', increasing(playing) && last(times(playing)) >= 5, times(playing));
// Measured from the first sample with the video moving (the start includes the initial buffering).
const moving = playing.filter((s) => s.video.currentTime > 0);
const speedRatio = moving.length >= 2 ? (last(times(moving)) - times(moving)[0]) / ((last(moving).t - moving[0].t) / 1000) : null;
check('currentTime advances at ~1x wall clock', speedRatio !== null && speedRatio > 0.8 && speedRatio < 1.2, speedRatio);
check('playbackRate stays 1', playing.every((s) => s.video.playbackRate === 1), playing.map((s) => s.video.playbackRate));
const pausedTimes = times(paused);
check('pause from the control bar: paused and time stopped', paused.length > 0 && paused.every((s) => s.video.paused) &&
    Math.max(...pausedTimes) - Math.min(...pausedTimes) < 0.3, pausedTimes);
check('play from the control bar: resumes and time advances', resumed.length > 0 && !last(resumed).video.paused && last(times(resumed)) > Math.max(...pausedTimes), times(resumed));
// The UI labels follow the video: current time label within 1.5 s of currentTime, duration label = duration.
const labelled = playing.filter((s) => s.seekBarLabels && s.seekBarLabels.length === 2);
const labelErrors = labelled.map((s) => Math.abs(parseLabel(s.seekBarLabels[0]) - s.video.currentTime));
check('seek bar labels show the current time and the duration', labelled.length > 0 &&
    labelErrors.every((e) => e <= 1.5) && parseLabel(last(labelled).seekBarLabels[1]) === Math.floor(expectedDuration),
{ labels: labelled.map((s) => s.seekBarLabels), errors: labelErrors });
// Remaining time mode (toggled while paused): "HH:MM:SS-" = duration - currentTime, not Infinity/NaN.
const remaining = videos('remaining');
const remainingLabel = remaining.length ? remaining[0].seekBarLabels[1] : null;
const remainingExpected = remaining.length ? remaining[0].video.duration - remaining[0].video.currentTime : null;
check('remaining time label shows duration - currentTime', typeof remainingLabel === 'string' && /^\d+(:\d+)+-$/.test(remainingLabel) &&
    Math.abs(parseLabel(remainingLabel.slice(0, -1)) - remainingExpected) <= 1.5, { label: remainingLabel, expected: remainingExpected });
check('no speed button and no speed menu', !speed.speedIconRendered && !speed.speedMenuRendered, speed);
const mediaSubscribe = luna.luna.filter((c) => /com\.webos\.media/.test(c.uri) && (c.method === 'subscribe' || c.subscribe));
check('the app never subscribes to com.webos.media', mediaSubscribe.length === 0, mediaSubscribe);
check('WebOsVideo in use (its edidType read through Luna after the load)', luna.luna.some((c) => c.method === 'getConfigs' &&
    JSON.stringify(c.parameters || {}).includes('tv.model.edidType') && !JSON.stringify(c.parameters || {}).includes('supportDolbyHDRContents')), luna.luna.map((c) => c.uri + '/' + c.method));
check('stream fetched through the 302 redirect with Range', /GET \/redirect\/\S+ +-> 302/.test(serverLog) && /bytes=\d+-/.test(serverLog), null);
check('no streaming server request is made for transcoding', !/hlsv2|transcode|\/hls\//i.test(JSON.stringify(luna) + serverLog), null);

const ok = checks.every((c) => c.ok);
console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
