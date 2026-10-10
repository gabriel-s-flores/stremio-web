// Proxy HTTPS local do serviço tlsproxy (Node v0.12.2 na TV, só ES5; roda também no Node do host
// nos testes). Hosts com certificado Let's Encrypt, que o Chromium 53 da TV recusa
// (net::ERR_INSECURE_RESPONSE), são pedidos pelo app como
// http://127.0.0.1:<porta>/proxy?t=<token>&url=<https://…>, em <img> e fetch. Quem confia nas raízes
// ISRG é o agente HTTPS passado em createProxy (service.js).
//
// Limites (premissa P3): nada de mídia. Requisições com Range, respostas video/* ou audio/*,
// corpos que começam com assinatura de contêiner de mídia e corpos acima dos limites são
// recusados; os streams do debrid vão direto ao pipeline nativo.
'use strict';

var http = require('http');
var https = require('https');
var url = require('url');

var MAX_BYTES = 16 * 1024 * 1024;
var MAX_IMAGE_BYTES = 4 * 1024 * 1024;
var MAX_GENERIC_BINARY_BYTES = 2 * 1024 * 1024;
var SNIFF_BYTES = 512;
var UPSTREAM_TIMEOUT_MS = 20000;
var MAX_REDIRECTS = 5;
// O core usa GET (addons) e POST (API); imagens, GET e HEAD.
var ALLOWED_METHODS = ['GET', 'HEAD', 'POST'];
var FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'authorization', 'content-type', 'content-length',
    'if-none-match', 'if-modified-since', 'user-agent'];
// Cabeçalhos com credenciais: só vão ao host pedido pelo app, nunca a outro host de um redirect.
var CREDENTIAL_HEADERS = ['authorization'];
var FORWARD_RESPONSE_HEADERS = ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified',
    'expires', 'www-authenticate'];
// Organização (O) do emissor do certificado do upstream: o app só aprende um host novo para o
// proxy quando o emissor é Let's Encrypt (um TypeError do fetch direto também pode ser CORS).
var ISSUER_HEADER = 'X-Proxy-Issuer-O';
// Marcas `ftyp` de imagem (AVIF/HEIF) que não são vídeo.
var IMAGE_FTYP_BRANDS = ['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1'];
// Caixas ISO BMFF que abrem segmentos fMP4 sem `ftyp` (DASH/HLS/CMAF) ou MP4 com o moov na frente.
var MEDIA_BOXES = ['styp', 'moof', 'sidx', 'moov', 'mdat'];

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
    if (buf.length >= 8 && MEDIA_BOXES.indexOf(ascii.substr(4, 4)) !== -1) return 'iso bmff (' + ascii.substr(4, 4) + ')';
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
    // Sincronismo de quadro MPEG de áudio (11 bits em 1). AAC ADTS: camada 00 (0xFFF0/0xFFF1/0xFFF8/
    // 0xFFF9). MP3 sem ID3: camada ≠ 00, taxa ≠ 1111 e amostragem ≠ 11. Não confunde com JPEG
    // (FF D8), PNG ou com o BOM UTF-16LE (FF FE).
    if (buf.length >= 4 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && buf[1] !== 0xfe) {
        if ((buf[1] & 0xf6) === 0xf0) return 'aac (adts)';
        if ((buf[1] & 0x06) !== 0 && (buf[2] >> 4) !== 0x0f && ((buf[2] >> 2) & 0x03) !== 0x03) return 'mpeg audio (frame sync)';
    }
    return null;
}

function issuerOrganization(socket) {
    try {
        var cert = socket && typeof socket.getPeerCertificate === 'function' ? socket.getPeerCertificate() : null;
        var org = cert && cert.issuer && cert.issuer.O;
        if (Array.isArray(org)) org = org[0];
        return typeof org === 'string' ? org.replace(/[^\x20-\x7e]/g, '?').slice(0, 100) : '';
    } catch (e) {
        return '';
    }
}

// options: token, agent (https.Agent com as raízes), log(msg), timeoutMs (padrão 20 s).
function createProxy(options) {
    var token = options.token;
    var agent = options.agent;
    var log = options.log || function () {};
    var timeoutMs = options.timeoutMs || UPSTREAM_TIMEOUT_MS;
    var server = null;
    var port = null;
    var allowedHosts = [];
    var stats = { requests: 0, ok: 0, errors: 0, refused: 0, clientAborted: 0, upstreamAborted: 0, truncated: 0,
        credentialsStripped: 0, badHost: 0, badMethod: 0, bytes: 0, tlsErrors: {} };

    // Numa sessão TLS retomada o certificado do par pode não vir (no Node do host, com TLS 1.3):
    // o emissor visto no primeiro handshake com o host fica guardado.
    var issuers = {};
    var issuerCount = 0;
    function issuerOf(host, socket) {
        var org = issuerOrganization(socket);
        if (!org) return issuers[host] || '';
        if (issuers[host] === undefined) {
            if (issuerCount >= 256) { issuers = {}; issuerCount = 0; }
            issuerCount++;
        }
        issuers[host] = org;
        return org;
    }

    function setCors(res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', ') + ', OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, ETag, X-Proxy-Upstream-Ms, ' + ISSUER_HEADER);
    }

    // Resposta final já decidida: erros que o upstream emitir depois (ex.: ao ser destruído numa
    // recusa) não podem mais mexer nela. Com os cabeçalhos já enviados, o corpo é cortado
    // (destroy) para o cliente ver a falha em vez de um 200 truncado.
    function fail(res, status, reason) {
        if (res.clientGone || res.proxyDone) return;
        res.proxyDone = true;
        if (res.headersSent) { res.destroy(); return; }
        // Descarta os cabeçalhos já copiados do upstream (Content-Length dele não vale para este corpo).
        FORWARD_RESPONSE_HEADERS.concat(['x-proxy-upstream-ms', ISSUER_HEADER.toLowerCase()]).forEach(function (name) { res.removeHeader(name); });
        var body = JSON.stringify({ error: reason });
        setCors(res);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
    }

    function proxiedUrl(target) {
        return 'http://127.0.0.1:' + port + '/proxy?t=' + token + '&url=' + encodeURIComponent(target);
    }

    // hop: { redirects, originHost, credentialsDropped }. originHost é o host (com a porta) pedido
    // pelo app; credentialsDropped fica ligado depois do primeiro salto para outro host.
    function forward(req, res, target, hop) {
        var t = url.parse(target);
        var host = (t.host || '').toLowerCase();
        var headers = {};
        FORWARD_REQUEST_HEADERS.forEach(function (name) {
            if (req.headers[name] !== undefined) headers[name] = req.headers[name];
        });
        // Num redirect para outro host (ou porta), as credenciais do app não seguem, como no
        // navegador. E, uma vez removidas, não voltam: numa cadeia A → B → A, o caminho do salto
        // de volta é escolhido por B e não pode levar a credencial do app a A.
        var dropped = hop.credentialsDropped || host !== hop.originHost;
        if (dropped) {
            CREDENTIAL_HEADERS.forEach(function (name) {
                if (headers[name] !== undefined) {
                    delete headers[name];
                    stats.credentialsStripped++;
                    log('redirect ' + hop.originHost + ' -> ' + host + ': ' + name + ' removido');
                }
            });
        }
        var t0 = Date.now();
        var timedOut = false;
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
                if ((req.method === 'GET' || req.method === 'HEAD') && hop.redirects < MAX_REDIRECTS && /^https:/i.test(next)) {
                    forward(req, res, next, { redirects: hop.redirects + 1, originHost: hop.originHost, credentialsDropped: dropped });
                    return;
                }
                // Salto não seguido (método com corpo ou cadeia longa): o Location volta ao cliente
                // apontando para o próprio proxy, ou seja, o mesmo origin para o navegador, que o segue
                // reenviando o Authorization. Por isso só se devolve Location para o MESMO host https
                // e só se a cadeia nunca saiu dele; para outro host, fora de https ou depois de passar
                // por outro host (A → B → A), a resposta é um erro, sem Location. Este é o único ponto
                // em que o serviço emite Location: FORWARD_RESPONSE_HEADERS não repassa location,
                // content-location nem refresh do upstream.
                var nextHost = (url.parse(next).host || '').toLowerCase();
                if (!/^https:/i.test(next) || nextHost !== hop.originHost || dropped) {
                    stats.refused++;
                    log('redirect ' + host + ' -> ' + (nextHost || next.split(':')[0]) + ' não seguido (' + req.method + ', salto ' + (hop.redirects + 1) + ')');
                    fail(res, 502, 'cross-host redirect not followed: ' + req.method + ' ' + hop.originHost + ' -> ' + (nextHost || '?') +
                        (dropped ? ' (chain left the requested host)' : '') +
                        (hop.redirects >= MAX_REDIRECTS ? ' (more than ' + MAX_REDIRECTS + ' redirects)' : ''));
                    return;
                }
                res.proxyDone = true;
                setCors(res);
                res.writeHead(up.statusCode, { Location: proxiedUrl(next) });
                res.end();
                return;
            }
            setCors(res);
            FORWARD_RESPONSE_HEADERS.forEach(function (name) {
                if (up.headers[name] !== undefined) res.setHeader(name, up.headers[name]);
            });
            res.setHeader('X-Proxy-Upstream-Ms', String(Date.now() - t0));
            var issuer = issuerOf(host, up.socket);
            if (issuer) res.setHeader(ISSUER_HEADER, issuer);
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
            // (onerror com o corpo íntegro), ver webos/spikes/tls/DECISAO.md.
            var buffered = /^image\//i.test(type || '');
            // Os cabeçalhos só saem depois de inspecionar os primeiros SNIFF_BYTES do corpo.
            var head = [];
            var headBytes = 0;
            var sniffed = false;
            var refused = false;
            var upAborted = false;
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
            // Corpo incompleto: o abort() por timeout no meio do corpo (no Node 0.12 seguido de `end`),
            // o upstream que fecha antes do Content-Length ou um erro no meio. Erro (ou conexão
            // cortada, se os cabeçalhos já saíram) em vez de um 200 truncado.
            function broken(why) {
                if (refused || upAborted || res.clientGone || res.proxyDone) return;
                upAborted = true;
                stats.truncated++;
                log('corpo incompleto de ' + host + ' (' + bytes + '/' + (up.headers['content-length'] || '?') + ', ' + why + ')');
                fail(res, 504, 'upstream body incomplete (' + why + ')');
            }
            up.on('aborted', function () { broken(timedOut ? 'timeout' : 'aborted'); });
            up.on('error', function (err) { broken(timedOut ? 'timeout' : err.code || 'error'); });
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
                if (refused || upAborted || res.clientGone || res.proxyDone) return;
                if (timedOut || (up.headers['content-length'] !== undefined && bytes !== length)) {
                    broken(timedOut ? 'timeout' : 'short body');
                    return;
                }
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
        upstream.setTimeout(timeoutMs, function () {
            timedOut = true;
            upstream.abort();
        });
        upstream.on('error', function (err) {
            if (res.clientGone || res.proxyDone) return;
            stats.errors++;
            // O Node 0.12 não põe code no erro de nome de host; a mensagem (que traz o host) não vira chave.
            var code = err.code || (/altnames/i.test(err.message || '') ? 'ERR_TLS_CERT_ALTNAME_INVALID' : 'UNKNOWN');
            if (/CERT|SELF_SIGNED|ISSUER|VERIFY|SSL|TLS|HOSTNAME|ALTNAME/i.test(code + ' ' + err.message)) stats.tlsErrors[code] = (stats.tlsErrors[code] || 0) + 1;
            log('upstream ' + host + ': ' + code + (timedOut ? ' (timeout)' : ''));
            fail(res, timedOut ? 504 : 502, 'upstream: ' + (timedOut ? 'timeout' : code));
        });
        if (hop.redirects === 0) req.pipe(upstream); else upstream.end();
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
        if (allowedHosts.indexOf(String(req.headers.host || '').toLowerCase()) === -1) {
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
        if (ALLOWED_METHODS.indexOf(req.method) === -1) {
            stats.badMethod++;
            return fail(res, 405, 'method not allowed');
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
        forward(req, res, target, { redirects: 0, originHost: (url.parse(target).host || '').toLowerCase(), credentialsDropped: false });
    }

    // Escuta em 127.0.0.1, na primeira porta livre a partir de firstPort (até `attempts` portas).
    // Um http.Server novo a cada tentativa: reaproveitar o que falhou não é confiável no Node 0.12.
    function listen(firstPort, attempts, callback) {
        var tries = 0;
        function attempt(p) {
            var candidate = http.createServer(handle);
            candidate.once('error', function (err) {
                tries++;
                if (err.code === 'EADDRINUSE' && tries < attempts) {
                    log('porta ' + p + ' ocupada');
                    attempt(p + 1);
                    return;
                }
                callback(err);
            });
            candidate.listen(p, '127.0.0.1', function () {
                server = candidate;
                port = candidate.address().port;
                allowedHosts = ['127.0.0.1:' + port, 'localhost:' + port];
                callback(null, port);
            });
        }
        attempt(firstPort);
    }

    function close(callback) {
        if (server) server.close(callback);
        server = null;
    }

    function status() {
        var mem = process.memoryUsage();
        return {
            port: port,
            uptimeMs: Math.round(process.uptime() * 1000),
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            stats: stats
        };
    }

    return {
        listen: listen,
        close: close,
        status: status,
        stats: stats,
        port: function () { return port; }
    };
}

module.exports = {
    createProxy: createProxy,
    mediaSignature: mediaSignature,
    MAX_REDIRECTS: MAX_REDIRECTS,
    ISSUER_HEADER: ISSUER_HEADER
};
