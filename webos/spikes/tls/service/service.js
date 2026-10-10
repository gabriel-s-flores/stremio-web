// Serviço JS do webOS TV 4.x (Node v0.12.2, só ES5) que faz proxy HTTPS local para hosts com
// certificado Let's Encrypt, que o Chromium 53 da TV recusa (net::ERR_INSECURE_RESPONSE).
//
// O app chama luna://<id>/start com subscribe:true (a assinatura mantém o serviço vivo) e recebe
// { port, token }. Depois usa http://127.0.0.1:<port>/proxy?t=<token>&url=<https://…> em <img> e
// fetch. O serviço confia nas raízes padrão do Node e também nas raízes ISRG embutidas (ca.js).
//
// Limites (premissa P3): nada de mídia. Requisições com Range, respostas video/* ou audio/* e
// corpos acima de MAX_BYTES são recusados; os streams do debrid vão direto ao pipeline nativo.
'use strict';

var http = require('http');
var https = require('https');
var tls = require('tls');
var url = require('url');
var crypto = require('crypto');
var Service = require('webos-service');
var ISRG_ROOTS = require('./ca');

var SERVICE_ID = 'io.github.gabrielsflores.webostls.service';
var PORT = 47443;
var MAX_BYTES = 16 * 1024 * 1024;
var MAX_IMAGE_BYTES = 4 * 1024 * 1024;
var UPSTREAM_TIMEOUT_MS = 20000;
var MAX_REDIRECTS = 5;
var FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'authorization', 'content-type', 'content-length',
    'if-none-match', 'if-modified-since', 'user-agent'];
var FORWARD_RESPONSE_HEADERS = ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified',
    'expires', 'www-authenticate'];

var service = new Service(SERVICE_ID);
var token = crypto.randomBytes(16).toString('hex');
var server = null;
var listening = false;
var listenError = null;
var startedAt = Date.now();
var stats = { requests: 0, ok: 0, errors: 0, refused: 0, clientAborted: 0, bytes: 0, tlsErrors: {} };
var recent = [];
var subscribers = {};
var keepAlive = null;

// Estratégia de confiança: adiciona as raízes ISRG ao repositório de raízes do processo, para
// que todo https.request do serviço confie nelas além das raízes padrão do Node. O Node 0.12 não
// tem API pública para isso: createSecureContext() sem `ca` carrega as raízes padrão no
// repositório compartilhado, e addCACert() acrescenta nele. Sem esse caminho, cai para `ca`
// explícito só com ISRG (vale apenas para hosts Let's Encrypt).
var trust = (function () {
    try {
        var ctx = tls.createSecureContext({});
        if (ctx && ctx.context && typeof ctx.context.addCACert === 'function') {
            ISRG_ROOTS.forEach(function (pem) { ctx.context.addCACert(pem); });
            return { strategy: 'merged-root-store', agentCa: null };
        }
    } catch (e) {
        return { strategy: 'isrg-only', agentCa: ISRG_ROOTS, error: String(e) };
    }
    return { strategy: 'isrg-only', agentCa: ISRG_ROOTS };
})();

var agentOptions = { keepAlive: true, maxSockets: 6, maxFreeSockets: 6 };
if (trust.agentCa) agentOptions.ca = trust.agentCa;
var agent = new https.Agent(agentOptions);

function log(msg) {
    console.log('[tls-proxy] ' + msg);
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, ETag, X-Proxy-Upstream-Ms');
}

function fail(res, status, reason) {
    if (res.headersSent) { res.destroy(); return; }
    setCors(res);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: reason }));
}

function proxiedUrl(target) {
    return 'http://127.0.0.1:' + PORT + '/proxy?t=' + token + '&url=' + encodeURIComponent(target);
}

function isMedia(contentType) {
    return /^(video|audio)\//i.test(contentType || '') || /mpegurl|dash\+xml/i.test(contentType || '');
}

function status() {
    var mem = process.memoryUsage();
    return {
        port: PORT,
        listening: listening,
        listenError: listenError,
        strategy: trust.strategy,
        node: process.version,
        openssl: process.versions.openssl,
        pid: process.pid,
        uptimeMs: Date.now() - startedAt,
        recent: recent,
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        stats: stats
    };
}

function debugStream(req) {
    return /[?&]_stream=1(&|$)/.test(req.url);
}

function forward(req, res, target, redirects) {
    var t = url.parse(target);
    var headers = {};
    FORWARD_REQUEST_HEADERS.forEach(function (name) {
        if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    });
    var t0 = Date.now();
    var upstream = https.request({
        protocol: 'https:',
        hostname: t.hostname,
        port: t.port || 443,
        path: t.path,
        method: req.method,
        headers: headers,
        agent: agent
    }, function (up) {
        var type = up.headers['content-type'];
        var length = Number(up.headers['content-length'] || 0);
        if (isMedia(type) || length > MAX_BYTES) {
            stats.refused++;
            up.destroy();
            fail(res, 403, 'media or oversized body is not proxied: ' + (type || '?') + ' ' + length);
            return;
        }
        // Redirecionamentos para https são seguidos aqui (GET/HEAD), para o navegador nunca
        // receber um Location que aponte de volta para um host Let's Encrypt.
        if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
            var next = url.resolve(target, up.headers.location);
            up.resume();
            if ((req.method === 'GET' || req.method === 'HEAD') && redirects < MAX_REDIRECTS && /^https:/i.test(next)) {
                forward(req, res, next, redirects + 1);
                return;
            }
            setCors(res);
            res.writeHead(up.statusCode, { Location: /^https:/i.test(next) ? proxiedUrl(next) : next });
            res.end();
            return;
        }
        setCors(res);
        FORWARD_RESPONSE_HEADERS.forEach(function (name) {
            if (up.headers[name] !== undefined) res.setHeader(name, up.headers[name]);
        });
        res.setHeader('X-Proxy-Upstream-Ms', String(Date.now() - t0));
        var entry = res.trackEntry || {};
        entry.chunks = [];
        // Imagens são juntadas e enviadas numa escrita só. Repassar os pedaços com as fronteiras
        // dos registros TLS do upstream fez o <img> do Chromium 53 falhar de forma intermitente
        // (onerror com o corpo íntegro), ver DECISAO.md. ?_stream=1 força o repasse (só para A/B).
        var buffered = /^image\//i.test(type || '') && length <= MAX_IMAGE_BYTES && !debugStream(req);
        entry.mode = buffered ? 'buffer' : 'stream';
        var parts = [];
        var bytes = 0;
        if (!buffered) res.writeHead(up.statusCode);
        up.on('data', function (chunk) {
            bytes += chunk.length;
            if (entry.chunks.length < 16) entry.chunks.push(chunk.length);
            if (bytes > (buffered ? MAX_IMAGE_BYTES : MAX_BYTES)) {
                stats.refused++;
                up.destroy();
                res.destroy();
                return;
            }
            if (buffered) parts.push(chunk); else res.write(chunk);
        });
        up.on('end', function () {
            stats.ok++;
            stats.bytes += bytes;
            if (!buffered) { res.end(); return; }
            var body = Buffer.concat(parts, bytes);
            res.setHeader('Content-Length', String(body.length));
            res.writeHead(up.statusCode);
            res.end(body);
        });
    });
    upstream.setTimeout(UPSTREAM_TIMEOUT_MS, function () {
        upstream.abort();
    });
    upstream.on('error', function (err) {
        stats.errors++;
        var code = err.code || err.message;
        if (/CERT|SELF_SIGNED|ISSUER|VERIFY|SSL|TLS/i.test(code)) stats.tlsErrors[code] = (stats.tlsErrors[code] || 0) + 1;
        log('upstream ' + t.hostname + ': ' + code);
        fail(res, 502, 'upstream: ' + code);
    });
    if (redirects === 0) req.pipe(upstream); else upstream.end();
}

// Últimas requisições (diagnóstico do spike): host, status, tempo total e se o cliente abortou.
function track(req, res) {
    var t0 = Date.now();
    var entry = { at: t0 - startedAt, method: req.method, path: req.url.replace(/([?&]t=)[0-9a-f]+/, '$1…').slice(0, 120) };
    res.trackEntry = entry;
    recent.push(entry);
    if (recent.length > 60) recent.shift();
    res.on('finish', function () { entry.status = res.statusCode; entry.ms = Date.now() - t0; });
    res.on('close', function () {
        if (entry.status !== undefined) return;
        entry.aborted = true;
        entry.ms = Date.now() - t0;
        stats.clientAborted++;
    });
}

function handle(req, res) {
    stats.requests++;
    track(req, res);
    var u = url.parse(req.url, true);
    if (req.method === 'OPTIONS') {
        setCors(res);
        res.writeHead(204);
        res.end();
        return;
    }
    if (u.pathname === '/status') {
        setCors(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status()));
        return;
    }
    if (u.pathname !== '/proxy') return fail(res, 404, 'not found');
    if (u.query.t !== token) return fail(res, 403, 'bad token');
    var target = u.query.url;
    if (typeof target !== 'string' || !/^https:\/\/[^/]+/i.test(target)) return fail(res, 400, 'url must be https');
    if (req.headers.range) {
        stats.refused++;
        return fail(res, 403, 'range requests are not proxied (no media streaming)');
    }
    forward(req, res, target, 0);
}

function ensureServer() {
    if (server) return;
    server = http.createServer(handle);
    server.on('error', function (err) {
        listenError = err.code || String(err);
        log('listen error: ' + listenError);
    });
    server.listen(PORT, '127.0.0.1', function () {
        listening = true;
        listenError = null;
        log('listening on 127.0.0.1:' + PORT + ' (' + trust.strategy + ', ' + process.version + ')');
    });
    // O serviço é encerrado pelo sistema quando fica ocioso; a atividade o mantém de pé enquanto
    // o app estiver assinado (a assinatura de /start também conta).
    if (!keepAlive && service.activityManager && typeof service.activityManager.create === 'function') {
        service.activityManager.create('tls-proxy-keepalive', function (activity) {
            keepAlive = activity;
        });
    }
}

service.register('start', function (message) {
    ensureServer();
    var reply = function () {
        message.respond({ returnValue: true, port: PORT, token: token, listening: listening, listenError: listenError, strategy: trust.strategy, node: process.version });
    };
    if (message.isSubscription) {
        subscribers[message.uniqueToken] = message;
    }
    if (listening || listenError) reply();
    else server.once('listening', reply);
}, function (message) {
    delete subscribers[message.uniqueToken];
});

service.register('status', function (message) {
    var s = status();
    s.returnValue = true;
    message.respond(s);
});
