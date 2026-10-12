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
    'rate-limited-429': { kind: 'rate-limited', label: /limiting requests right now \(HTTP 429\)/, hint: /Wait a moment, then go back and open the stream again/ },
    'server-error-503': { kind: 'server-error', label: /having problems \(HTTP 503\)/, hint: /Go back and open the stream again in a while/ },
    // The TV has internet (the control host answers) and the link host does not: not "no internet".
    'network-drop': { kind: 'host', label: /The TV could not connect to the server of this link/, hint: /certificate may not be accepted.*Pick another stream/ },
    // Nothing listens on the port: the check cannot show up in the media server log.
    'network-refused': { kind: 'host', noServer: true, label: /The TV could not connect to the server of this link/, hint: /certificate may not be accepted.*Pick another stream/ },
    // Let's Encrypt host: the Chromium 53 fetch() refuses it while the TV has internet (review c1, M1).
    'le-host': { kind: 'host', noServer: true, label: /The TV could not connect to the server of this link/, hint: /certificate may not be accepted.*Pick another stream/ },
    // No internet: navigator.onLine is false.
    'offline-drop': { kind: 'network', noServer: true, label: /Could not reach the server of this link/, hint: /Check the internet connection of the TV, then go back and open the stream again/ },
    // F8.4: the Torrentio-like resolver redirects to its notice video (206, does not play).
    'torrentio-access': { kind: 'notice-access-denied', label: /The debrid service denied access to the account set in the addon/, hint: /API key.*configure the addon again/, notice: 'failed_access_v3' },
    'torrentio-downloading': { kind: 'notice-downloading', label: /still downloading this file/, hint: /Wait a few minutes/, notice: 'downloading_v3' },
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
        check('the message does not send the user to the internet connection when the TV has internet', expected.kind === 'network' || !/internet/i.test(`${last.label} ${last.hint}`), last);
        // F8.4: no external player on the TV.
        check('no "Open in external player" button and no external player hint', !(last.buttons || []).some((text) => /external/i.test(text)) && !/external player/i.test(`${last.label} ${last.hint}`), last.buttons);
        if (expected.notice) {
            check(`the media server served the notice video ${expected.notice}.mp4 (after the resolver's 302)`, new RegExp(`/videos/${expected.notice}\\.mp4`).test(serverLog), null);
            check('the debrid key never reaches the console', !console_.some((c) => /f84secret/.test(c.text)), null);
        }
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
