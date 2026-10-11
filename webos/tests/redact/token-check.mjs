#!/usr/bin/env node
// Evaluates the output of webos/tests/redact/token-log.sh (F3.7b): exits non-zero if the proxy token
// (in $TOKEN) or any other proxy token is in a file of <output-dir>, or if the scenario did not
// reproduce the failure it is about.
//   TOKEN=<token> node token-check.mjs <output-dir>
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const token = process.env.TOKEN || '';
if (!dir || !/^[0-9a-f]{32}$/.test(token)) {
    console.error('usage: TOKEN=<32 hex> token-check.mjs <output-dir>');
    process.exit(2);
}
const readJson = (file, fallback) => {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (_e) {
        return fallback;
    }
};

// The token, raw or percent-encoded, and any unmasked "t=" of a proxy URL.
const LEAKS = [
    ['the token', (text) => text.includes(token)],
    ['a proxy URL with an unmasked t=', (text) => /\/proxy\?t=(?!\*\*\*)[\w-]+/i.test(text) || /%2Fproxy%3Ft%3D(?!\*\*\*)[\w-]+/i.test(text)],
    ['a 32-hex t= parameter', (text) => /[?&]t=[0-9a-f]{32}/i.test(text)],
];

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

const records = fs.readFileSync(path.join(dir, 'devtools-log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const isControl = (record) => JSON.stringify(record).includes('F37B-CONTROL');
const controls = records.filter(isControl);
const filtered = records.filter((record) => JSON.stringify(record).includes('F37B-FILTERED'));
const rest = records.filter((record) => !isControl(record));
// The Chromium 53 reports the console through the older protocol (Console.messageAdded): the calls of
// the page (source console-api, with the arguments) and the browser's own messages (source network:
// "Failed to load resource" with the url of the request, which no page script can filter).
const isPageConsole = (record) => record.kind === 'console' || (record.kind === 'console-message' && record.source === 'console-api');
const isBrowserNetwork = (record) => record.kind === 'console-message' && record.source === 'network';
const pageRecords = rest.filter((record) => !isBrowserNetwork(record));
const networkRecords = rest.filter(isBrowserNetwork);
const networkWithToken = networkRecords.filter((record) => record.tokenSeen);
const networkSubtitle = networkRecords.filter((record) => JSON.stringify(record).includes(encodeURIComponent(process.env.MISSING_SUBTITLE_URL || 'zz-f37b-missing-subtitle')) || JSON.stringify(record).includes('zz-f37b-missing-subtitle'));

check('the recorder works: the control (unfiltered console of an iframe) shows the token', controls.length > 0 && controls.some((record) => record.tokenSeen), `${controls.length} control record(s)`);
check('the filtered page console masks the same URL', filtered.length > 0 && !filtered.some((record) => record.tokenSeen) && JSON.stringify(filtered).includes('t=***'), `${filtered.length} record(s)`);

const player = rest.filter((record) => isPageConsole(record) && record.args[0] && record.args[0].value === 'Player');
const failure = player.find((record) => JSON.stringify(record).includes('Failed to load external subtitles'));
check('the scenario reproduced the failure: console.error("Player", LOAD_FAILED) with the track', !!failure, failure ? JSON.stringify(failure.args[1] && failure.args[1].json).slice(0, 300) : `${player.length} Player error(s) seen`);
check('that log names the proxy URL with the token masked', !!failure && JSON.stringify(failure).includes('/proxy?t=***'), '');

const files = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile() && name !== 'resultado.json');
const leaks = [];
files.forEach((name) => {
    if (name === 'devtools-log.jsonl') {
        const seen = pageRecords.filter((record) => record.tokenSeen);
        if (seen.length > 0) leaks.push(`${name}: ${seen.length} record(s) of the page console, exceptions or non-network messages carry a token`);
    }
    // The recorder file has the control and the network messages with the token replaced by <TOKEN>.
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    LEAKS.forEach(([label, test]) => {
        if (test(text)) leaks.push(`${name}: ${label}`);
    });
});
check('no file of the run shows the token (page console, exceptions, report, toasts, audits)', leaks.length === 0, leaks.join('; ') || `${files.length} files, ${pageRecords.length} DevTools records (the browser network messages are counted apart)`);

const proxyState = readJson('proxy-state.json', {});
check('the certificate proxy was in use (mode proxy, service up)', proxyState.mode === 'proxy' && proxyState.ready === true, JSON.stringify(proxyState));

const player_ = readJson('page-audit-player.json', {});
check('with the subtitle context menu open: no token on screen, in an attribute or in storage (the menu\'s href is the add-on\'s)', player_.tokenInVisibleText === false && player_.attributesWithToken === 0 && Array.isArray(player_.localStorageKeysWithToken) && player_.localStorageKeysWithToken.length === 0, JSON.stringify(player_));
const diag = readJson('page-audit-diagnostics.json', {});
check('the diagnostics screen, its report object and the saved report do not hold the token',
    diag.tokenInReportBlock === false && diag.tokenInBodyText === false && diag.tokenInReportObject === false && diag.tokenInSavedReport === false && diag.reportBlockChars > 0, JSON.stringify(diag));
const saved = fs.readFileSync(path.join(dir, 'diagnostics-saved.txt'), 'utf8');
check('Save report stored the report', saved.includes('Stremio webOS diagnostics'), `${saved.length} chars`);

const toasts = readJson('toasts.json', []);
check('the toast of the failed subtitle shows no token', !JSON.stringify(toasts).includes(token), JSON.stringify(toasts));

const missing = process.env.MISSING_SUBTITLE_URL || 'https://debrid-link.com/zz-f37b-missing-subtitle.srt';
const dialog = readJson('external-link-dialog.json', {});
check('"Download subtitles" opens the link dialog with the add-on\'s own URL, no proxy URL, no token (F3.4 + F3.7b)',
    dialog.externalLinkDialog === true && dialog.qr === true && dialog.qrLabel === missing && !JSON.stringify(dialog).includes('127.0.0.1') && !JSON.stringify(dialog).includes(token), JSON.stringify(dialog));
const copied = readJson('copied.json', {});
check('"Copy subtitle URL" copies the add-on\'s own URL (not the proxy URL)', copied.copied === missing, JSON.stringify(copied));
const dialogAudit = readJson('page-audit-dialog.json', {});
check('with the dialog open: no token on screen, in an attribute or in storage', dialogAudit.tokenInVisibleText === false && dialogAudit.attributesWithToken === 0 && dialogAudit.localStorageKeysWithToken.length === 0, JSON.stringify(dialogAudit));
const menu = readJson('context-menu.json', []);
const download = menu.find((option) => /ownload/.test(option.title || ''));
check('the subtitle context menu offers "Download subtitles" with the add-on\'s URL as its link', !!download && download.href === missing, JSON.stringify(menu));

// What the page cannot filter: the browser's own network messages carry the url of the request, and
// the proxy URL has the token. Not a check (no page code can change it, only the protocol of the
// proxy could); it is measured and reported.
const info = {
    devtoolsRecords: rest.length,
    pageConsoleCalls: rest.filter(isPageConsole).length,
    exceptions: rest.filter((record) => record.kind === 'exception').length,
    attributesWithToken: player_.attributesWithToken,
    imageSourcesWithToken: player_.imageSourcesWithToken,
    otherLoopbackAttributes: player_.otherLoopbackAttributes,
    clipboard: player_.clipboard,
    browserNetworkMessages: networkRecords.length,
    browserNetworkMessagesWithToken: networkWithToken.length,
    browserNetworkMessagesAboutTheMissingSubtitle: networkSubtitle.length,
    browserNetworkMessagesWithTokenBySource: networkWithToken.reduce((counts, record) => {
        const host = /[?&]url=([^&"]+)/.exec(record.url || '');
        const key = host ? decodeURIComponent(host[1]).replace(/^(https?:\/\/[^/]+).*/, '$1') : 'other';
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {}),
};
const ok = checks.every((entry) => entry.ok);
console.log(JSON.stringify({ ok, checks, info }, null, 2));
process.exit(ok ? 0 : 1);
