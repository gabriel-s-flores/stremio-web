#!/usr/bin/env node
// Cliente mínimo do DevTools Protocol para o Web Inspector do webOS TV
// (emulador em 127.0.0.1:9998 ou TV real após `ares-inspect`).
// O runtime é Chromium 53: as expressões avaliadas precisam ser ES2015.
//
//   node cdp.mjs targets
//   node cdp.mjs eval 'navigator.userAgent'
//   node cdp.mjs eval 'fetch(location.href).then(r => r.status)'   (Promise é aguardada)
//   node cdp.mjs screenshot out.png
//   node cdp.mjs key RIGHT RIGHT OK BACK
//   node cdp.mjs console --seconds 30
//   node cdp.mjs reload | navigate <url>
// Opções: --host, --port, --target <trecho da url ou título>, --timeout <ms>
import fs from 'node:fs';

const KEYCODES = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, ENTER: 13, BACK: 461,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, STOP: 413, FASTFORWARD: 417, REWIND: 412,
    CHANNELUP: 33, CHANNELDOWN: 34, INFO: 457,
    '0': 48, '1': 49, '2': 50, '3': 51, '4': 52, '5': 53, '6': 54, '7': 55, '8': 56, '9': 57,
};

const argv = process.argv.slice(2);
const opts = { host: process.env.CDP_HOST || '127.0.0.1', port: Number(process.env.CDP_PORT || 9998), target: null, timeout: 15000, seconds: 20 };
const positional = [];
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') opts.host = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--target') opts.target = argv[++i];
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--seconds') opts.seconds = Number(argv[++i]);
    else positional.push(a);
}
const [command, ...rest] = positional;

async function listTargets() {
    const res = await fetch(`http://${opts.host}:${opts.port}/json`);
    if (!res.ok) throw new Error(`/json respondeu ${res.status}`);
    return res.json();
}

async function connect() {
    const targets = (await listTargets()).filter((t) => t.webSocketDebuggerUrl);
    const target = opts.target
        ? targets.find((t) => (t.url || '').includes(opts.target) || (t.title || '').includes(opts.target))
        : targets.find((t) => t.type === 'page') || targets[0];
    if (!target) throw new Error('nenhum alvo inspecionável (o app está aberto? use --target)');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', () => reject(new Error(`falha ao conectar em ${target.webSocketDebuggerUrl}`)), { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    const listeners = new Set();
    ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject, timer } = pending.get(msg.id);
            clearTimeout(timer);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
            else resolve(msg.result);
        } else if (msg.method) {
            listeners.forEach((fn) => fn(msg));
        }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
            if (pending.delete(id)) reject(new Error(`timeout em ${method}`));
        }, opts.timeout);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
    });
    return { target, send, on: (fn) => listeners.add(fn), close: () => ws.close() };
}

function describe(remote) {
    if (!remote) return undefined;
    if ('value' in remote) return remote.value;
    return remote.description || remote.type;
}

async function evaluate(session, expression) {
    // Sem awaitPromise no Chromium 53: guarda o resultado da Promise numa global e consulta.
    const slot = `__cdp_${Date.now()}`;
    const wrapped = `(function(){var s='${slot}';try{var v=(${expression});` +
        `if(v&&typeof v.then==='function'){window[s]={done:false};v.then(function(r){window[s]={done:true,ok:true,value:r};},function(e){window[s]={done:true,ok:false,value:String(e&&e.stack||e)};});return {pending:s};}` +
        `return {value:v};}catch(e){return {error:String(e&&e.stack||e)};}})()`;
    const first = await session.send('Runtime.evaluate', { expression: wrapped, returnByValue: true });
    if (first.wasThrown || first.exceptionDetails) {
        // Erro de sintaxe na expressão (ex.: várias instruções sem IIFE).
        throw new Error(describe(first.result) || JSON.stringify(first.exceptionDetails));
    }
    const out = describe(first.result);
    if (out && out.error) throw new Error(out.error);
    if (!out || !out.pending) return out ? out.value : undefined;
    const deadline = Date.now() + opts.timeout;
    while (Date.now() < deadline) {
        const poll = await session.send('Runtime.evaluate', { expression: `window['${slot}']`, returnByValue: true });
        const state = describe(poll.result);
        if (state && state.done) {
            await session.send('Runtime.evaluate', { expression: `delete window['${slot}']` });
            if (!state.ok) throw new Error(state.value);
            return state.value;
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('timeout aguardando a Promise');
}

async function main() {
    switch (command) {
        case 'targets': {
            for (const t of await listTargets()) console.log(`${t.type}\t${t.title}\t${t.url}\t${t.webSocketDebuggerUrl || '(ocupado)'}`);
            return;
        }
        case 'eval': {
            const session = await connect();
            const value = await evaluate(session, rest.join(' '));
            console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
            session.close();
            return;
        }
        case 'screenshot': {
            const session = await connect();
            const { data } = await session.send('Page.captureScreenshot', {});
            fs.writeFileSync(rest[0] || 'screenshot.png', Buffer.from(data, 'base64'));
            console.log(rest[0] || 'screenshot.png');
            session.close();
            return;
        }
        case 'key': {
            const session = await connect();
            for (const name of rest) {
                const keyCode = KEYCODES[name.toUpperCase()] ?? Number(name);
                if (!Number.isInteger(keyCode)) throw new Error(`tecla desconhecida: ${name}`);
                for (const type of ['rawKeyDown', 'keyUp']) {
                    await session.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
                }
                console.log(`${name} (${keyCode})`);
                await new Promise((r) => setTimeout(r, 300));
            }
            session.close();
            return;
        }
        case 'console': {
            const session = await connect();
            session.on((msg) => {
                const p = msg.params || {};
                if (msg.method === 'Console.messageAdded') console.log(`[${p.message.level}] ${p.message.text}`);
                else if (msg.method === 'Runtime.consoleAPICalled') console.log(`[${p.type}] ${(p.args || []).map(describe).join(' ')}`);
                else if (msg.method === 'Runtime.exceptionThrown') console.log(`[exception] ${JSON.stringify(p.exceptionDetails)}`);
            });
            await session.send('Runtime.enable').catch(() => {});
            await session.send('Console.enable').catch(() => {});
            await new Promise((r) => setTimeout(r, opts.seconds * 1000));
            session.close();
            return;
        }
        case 'reload': {
            const session = await connect();
            await session.send('Page.reload', { ignoreCache: true });
            session.close();
            return;
        }
        case 'navigate': {
            const session = await connect();
            await session.send('Page.navigate', { url: rest[0] });
            session.close();
            return;
        }
        default:
            console.error(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 14).join('\n'));
            process.exit(1);
    }
}

main().catch((err) => {
    console.error(`erro: ${err.message}`);
    process.exit(1);
});
