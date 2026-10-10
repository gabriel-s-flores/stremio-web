#!/usr/bin/env node
// Bateria de segurança do serviço da F0.7 (regressões da revisão c1). Fala HTTP com o serviço
// direto ou por um túnel SSH até 127.0.0.1:47443 do emulador; o cabeçalho Host é sempre o do
// serviço, para a checagem anti-rebinding aceitar o túnel. Sai com código 1 se algum caso falhar.
//
//   node security-test.mjs --base http://127.0.0.1:47543 --token <token> [--out security.json]
import http from 'node:http';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opts = { base: 'http://127.0.0.1:47443', host: '127.0.0.1:47443', token: '', out: '' };
for (let i = 0; i < argv.length; i++) opts[argv[i].replace(/^--/, '')] = argv[++i];
if (!opts.token) throw new Error('falta --token');
const base = new URL(opts.base);
const SECRET = 'F07-SECRET-' + Math.random().toString(36).slice(2, 10);

function request(path, { method = 'GET', headers = {}, host = opts.host, abortAfterMs } = {}) {
    return new Promise((resolve) => {
        const req = http.request({ hostname: base.hostname, port: base.port, path, method, headers: { Host: host, ...headers } }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('latin1') }));
            res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, body: '', aborted: true }));
        });
        req.on('error', (e) => resolve({ status: 0, error: e.code || e.message, body: '' }));
        req.setTimeout(60000, () => req.destroy(new Error('timeout')));
        if (abortAfterMs) setTimeout(() => { req.destroy(); resolve({ status: 0, aborted: true, body: '' }); }, abortAfterMs);
        req.end();
    });
}
const proxy = (target, extra = {}) => request(`/proxy?t=${opts.token}&url=${encodeURIComponent(target)}`, extra);
const status = () => request(`/status?t=${opts.token}`).then((r) => JSON.parse(r.body));
// O httpbin só aceita o alfabeto base64 padrão, e "/" quebraria o caminho: os casos evitam + e /.
const b64 = (buf) => {
    const out = Buffer.from(buf).toString('base64');
    if (/[+/]/.test(out)) throw new Error('caso gera base64 com + ou /: ' + out);
    return out;
};
const httpbinBytes = (buf) => `https://httpbin.org/base64/${b64(buf)}`;

const results = [];
async function check(name, fn) {
    let ok = false;
    let detail;
    try {
        [ok, detail] = await fn();
    } catch (e) {
        detail = 'exceção: ' + e.message;
    }
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`);
}

// 1. Credenciais e redirecionamentos (achado 1 da revisão).
const auth = { headers: { Authorization: 'Bearer ' + SECRET } };
await check('Authorization não segue redirect para outro host (httpbin → postman-echo)', async () => {
    const r = await proxy('https://httpbin.org/redirect-to?url=' + encodeURIComponent('https://postman-echo.com/headers'), auth);
    return [r.status === 200 && r.body.includes('postman-echo.com') && !r.body.includes(SECRET), `http=${r.status} segundo host recebeu o segredo: ${r.body.includes(SECRET)}`];
});
await check('Authorization segue redirect no mesmo host (httpbin → httpbin)', async () => {
    const r = await proxy('https://httpbin.org/redirect-to?url=' + encodeURIComponent('https://httpbin.org/headers'), auth);
    return [r.status === 200 && r.body.includes(SECRET), `http=${r.status} segredo presente: ${r.body.includes(SECRET)}`];
});
await check('Authorization chega ao host pedido, sem redirect (postman-echo)', async () => {
    const r = await proxy('https://postman-echo.com/headers', auth);
    return [r.status === 200 && r.body.includes(SECRET), `http=${r.status}`];
});

// 2. /status, token e Host (achado 2).
await check('/status sem token → 403', async () => {
    const r = await request('/status');
    return [r.status === 403, `http=${r.status}`];
});
await check('/status com token → 200, sem recent nem pid', async () => {
    const r = await request(`/status?t=${opts.token}`);
    const j = JSON.parse(r.body);
    return [r.status === 200 && !('recent' in j) && !('pid' in j) && !('log' in j), `http=${r.status} chaves=${Object.keys(j).join(',')}`];
});
await check('Host arbitrário (rebinding) → 403 em /status e /proxy', async () => {
    const a = await request(`/status?t=${opts.token}`, { host: 'evil.example:47443' });
    const b = await proxy('https://images.metahub.space/poster/medium/tt0111161/img', { host: 'evil.example:47443' });
    return [a.status === 403 && b.status === 403, `status=${a.status} proxy=${b.status}`];
});
await check('localhost:<porta> aceito', async () => {
    const r = await request(`/status?t=${opts.token}`, { host: 'localhost:47443' });
    return [r.status === 200, `http=${r.status}`];
});
await check('/proxy sem token → 403', async () => {
    const r = await request('/proxy?url=' + encodeURIComponent('https://example.com/'));
    return [r.status === 403, `http=${r.status}`];
});
await check('alvo http:// → 400', async () => {
    const r = await proxy('http://images.metahub.space/poster/medium/tt0111161/img');
    return [r.status === 400, `http=${r.status}`];
});
await check('Range → 403', async () => {
    const r = await proxy('https://images.metahub.space/poster/medium/tt0111161/img', { headers: { Range: 'bytes=0-100' } });
    return [r.status === 403, `http=${r.status}`];
});

// 3. Mídia por assinatura, com Content-Type que não é de mídia (achado 3).
const pad = (buf, n) => Buffer.concat([Buffer.from(buf), Buffer.alloc(Math.max(0, n - buf.length), 0x20)]);
const ts = Buffer.alloc(400, 0x00);
ts[0] = ts[188] = ts[376] = 0x47;
const sniffCases = [
    ['ftyp isom (mp4) como text/html', pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')]), 64), true],
    ['EBML (mkv/webm) como text/html', pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0, 0, 0]), 64), true],
    ['MPEG-TS (0x47 a cada 188) como text/html', ts, true],
    ['#EXTM3U como text/html', Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nseg0.ts\n'), true],
    ['DASH <MPD> como text/html', Buffer.from('<MPD type="static" minBufferTime="PT2S"></MPD> '), true],
    ['controle: ftyp avif (imagem) passa', pad(Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif')]), 64), false],
    ['controle: texto comum passa', Buffer.from('{"ok":true,"text":"nada de midia aqui"}'), false],
];
for (const [name, buf, refuse] of sniffCases) {
    await check(`assinatura: ${name}`, async () => {
        const r = await proxy(httpbinBytes(buf));
        const pass = refuse ? r.status === 403 && /media container/.test(r.body) : r.status === 200;
        return [pass, `http=${r.status} ${r.body.slice(0, 70).replace(/[^\x20-\x7e]/g, '.')}`];
    });
}
await check('mp4 real servido como application/octet-stream (5,5 MB) → 403', async () => {
    const r = await proxy('https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4');
    return [r.status === 403, `http=${r.status} ${r.body.slice(0, 90)}`];
});

// 4. HEAD e aborto do cliente (achado 4).
await check('HEAD de imagem mantém o Content-Length do recurso', async () => {
    const r = await proxy('https://images.metahub.space/poster/medium/tt0111161/img', { method: 'HEAD' });
    return [r.status === 200 && Number(r.headers['content-length']) > 1000, `http=${r.status} content-length=${r.headers['content-length']}`];
});
await check('cliente abortado cancela o upstream', async () => {
    const before = (await status()).stats.upstreamAborted;
    await proxy('https://httpbin.org/drip?duration=8&numbytes=8&delay=0', { abortAfterMs: 2500 });
    await new Promise((r) => setTimeout(r, 1500));
    const after = (await status()).stats.upstreamAborted;
    return [after > before, `upstreamAborted ${before} → ${after}`];
});

// 5. TLS continua validado e tlsErrors indexado por código.
await check('certificado expirado → 502', async () => {
    const r = await proxy('https://expired.badssl.com/');
    return [r.status === 502, `http=${r.status} ${r.body}`];
});
await check('nome errado no certificado → 502', async () => {
    const r = await proxy('https://wrong.host.badssl.com/');
    return [r.status === 502, `http=${r.status} ${r.body}`];
});
await check('tlsErrors indexado só por err.code', async () => {
    const keys = Object.keys((await status()).stats.tlsErrors);
    return [keys.length > 0 && keys.every((k) => /^[A-Z0-9_]+$/.test(k)), `chaves=${keys.join(',')}`];
});

// 6. O caminho feliz continua de pé.
await check('pôster metahub (LE) → 200 image/jpeg', async () => {
    const r = await proxy('https://images.metahub.space/poster/medium/tt0111161/img');
    return [r.status === 200 && /^image\//.test(r.headers['content-type'] || '') && r.body.length > 1000, `http=${r.status} ${r.headers['content-type']} ${r.body.length} bytes`];
});
await check('debrid-link API (LE) → 200 JSON', async () => {
    const r = await proxy('https://debrid-link.com/api/v2/downloader/domains');
    return [r.status === 200 && /"success":true/.test(r.body), `http=${r.status}`];
});

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} PASS`);
if (opts.out) fs.writeFileSync(opts.out, JSON.stringify({ at: new Date().toISOString(), base: opts.base, results }, null, 2));
process.exit(failed ? 1 : 0);
