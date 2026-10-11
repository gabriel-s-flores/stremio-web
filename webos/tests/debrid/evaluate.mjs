#!/usr/bin/env node
// Evaluates the output of webos/tests/debrid/emulator.sh (F6.3) and exits non-zero on failure.
//   node evaluate.mjs <output-dir> <scenario>
import fs from 'node:fs';
import path from 'node:path';

const [dir, scenario] = process.argv.slice(2);
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
const samples = read('samples.jsonl').trim().split('\n').map((line) => JSON.parse(line)).filter((s) => s.sample);
const last = samples[samples.length - 1].sample;
const console_ = JSON.parse(read('console.json'));
const pageErrors = JSON.parse(read('page-errors.json'));
const serverLog = read('media-server.log');

// The message and the HTTP status each scenario must show, and what the media server must have seen.
const SCENARIOS = {
    'redirect-403': { kind: 'expired', label: /expired or was refused \(HTTP 403\)/, hint: /open the stream list again/ },
    'expired-410': { kind: 'expired', label: /expired or was refused \(HTTP 410\)/, hint: /open the stream list again/ },
    'not-found-404': { kind: 'not-found', label: /no longer available at this link \(HTTP 404\)/, hint: /Pick another stream/ },
    'rate-limited-429': { kind: 'rate-limited', label: /limiting requests right now \(HTTP 429\)/, hint: /Wait a moment/ },
    'server-error-503': { kind: 'server-error', label: /having problems \(HTTP 503\)/, hint: /Try again in a while/ },
    'network-drop': { kind: 'network', label: /Could not reach the server of this link/, hint: /internet connection/ },
    // Nothing listens on the port: the check cannot show up in the media server log.
    'network-refused': { kind: 'network', noServer: true, label: /Could not reach the server of this link/, hint: /internet connection/ },
};

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

if (scenario === 'redirect-ok') {
    check('the redirected link plays (no error layer, video moving)', !last.errorLayer && last.video && last.video.currentTime > 0 && last.video.error === null, last);
    check('the 302 was served by the media server', /GET \/redirect\/\S+ .*302/.test(serverLog) || /302/.test(serverLog), null);
    check('no link check ran (the Player did not fail)', !console_.some((c) => /link check/.test(c.text)), console_);
} else {
    const expected = SCENARIOS[scenario];
    check('known scenario', !!expected, scenario);
    if (expected) {
        check('the error layer is shown', last.errorLayer, last);
        check(`the kind of problem is ${expected.kind}`, last.kind === expected.kind, last.kind);
        check('the message is the clear one, not the upstream "not supported"', typeof last.label === 'string' && expected.label.test(last.label), last.label);
        check('the hint says what to do', typeof last.hint === 'string' && expected.hint.test(last.hint), last.hint);
        check('the check is logged with the kind and no URL', console_.some((c) => new RegExp(`link check ${expected.kind}`).test(c.text) && !/https?:/.test(c.text)), console_);
        // The source of the answer: the Player's own probe already got the HTTP status (no new request
        // then), otherwise one 1-byte Range request went through the redirect to the failing host.
        const source = (console_.map((c) => /link check \S+ \S+ (\S+)/.exec(c.text)).filter(Boolean)[0] || [])[1];
        const oneByteRequests = serverLog.split('\n').filter((line) => /bytes=0-0 /.test(line)).length;
        check('the answer came from the Player probe (no new request) or from one 1-byte request',
            (source === 'player-probe' && oneByteRequests === 0) || (source === 'request' && (oneByteRequests >= 1 || expected.noServer === true)), { source, oneByteRequests });
    }
}
check('no page errors', pageErrors.length === 0, pageErrors);

const failed = checks.filter((c) => !c.ok);
process.stdout.write(`${JSON.stringify({ scenario, ok: failed.length === 0, final: last, checks }, null, 2)}\n`);
process.exit(failed.length === 0 ? 0 : 1);
