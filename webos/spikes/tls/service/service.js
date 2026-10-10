// Serviço JS do webOS TV 4.x (Node v0.12.2, só ES5) que faz proxy HTTPS local para hosts com
// certificado Let's Encrypt, que o Chromium 53 da TV recusa (net::ERR_INSECURE_RESPONSE).
//
// O app chama luna://<id>/start com subscribe:true (a assinatura mantém o serviço vivo) e recebe
// { port, token }. Depois usa http://127.0.0.1:<port>/proxy?t=<token>&url=<https://…> em <img> e
// fetch. O serviço confia nas raízes padrão do Node e também nas raízes ISRG embutidas (ca.js).
//
// Limites (premissa P3): nada de mídia. Requisições com Range, respostas video/* ou audio/*,
// corpos que começam com assinatura de contêiner de mídia e corpos acima dos limites são
// recusados; os streams do debrid vão direto ao pipeline nativo.
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
var ALLOWED_HOSTS = ['127.0.0.1:' + PORT, 'localhost:' + PORT];
var MAX_BYTES = 16 * 1024 * 1024;
var MAX_IMAGE_BYTES = 4 * 1024 * 1024;
var MAX_GENERIC_BINARY_BYTES = 2 * 1024 * 1024;
var SNIFF_BYTES = 512;
var UPSTREAM_TIMEOUT_MS = 20000;
var MAX_REDIRECTS = 5;
var FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'authorization', 'content-type', 'content-length',
    'if-none-match', 'if-modified-since', 'user-agent'];
// Cabeçalhos com credenciais: só vão ao host pedido pelo app, nunca a outro host de um redirect.
var CREDENTIAL_HEADERS = ['authorization'];
var FORWARD_RESPONSE_HEADERS = ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified',
    'expires', 'www-authenticate'];
// Marcas `ftyp` de imagem (AVIF/HEIF) que não são vídeo.
var IMAGE_FTYP_BRANDS = ['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1'];

var service = new Service(SERVICE_ID);
var token = crypto.randomBytes(16).toString('hex');
var server = null;
var listening = false;
var listenError = null;
var startedAt = Date.now();
var stats = { requests: 0, ok: 0, errors: 0, refused: 0, clientAborted: 0, upstreamAborted: 0,
    credentialsStripped: 0, badHost: 0, bytes: 0, tlsErrors: {} };
var logLines = [];
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

// O console do serviço não chega a /var/log/messages no emulador; as últimas linhas ficam em
// memória e saem pelo método Luna `status` (restrito ao próprio app).
function log(msg) {
    var line = new Date().toISOString() + ' [tls-proxy] ' + msg;
    logLines.push(line);
    if (logLines.length > 100) logLines.shift();
    console.log(line);
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, ETag, X-Proxy-Upstream-Ms');
}

// Resposta final já decidida: erros que o upstream emitir depois (ex.: ao ser destruído numa
// recusa) não podem mais mexer nela.
function fail(res, status, reason) {
    if (res.clientGone || res.proxyDone) return;
    res.proxyDone = true;
    if (res.headersSent) { res.destroy(); return; }
    // Descarta os cabeçalhos já copiados do upstream (Content-Length dele não vale para este corpo).
    FORWARD_RESPONSE_HEADERS.concat(['x-proxy-upstream-ms']).forEach(function (name) { res.removeHeader(name); });
    var body = JSON.stringify({ error: reason });
    setCors(res);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

function proxiedUrl(target) {
    return 'http://127.0.0.1:' + PORT + '/proxy?t=' + token + '&url=' + encodeURIComponent(target);
}

function isMediaType(contentType) {
    return /^(video|audio)\//i.test(contentType || '') || /mpegurl|dash\+xml/i.test(contentType || '');
}

function isGenericBinary(contentType) {
    return !contentType || /^(application|binary)\/octet-stream/i.test(contentType);
}

// Assinatura de contêiner de mídia nos primeiros bytes do corpo, independente do Content-Type.
function mediaSignature(buf) {
    var ascii = buf.toString('binary', 0, Math.min(buf.length, SNIFF_BYTES));
    if (buf.length >= 12 && ascii.substr(4, 4) === 'ftyp' && IMAGE_FTYP_BRANDS.indexOf(ascii.substr(8, 4)) === -1) return 'mp4/mov (ftyp ' + ascii.substr(8, 4) + ')';
    if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'matroska/webm (EBML)';
    if (buf.length > 188 && buf[0] === 0x47 && buf[188] === 0x47 && (buf.length <= 376 || buf[376] === 0x47)) return 'mpeg-ts';
    if (/^(\xef\xbb\xbf)?\s*#EXTM3U/.test(ascii)) return 'hls (#EXTM3U)';
    if (/<MPD[\s>]/.test(ascii)) return 'dash (MPD)';
    if (ascii.substr(0, 4) === 'OggS') return 'ogg';
    if (ascii.substr(0, 4) === 'fLaC') return 'flac';
    if (ascii.substr(0, 3) === 'ID3') return 'mp3 (ID3)';
    if (ascii.substr(0, 3) === 'FLV') return 'flv';
    if (ascii.substr(0, 4) === 'RIFF' && /^(AVI |WAVE)$/.test(ascii.substr(8, 4))) return 'riff ' + ascii.substr(8, 4).trim();
    if (ascii.substr(0, 4) === '.RMF') return 'realmedia';
    return null;
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
        uptimeMs: Date.now() - startedAt,
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        stats: stats
    };
}

function debugStream(req) {
    return /[?&]_stream=1(&|$)/.test(req.url);
}

function forward(req, res, target, redirects, originHost) {
    var t = url.parse(target);
    var host = (t.host || '').toLowerCase();
    var headers = {};
    FORWARD_REQUEST_HEADERS.forEach(function (name) {
        if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    });
    // Num redirect para outro host (ou porta), as credenciais do app não seguem, como no navegador.
    if (host !== originHost) {
        CREDENTIAL_HEADERS.forEach(function (name) {
            if (headers[name] !== undefined) {
                delete headers[name];
                stats.credentialsStripped++;
                log('redirect ' + originHost + ' -> ' + host + ': ' + name + ' removido');
            }
        });
    }
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
        var limit = /^image\//i.test(type || '') ? MAX_IMAGE_BYTES : isGenericBinary(type) ? MAX_GENERIC_BINARY_BYTES : MAX_BYTES;
        if (isMediaType(type) || length > limit) {
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
                forward(req, res, next, redirects + 1, originHost);
                return;
            }
            res.proxyDone = true;
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
        // Sem corpo: repassa os cabeçalhos (o Content-Length do HEAD é o do recurso).
        if (req.method === 'HEAD' || up.statusCode === 204 || up.statusCode === 304) {
            up.resume();
            res.proxyDone = true;
            res.writeHead(up.statusCode);
            res.end();
            stats.ok++;
            return;
        }
        // Imagens são juntadas e enviadas numa escrita só. Repassar os pedaços com as fronteiras
        // dos registros TLS do upstream fez o <img> do Chromium 53 falhar de forma intermitente
        // (onerror com o corpo íntegro), ver DECISAO.md. ?_stream=1 força o repasse (só para A/B).
        var buffered = /^image\//i.test(type || '') && !debugStream(req);
        // Os cabeçalhos só saem depois de inspecionar os primeiros SNIFF_BYTES do corpo.
        var head = [];
        var headBytes = 0;
        var sniffed = false;
        var refused = false;
        var parts = [];
        var bytes = 0;
        function passSniff() {
            var first = Buffer.concat(head, headBytes);
            var sig = mediaSignature(first);
            if (sig) {
                refused = true;
                stats.refused++;
                up.destroy();
                log('mídia recusada (' + sig + ') de ' + host);
                fail(res, 403, 'media container is not proxied: ' + sig);
                return false;
            }
            sniffed = true;
            if (buffered) parts.push(first);
            else {
                res.writeHead(up.statusCode);
                res.write(first);
            }
            return true;
        }
        up.on('data', function (chunk) {
            if (refused) return;
            bytes += chunk.length;
            if (bytes > limit) {
                refused = true;
                stats.refused++;
                up.destroy();
                fail(res, 403, 'body over ' + limit + ' bytes is not proxied');
                return;
            }
            if (!sniffed) {
                head.push(chunk);
                headBytes += chunk.length;
                if (headBytes >= SNIFF_BYTES) passSniff();
                return;
            }
            if (buffered) parts.push(chunk); else res.write(chunk);
        });
        up.on('end', function () {
            if (refused || res.clientGone) return;
            if (!sniffed && !passSniff()) return;
            res.proxyDone = true;
            stats.ok++;
            stats.bytes += bytes;
            if (!buffered) { res.end(); return; }
            var body = Buffer.concat(parts, bytes);
            res.setHeader('Content-Length', String(body.length));
            res.writeHead(up.statusCode);
            res.end(body);
        });
    });
    res.upstream = upstream;
    upstream.setTimeout(UPSTREAM_TIMEOUT_MS, function () {
        upstream.abort();
    });
    upstream.on('error', function (err) {
        if (res.clientGone || res.proxyDone) return;
        stats.errors++;
        // O Node 0.12 não põe code no erro de nome de host; a mensagem (que traz o host) não vira chave.
        var code = err.code || (/altnames/i.test(err.message || '') ? 'ERR_TLS_CERT_ALTNAME_INVALID' : 'UNKNOWN');
        if (/CERT|SELF_SIGNED|ISSUER|VERIFY|SSL|TLS|HOSTNAME|ALTNAME/i.test(code + ' ' + err.message)) stats.tlsErrors[code] = (stats.tlsErrors[code] || 0) + 1;
        log('upstream ' + host + ': ' + code);
        fail(res, 502, 'upstream: ' + code);
    });
    if (redirects === 0) req.pipe(upstream); else upstream.end();
}

function handle(req, res) {
    stats.requests++;
    // Cliente desistiu (ex.: pôster que saiu da tela): cancela o download no upstream.
    res.on('close', function () {
        if (res.clientGone || res.finished) return;
        res.clientGone = true;
        stats.clientAborted++;
        if (res.upstream) {
            stats.upstreamAborted++;
            res.upstream.abort();
        }
    });
    // Contra DNS rebinding: só aceita o Host do próprio endereço local.
    if (ALLOWED_HOSTS.indexOf(String(req.headers.host || '').toLowerCase()) === -1) {
        stats.badHost++;
        return fail(res, 403, 'bad host');
    }
    var u = url.parse(req.url, true);
    if (req.method === 'OPTIONS') {
        setCors(res);
        res.writeHead(204);
        res.end();
        return;
    }
    if (u.pathname !== '/proxy' && u.pathname !== '/status') return fail(res, 404, 'not found');
    if (u.query.t !== token) return fail(res, 403, 'bad token');
    if (u.pathname === '/status') {
        setCors(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status()));
        return;
    }
    var target = u.query.url;
    if (typeof target !== 'string' || !/^https:\/\/[^/]+/i.test(target)) return fail(res, 400, 'url must be https');
    if (req.headers.range) {
        stats.refused++;
        return fail(res, 403, 'range requests are not proxied (no media streaming)');
    }
    forward(req, res, target, 0, (url.parse(target).host || '').toLowerCase());
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
        log('listening on 127.0.0.1:' + PORT + ' (' + trust.strategy + ', ' + process.version + ', OpenSSL ' + process.versions.openssl + ')');
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

// Diagnóstico completo (inclui o log) só pela Luna, que o sistema restringe ao próprio app.
service.register('status', function (message) {
    var s = status();
    s.pid = process.pid;
    s.log = logLines;
    s.returnValue = true;
    message.respond(s);
});
