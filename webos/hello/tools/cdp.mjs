// Helper CDP (Chrome DevTools Protocol) para o webOS TV Emulator 5.0.
// Sem dependencias: usa o WebSocket nativo do Node >= 21.
//
// Uso:
//   node cdp.mjs list                          -> lista alvos (pages/apps)
//   node cdp.mjs eval <id-parcial|url> <js>    -> Runtime.evaluate na pagina
//   node cdp.mjs logs <id-parcial|url> [secs]  -> escuta console.log da pagina
//
// Ex.: node cdp.mjs eval hello.hosted "location.href"
//      node cdp.mjs eval hello.packaged "location.hash = '#/b'"

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9998';

async function listTargets() {
	const res = await fetch(`${CDP_HTTP}/json`);
	if (!res.ok) throw new Error(`CDP /json -> HTTP ${res.status}`);
	return res.json();
}

async function findTarget(hint) {
	const targets = await listTargets();
	const t = targets.find((t) => (t.id && t.id.includes(hint)) || (t.url && t.url.includes(hint)) || (t.title && t.title.includes(hint)));
	if (!t) {
		const urls = targets.map((x) => `  - [${x.type}] ${x.id} ${x.url}`).join('\n');
		throw new Error(`alvo nao encontrado para "${hint}". Alvos:\n${urls}`);
	}
	return t;
}

function connect(wsUrl) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		ws.onopen = () => resolve(ws);
		ws.onerror = (e) => reject(new Error('WS error: ' + (e.message || 'desconhecido')));
	});
}

let msgId = 0;
const pending = new Map();

function send(ws, method, params = {}) {
	return new Promise((resolve, reject) => {
		const id = ++msgId;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
}

function wire(ws, onEvent) {
	ws.onmessage = (ev) => {
		let msg;
		try { msg = JSON.parse(ev.data); } catch { return; }
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
		} else if (onEvent) {
			onEvent(msg);
		}
	};
}

async function main() {
	const [cmd, ...rest] = process.argv.slice(2);

	if (cmd === 'list') {
		const targets = await listTargets();
		for (const t of targets) console.log(`[${t.type}] ${t.id}\n    ${t.url}\n    ${t.title}`);
		return;
	}

	if (cmd === 'eval') {
		const [hint, ...jsParts] = rest;
		const js = jsParts.join(' ');
		const t = await findTarget(hint);
		const ws = await connect(t.webSocketDebuggerUrl);
		wire(ws);
		const r = await send(ws, 'Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
		console.log(JSON.stringify(r.result && 'value' in r.result ? r.result.value : r, null, 2));
		ws.close();
		return;
	}

	if (cmd === 'logs') {
		const [hint, secs] = rest;
		const t = await findTarget(hint);
		const ws = await connect(t.webSocketDebuggerUrl);
		wire(ws, (msg) => {
			if (msg.method === 'Runtime.consoleAPICalled') {
				const args = (msg.params.args || []).map((a) => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
				console.log(`[console.${msg.params.type}]`, args);
			} else if (msg.method === 'Runtime.exceptionThrown') {
				console.log('[EXCEPTION]', JSON.stringify(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || msg.params));
			}
		});
		await send(ws, 'Runtime.enable');
		await send(ws, 'Log.enable').catch(() => {});
		console.log(`escutando "${t.url}" por ${secs || 30}s... (Ctrl+C p/ sair)`);
		setTimeout(() => { ws.close(); process.exit(0); }, (parseInt(secs, 10) || 30) * 1000);
		return;
	}

	console.log('comandos: list | eval <hint> <js> | logs <hint> [secs]');
	process.exit(1);
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
