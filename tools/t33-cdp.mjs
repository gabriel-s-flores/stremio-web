export async function connect(hint = 'http:', endpoint = 'http://localhost:53597', onEvent = () => {}) {
    const targets = await (await fetch(endpoint + '/json')).json();
    const target = targets.find(t => t.type === 'page' && t.url.includes(hint));
    if (!target) throw Error('Target unavailable: ' + hint);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ({ data }) => {
        const message = JSON.parse(data), job = pending.get(message.id);
        if (message.method) onEvent(message);
        if (job) { pending.delete(message.id); clearTimeout(job.timer); message.error ? job.reject(Error(message.error.message)) : job.resolve(message.result); }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const key = ++id;
        const timer = setTimeout(() => { pending.delete(key); reject(Error(method + ' timeout')); }, 20000);
        pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
    });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + result.result.description);
        return result.result.value;
    };
    return { send, evaluate, close: () => ws.close() };
}
if (process.argv[1]?.endsWith('t33-cdp.mjs')) {
    const fs = await import('node:fs');
    const cdp = await connect(process.argv[3]);
    try { console.log(JSON.stringify(await cdp.evaluate(fs.readFileSync(process.argv[2], 'utf8')), null, 2)); }
    finally { cdp.close(); }
}
