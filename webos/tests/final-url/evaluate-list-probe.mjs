#!/usr/bin/env node
// Evaluates a run of webos/tests/final-url/list-probe.sh (F8.5): the stream list's probe followed the
// resolver's redirect to another origin and noted it, so opening the stream does not ask the resolver
// again. Prints JSON; exit code 1 on a failed check.
//   node evaluate-list-probe.mjs <output-dir>
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || '.');
const read = (name, fallback) => {
    try {
        return JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8'));
    } catch (_error) {
        return fallback;
    }
};
const hits = read('far-hits.json', {});
const page = read('page.json', { events: [], marks: [] });
const consoleLines = read('console.json', []).map((entry) => entry.text);
const state = read('final-state.json', {});
const openedAt = (page.marks.filter((entry) => entry.name === 'open')[0] || { t: Infinity }).t;
const srcs = page.events.filter((event) => event.event === 'src' && event.t >= openedAt).map((event) => event.url);
const finalLog = consoleLines.filter((line) => /final URL/.test(line));

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
check('the list probe asked the resolver before the Player opened', hits.before >= 1, hits);
check('the <video> got a link on the other origin (the file host)', srcs.length >= 1 && srcs.every((url) => url.indexOf(`:${hits.farPort}/`) !== -1 && url.indexOf('/far/') === -1), srcs);
check('the Player\'s load did not ask the resolver again (known from the list probe)', hits.after === hits.before, hits);
check('the log says "final URL known"', finalLog.some((line) => /final URL known/.test(line)), finalLog);
check('the stream plays', state.playing === true && state.errorLayer === false, state);

const result = { hits, srcs, finalLog, checks, ok: checks.every((entry) => entry.ok) };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
