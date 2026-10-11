#!/usr/bin/env node
// Records what a DevTools reader sees from the page (F3.7b): every console call with its arguments
// (the description and the object as JSON), the browser's own log entries (network errors and the
// like, which no page script can filter) and the uncaught exceptions. One JSON per line in <out>,
// until it receives SIGTERM or --seconds pass.
//   node cdp-log.mjs --port <cdp port> --out <file> --control-file <file> [--seconds 600]
// The inspector of the webOS Chromium takes one client at a time, so this one also does the page's
// evaluations and screenshots for the scenario: it writes its local HTTP port to --control-file, and
//   POST /eval        (body: an ES2015 expression, a Promise is awaited)  -> its value
//   POST /screenshot  (body: a file path)                                 -> writes the PNG
import fs from 'node:fs';
import http from 'node:http';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
};
const port = Number(opt('port', 9998));
const out = opt('out');
const seconds = Number(opt('seconds', 600));
const controlFile = opt('control-file');
if (!out || !controlFile) {
    console.error('usage: cdp-log.mjs --port <cdp port> --out <file> --control-file <file> [--seconds n]');
    process.exit(2);
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || targets.find((t) => t.webSocketDebuggerUrl);
if (!target) throw new Error('no inspectable target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('cannot connect')), { once: true });
});

let nextId = 1;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null);
    }, 30000);
    pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message.error ? null : message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
});

// Every record says whether it carries a proxy token (tokenSeen: the exact $TOKEN, or a 32-hex t=
// parameter). The control (F37B-CONTROL) and the browser's own network messages, which are expected to
// carry it, are written with the token replaced by <TOKEN>, so the evidence folder never has it. A
// record of the page console that carries it is written raw: that is a leak, and a failing run
// keeps its proof.
const SECRET = process.env.TOKEN || '';
const TOKEN_PARAM = /((?:[?&]|%3F|%26)t(?:=|%3D))[0-9a-f]{32}/gi;
const lines = fs.createWriteStream(out, { flags: 'a' });
const write = (record) => {
    let text = JSON.stringify(Object.assign({ at: Date.now() }, record));
    const seen = (SECRET !== '' && text.includes(SECRET)) || new RegExp(TOKEN_PARAM.source, 'i').test(text);
    if (seen && (text.includes('F37B-CONTROL') || record.source === 'network')) {
        if (SECRET !== '') text = text.split(SECRET).join('<TOKEN>');
        text = text.replace(TOKEN_PARAM, '$1<TOKEN>');
    }
    lines.write(text.replace(/\}$/, `,"tokenSeen":${seen}}`) + '\n');
};

// The object as JSON, bounded (depth 6, 2000 values, 4000 characters per string): the page has to
// stay responsive whatever it logs.
const AS_JSON = `function() {
    var budget = 2000;
    var walk = function(value, depth) {
        if (typeof value === 'string') return value.length > 4000 ? value.slice(0, 4000) + '…' : value;
        if (value === null || typeof value !== 'object') return typeof value === 'function' ? '[function]' : value;
        if (value instanceof Error) return { message: value.message, stack: value.stack };
        if (depth >= 6 || budget <= 0) return '[…]';
        var out = Array.isArray(value) ? [] : {};
        var keys = Array.isArray(value) ? null : Object.keys(value);
        var count = keys ? keys.length : value.length;
        for (var i = 0; i < count && budget > 0; i++) {
            budget -= 1;
            var key = keys ? keys[i] : i;
            try { out[key] = walk(value[key], depth + 1); } catch (error) { out[key] = '[unreadable]'; }
        }
        return out;
    };
    try { return JSON.stringify(walk(this, 0)); } catch (error) { return String(error); }
}`;

// Resolving the arguments needs round trips: keep the order of the records with a chain.
let chain = Promise.resolve();
const resolveArg = async (remote) => {
    const arg = { type: remote.type, subtype: remote.subtype, description: remote.description };
    if ('value' in remote) arg.value = remote.value;
    if (remote.objectId) {
        const json = await send('Runtime.callFunctionOn', { objectId: remote.objectId, functionDeclaration: AS_JSON, returnByValue: true });
        arg.json = json && json.result ? json.result.value : null;
        if (remote.preview) arg.preview = remote.preview;
    }
    return arg;
};

ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
        const done = pending.get(message.id);
        pending.delete(message.id);
        done(message);
        return;
    }
    const params = message.params || {};
    if (message.method === 'Runtime.consoleAPICalled') {
        chain = chain.then(async () => {
            const args = [];
            for (const remote of params.args || []) args.push(await resolveArg(remote));
            write({ kind: 'console', type: params.type, args });
        });
    } else if (message.method === 'Console.messageAdded') {
        // The console of the older inspector protocol (the Chromium 53 may use this one instead).
        chain = chain.then(async () => {
            const entry = params.message || {};
            const args = [];
            for (const remote of entry.parameters || []) args.push(await resolveArg(remote));
            write({ kind: 'console-message', level: entry.level, source: entry.source, text: entry.text, url: entry.url, args });
        });
    } else if (message.method === 'Log.entryAdded') {
        write({ kind: 'log-entry', entry: params.entry });
    } else if (message.method === 'Runtime.exceptionThrown') {
        write({ kind: 'exception', details: params.exceptionDetails });
    }
});

await send('Runtime.enable');
await send('Console.enable');
await send('Log.enable');
write({ kind: 'started', target: target.url });

// Same technique as webos/tools/cdp.mjs: the Chromium 53 has no awaitPromise, so the result of a
// Promise goes to a global that is polled.
const evaluate = async (expression) => {
    const slot = `__cdp_log_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const wrapped = `(function(){var s='${slot}';try{var v=(${expression});` +
        `if(v&&typeof v.then==='function'){window[s]={done:false};v.then(function(r){window[s]={done:true,ok:true,value:r};},function(e){window[s]={done:true,ok:false,value:String(e&&e.stack||e)};});return {pending:s};}` +
        `return {value:v};}catch(e){return {error:String(e&&e.stack||e)};}})()`;
    const first = await send('Runtime.evaluate', { expression: wrapped, returnByValue: true });
    if (!first || first.wasThrown || first.exceptionDetails) throw new Error(JSON.stringify(first && first.exceptionDetails) || 'evaluate failed');
    const out = first.result && first.result.value;
    if (out && out.error) throw new Error(out.error);
    if (!out || !out.pending) return out ? out.value : undefined;
    for (let i = 0; i < 300; i++) {
        const poll = await send('Runtime.evaluate', { expression: `window['${slot}']`, returnByValue: true });
        const state = poll && poll.result && poll.result.value;
        if (state && state.done) {
            await send('Runtime.evaluate', { expression: `delete window['${slot}']` });
            if (!state.ok) throw new Error(state.value);
            return state.value;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('timeout waiting for the Promise');
};

const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', async () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
            if (request.url === '/eval') {
                const value = await evaluate(body);
                response.end(typeof value === 'string' ? value : JSON.stringify(value));
            } else if (request.url === '/screenshot') {
                const shot = await send('Page.captureScreenshot', {});
                fs.writeFileSync(body.trim(), Buffer.from(shot.data, 'base64'));
                response.end('ok');
            } else {
                response.statusCode = 404;
                response.end('not found');
            }
        } catch (error) {
            response.statusCode = 500;
            response.end(String(error.message || error));
        }
    });
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(controlFile, String(server.address().port)));

const stop = async () => {
    await chain;
    lines.end(() => process.exit(0));
};
process.on('unhandledRejection', (error) => console.error('cdp-log: unhandled rejection', error));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setTimeout(stop, seconds * 1000);
