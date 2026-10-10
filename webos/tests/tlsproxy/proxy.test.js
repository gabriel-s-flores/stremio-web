/**
 * @jest-environment node
 */
// webos/tlsproxy/service/proxy.js on the host Node, against local HTTPS upstreams signed by a test
// CA (fixtures/). Two upstreams, A (127.0.0.1:<a>) and B (localhost:<b>), are different hosts for
// the proxy, which compares host:port. The same cases run against the real service in the
// emulator with webos/tlsproxy/security-test.mjs (Node 0.12, public hosts, Chromium 53 fetch).

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const { createProxy, mediaSignature, MAX_REDIRECTS } = require('../../tlsproxy/service/proxy');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (file) => fs.readFileSync(path.join(FIXTURES, file));
const TOKEN = 'f37test';
const SECRET = 'Bearer F37-SECRET';

const servers = [];
const seen = [];

// Upstream routes: /echo, /redirect?to=&status=, /bytes?hex=&type=, /sized?len=&type=&declared=,
// /stall?type=, /truncate?type=, /drip.
const route = (name) => (req, res) => {
    const u = new URL(req.url, 'https://upstream');
    const q = Object.fromEntries(u.searchParams);
    seen.push({ upstream: name, method: req.method, path: u.pathname, auth: req.headers.authorization || null });
    const body = (type, buf, extra = {}) => {
        res.writeHead(Number(q.code || 200), { 'Content-Type': type, 'Content-Length': buf.length, ...extra });
        res.end(req.method === 'HEAD' ? undefined : buf);
    };
    switch (u.pathname) {
        case '/echo':
            return body('application/json', Buffer.from(JSON.stringify({ upstream: name, auth: req.headers.authorization || null })));
        case '/redirect':
            res.writeHead(Number(q.status || 302), { Location: q.to });
            return res.end();
        case '/bytes':
            return body(q.type || 'text/html', Buffer.from(q.hex, 'hex'));
        case '/sized': {
            const len = Number(q.len);
            if (q.declared === '0') {
                res.writeHead(200, { 'Content-Type': q.type });
                for (let sent = 0; sent < len; sent += 65536) res.write(Buffer.alloc(Math.min(65536, len - sent), 0x20));
                return res.end();
            }
            return body(q.type, Buffer.alloc(len, 0x20));
        }
        case '/stall':
            res.writeHead(200, { 'Content-Type': q.type, 'Content-Length': 2000 });
            return res.write(Buffer.alloc(1000, 0x20));
        case '/truncate':
            res.writeHead(200, { 'Content-Type': q.type, 'Content-Length': 2000 });
            res.write(Buffer.alloc(1000, 0x20));
            return setTimeout(() => res.socket.destroy(), 50);
        case '/drip': {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            const timer = setInterval(() => res.write('.'), 50);
            return res.on('close', () => clearInterval(timer));
        }
        default:
            res.writeHead(404);
            return res.end();
    }
};

const listen = (server, host = '127.0.0.1') => new Promise((resolve) => {
    servers.push(server);
    server.listen(0, host, () => resolve(server.address().port));
});

let A;
let B;
let rogue;
let proxy;
let proxyPort;
let logs;

beforeAll(async () => {
    const tlsOptions = { key: read('leaf.key'), cert: read('leaf.pem') };
    A = `https://127.0.0.1:${await listen(https.createServer(tlsOptions, route('A')))}`;
    B = `https://localhost:${await listen(https.createServer(tlsOptions, route('B')))}`;
    rogue = `https://127.0.0.1:${await listen(https.createServer({ key: read('rogue.key'), cert: read('rogue.pem') }, route('rogue')))}`;
    logs = [];
    proxy = createProxy({
        token: TOKEN,
        agent: new https.Agent({ ca: read('ca.pem'), keepAlive: true, maxSockets: 6 }),
        log: (msg) => logs.push(msg),
        timeoutMs: 400,
    });
    proxyPort = await new Promise((resolve, reject) => proxy.listen(0, 1, (err, port) => (err ? reject(err) : resolve(port))));
});

afterAll(async () => {
    await new Promise((resolve) => proxy.close(resolve));
    servers.forEach((server) => server.close());
});

beforeEach(() => {
    seen.length = 0;
});

const request = (requestPath, { method = 'GET', headers = {}, host, body, abortAfterMs } = {}) => new Promise((resolve) => {
    const req = http.request({
        hostname: '127.0.0.1',
        port: proxyPort,
        path: requestPath,
        method,
        agent: false,
        headers: { Host: host || `127.0.0.1:${proxyPort}`, ...headers },
    }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('latin1') }));
        res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, broken: true, body: Buffer.concat(chunks).toString('latin1') }));
        res.on('aborted', () => resolve({ status: res.statusCode, headers: res.headers, broken: true, body: Buffer.concat(chunks).toString('latin1') }));
    });
    req.on('error', (error) => resolve({ status: 0, error: error.code || error.message, broken: true, body: '' }));
    if (abortAfterMs) setTimeout(() => { req.destroy(); resolve({ status: 0, aborted: true, body: '' }); }, abortAfterMs);
    req.end(body);
});
const viaProxy = (target, options) => request(`/proxy?t=${TOKEN}&url=${encodeURIComponent(target)}`, options);
const redirect = (from, to, status = 302) => `${from}/redirect?status=${status}&to=${encodeURIComponent(to)}`;
const auth = { headers: { Authorization: SECRET } };
const postAuth = { method: 'POST', headers: { Authorization: SECRET, 'Content-Type': 'application/json' }, body: '{"f37":1}' };
const hex = (buf) => Buffer.from(buf).toString('hex');
const bytes = (buf, type = 'text/html') => `${A}/bytes?type=${encodeURIComponent(type)}&hex=${hex(buf)}`;
const pad = (buf, n = 64) => Buffer.concat([Buffer.from(buf), Buffer.alloc(Math.max(0, n - buf.length), 0x20)]);
const status = async () => JSON.parse((await request(`/status?t=${TOKEN}`)).body);

describe('access', () => {
    test('/proxy and /status need the token', async () => {
        expect((await request('/status')).status).toBe(403);
        expect((await request(`/proxy?url=${encodeURIComponent(`${A}/echo`)}`)).status).toBe(403);
        const ok = await request(`/status?t=${TOKEN}`);
        expect(ok.status).toBe(200);
        expect(Object.keys(JSON.parse(ok.body))).not.toEqual(expect.arrayContaining(['pid']));
        expect(JSON.parse(ok.body)).not.toHaveProperty('log');
    });

    test('Host other than 127.0.0.1:<port> or localhost:<port> is refused (DNS rebinding)', async () => {
        expect((await request(`/status?t=${TOKEN}`, { host: `evil.example:${proxyPort}` })).status).toBe(403);
        expect((await viaProxy(`${A}/echo`, { host: 'evil.example' })).status).toBe(403);
        expect((await request(`/status?t=${TOKEN}`, { host: `localhost:${proxyPort}` })).status).toBe(200);
    });

    test('only GET, HEAD and POST are proxied; OPTIONS answers the preflight', async () => {
        for (const method of ['PUT', 'DELETE', 'PATCH']) {
            expect((await viaProxy(`${A}/echo`, { method })).status).toBe(405);
        }
        const preflight = await viaProxy(`${A}/echo`, { method: 'OPTIONS' });
        expect(preflight.status).toBe(204);
        expect(preflight.headers['access-control-allow-methods']).toBe('GET, HEAD, POST, OPTIONS');
        expect(seen).toHaveLength(0);
    });

    test('only https targets; Range is refused', async () => {
        expect((await viaProxy('http://127.0.0.1/echo')).status).toBe(400);
        expect((await viaProxy(`${A}/echo`, { headers: { Range: 'bytes=0-10' } })).status).toBe(403);
    });

    test('untrusted upstream certificate: 502, tlsErrors keyed by code only', async () => {
        const r = await viaProxy(`${rogue}/echo`);
        expect(r.status).toBe(502);
        const keys = Object.keys((await status()).stats.tlsErrors);
        expect(keys.length).toBeGreaterThan(0);
        keys.forEach((key) => expect(key).toMatch(/^[A-Z0-9_]+$/));
    });
});

describe('credentials and redirects', () => {
    test('Authorization reaches the requested host', async () => {
        const r = await viaProxy(`${A}/echo`, auth);
        expect(JSON.parse(r.body)).toEqual({ upstream: 'A', auth: SECRET });
    });

    test('followed redirect to another host drops Authorization (A → B)', async () => {
        const r = await viaProxy(redirect(A, `${B}/echo`), auth);
        expect(r.status).toBe(200);
        expect(JSON.parse(r.body)).toEqual({ upstream: 'B', auth: null });
    });

    test('followed redirect on the same host keeps Authorization (A → A)', async () => {
        const r = await viaProxy(redirect(A, `${A}/echo`), auth);
        expect(JSON.parse(r.body)).toEqual({ upstream: 'A', auth: SECRET });
    });

    test('credentials do not come back when the chain returns to the requested host (A → B → A)', async () => {
        const r = await viaProxy(redirect(A, redirect(B, `${A}/echo?chosen-by-B`)), auth);
        expect(r.status).toBe(200);
        expect(JSON.parse(r.body)).toEqual({ upstream: 'A', auth: null });
        expect(seen.filter((s) => s.auth !== null).map((s) => `${s.upstream}${s.path}`)).toEqual(['A/redirect']);
    });

    test('POST 307 to another host is not followed: 502 without Location', async () => {
        const r = await viaProxy(redirect(A, `${B}/echo`, 307), postAuth);
        expect(r.status).toBe(502);
        expect(r.headers.location).toBeUndefined();
        expect(seen.some((s) => s.upstream === 'B')).toBe(false);
    });

    test('POST 307 on the same host returns a Location to the proxy (the client follows it)', async () => {
        const r = await viaProxy(redirect(A, `${A}/echo`, 307), postAuth);
        expect(r.status).toBe(307);
        expect(r.headers.location).toBe(`http://127.0.0.1:${proxyPort}/proxy?t=${TOKEN}&url=${encodeURIComponent(`${A}/echo`)}`);
    });

    test(`chain over ${MAX_REDIRECTS} redirects that left the host and comes back: 502, no Location (A → B… → A)`, async () => {
        let target = `${A}/echo`;
        for (let i = 0; i < MAX_REDIRECTS; i++) target = redirect(B, target);
        const r = await viaProxy(redirect(A, target), auth);
        expect(r.status).toBe(502);
        expect(r.headers.location).toBeUndefined();
        expect(seen.some((s) => s.path === '/echo')).toBe(false);
    });

    test(`chain over ${MAX_REDIRECTS} redirects on the same host: Location to the proxy, same host`, async () => {
        let target = `${A}/echo`;
        for (let i = 0; i <= MAX_REDIRECTS; i++) target = redirect(A, target);
        const r = await viaProxy(target, auth);
        expect(r.status).toBe(302);
        expect(r.headers.location).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${proxyPort}/proxy\\?t=${TOKEN}&url=${encodeURIComponent(A).replace(/[.]/g, '\\.')}`));
    });

    test('redirect to http is not followed', async () => {
        const r = await viaProxy(redirect(A, 'http://127.0.0.1:1/echo'), auth);
        expect(r.status).toBe(502);
        expect(r.headers.location).toBeUndefined();
    });
});

describe('media is never proxied (P3)', () => {
    test.each([
        ['ftyp isom (mp4)', pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')]))],
        ['fMP4 segment (styp)', pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('stypmsdh')]))],
        ['fMP4 fragment (moof)', pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('moof')]))],
        ['DASH index (sidx)', pad(Buffer.concat([Buffer.from([0, 0, 0, 0x2c]), Buffer.from('sidx')]))],
        ['EBML (mkv/webm)', pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 0, 0, 0]))],
        ['AAC ADTS', pad(Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc]))],
        ['MP3 frame without ID3', pad(Buffer.from([0xff, 0xfb, 0x90, 0x64]))],
        ['#EXTM3U', Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n')],
        ['ID3', pad(Buffer.from('ID3\x04\x00'))],
    ])('%s served as text/html → 403', async (_, buf) => {
        const r = await viaProxy(bytes(buf));
        expect(r.status).toBe(403);
        expect(r.body).toMatch(/media container is not proxied/);
    });

    test.each([
        ['JPEG', pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])), 'image/jpeg'],
        ['PNG', pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png'],
        ['AVIF (ftyp avif)', pad(Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif')])), 'image/avif'],
        ['UTF-16LE JSON with BOM', Buffer.from('﻿{"ok":true}', 'utf16le'), 'application/json'],
        ['plain JSON', Buffer.from('{"metas":[]}'), 'application/json'],
    ])('control: %s passes', async (_, buf, type) => {
        const r = await viaProxy(bytes(buf, type));
        expect(r.status).toBe(200);
        expect(Buffer.from(r.body, 'latin1').equals(buf)).toBe(true);
    });

    test('video/* and HLS content types → 403', async () => {
        expect((await viaProxy(bytes(Buffer.from('x'), 'video/mp4'))).status).toBe(403);
        expect((await viaProxy(bytes(Buffer.from('x'), 'application/vnd.apple.mpegurl'))).status).toBe(403);
    });

    test('generic binary over 2 MB → 403 by Content-Length', async () => {
        const r = await viaProxy(`${A}/sized?type=application/octet-stream&len=${2 * 1024 * 1024 + 1}`);
        expect(r.status).toBe(403);
    });

    test('generic binary over 2 MB without Content-Length: the response is cut, not completed', async () => {
        const r = await viaProxy(`${A}/sized?type=application/octet-stream&declared=0&len=${2 * 1024 * 1024 + 70000}`);
        expect(r.status === 403 || r.broken).toBe(true);
    });

    test('mp4 behind a followed redirect → 403', async () => {
        const mp4 = bytes(pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')])), 'application/octet-stream');
        expect((await viaProxy(redirect(A, mp4))).status).toBe(403);
    });

    test('mediaSignature ignores short and empty bodies', () => {
        expect(mediaSignature(Buffer.alloc(0))).toBeNull();
        expect(mediaSignature(Buffer.from([0xff]))).toBeNull();
    });
});

describe('request lifecycle', () => {
    test('the issuer organization of the upstream certificate is exposed', async () => {
        // Earlier tests already handshook with A: these requests reuse a socket or resume the TLS
        // session, where the host Node does not give the peer certificate again.
        for (let i = 0; i < 3; i++) {
            const r = await viaProxy(`${A}/echo`);
            expect(r.headers['x-proxy-issuer-o']).toBe('F37 Test CA');
        }
        const r = await viaProxy(`${B}/echo`);
        expect(r.headers['access-control-expose-headers']).toMatch(/X-Proxy-Issuer-O/);
    });

    test('HEAD keeps the Content-Length of the resource', async () => {
        const r = await viaProxy(bytes(pad(Buffer.from([0xff, 0xd8, 0xff]), 5000), 'image/jpeg'), { method: 'HEAD' });
        expect(r.status).toBe(200);
        expect(r.headers['content-length']).toBe('5000');
        expect(r.body).toBe('');
    });

    test('images are sent in one write with the exact Content-Length', async () => {
        const r = await viaProxy(`${A}/sized?type=image/jpeg&declared=0&len=70000`);
        expect(r.status).toBe(200);
        expect(r.headers['content-length']).toBe('70000');
        expect(r.body).toHaveLength(70000);
    });

    test('upstream timeout in the middle of an image: 504, never a truncated 200', async () => {
        const r = await viaProxy(`${A}/stall?type=image/jpeg`);
        expect(r.status).toBe(504);
    });

    test('upstream timeout in the middle of a streamed body: the connection is cut', async () => {
        const r = await viaProxy(`${A}/stall?type=application/json`);
        expect(r.broken).toBe(true);
    });

    test('upstream closing before Content-Length: 504 for images', async () => {
        const r = await viaProxy(`${A}/truncate?type=image/jpeg`);
        expect(r.status).toBe(504);
        expect((await status()).stats.truncated).toBeGreaterThan(0);
    });

    test('client abort cancels the upstream', async () => {
        const before = (await status()).stats.upstreamAborted;
        await viaProxy(`${A}/drip`, { abortAfterMs: 150 });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect((await status()).stats.upstreamAborted).toBeGreaterThan(before);
    });
});

describe('listen', () => {
    test('falls back to the next free port', async () => {
        const blocker = net.createServer();
        const busy = await listen(blocker);
        const other = createProxy({ token: 'x', agent: https.globalAgent });
        const port = await new Promise((resolve, reject) => other.listen(busy, 5, (err, p) => (err ? reject(err) : resolve(p))));
        expect(port).toBeGreaterThan(busy);
        expect(port).toBeLessThan(busy + 5);
        const r = await new Promise((resolve) => http.get({ hostname: '127.0.0.1', port, path: '/status?t=x', agent: false }, resolve));
        expect(r.statusCode).toBe(200);
        r.resume();
        await new Promise((resolve) => other.close(resolve));
    });

    test('gives up after the last attempt', async () => {
        const blocker = net.createServer();
        const busy = await listen(blocker);
        const other = createProxy({ token: 'x', agent: https.globalAgent });
        const err = await new Promise((resolve) => other.listen(busy, 1, resolve));
        expect(err.code).toBe('EADDRINUSE');
    });
});
