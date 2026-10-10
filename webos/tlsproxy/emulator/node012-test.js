// proxy.js on the Node v0.12.2 of webOS TV 4.x (ES5), against local HTTPS upstreams signed by the
// test CA of webos/tests/tlsproxy/fixtures. Covers what the public battery (security-test.mjs) cannot:
// an upstream that closes before Content-Length or stalls (the 0.12 http client emits `aborted` and
// then `end`), bodies starting with 0xFF (httpbin only serves UTF-8), and a chain A -> B -> A
// between two hosts under our control. run.sh copies it with proxy.js and the fixtures to the
// emulator and runs it with the system node:
//   node node012-test.js <dir with proxy.js and the fixtures>
// Prints PASS/FAIL per case and exits 1 if any failed.
'use strict';

var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');

var dir = process.argv[2];
var createProxy = require(path.join(dir, 'proxy.js')).createProxy;
var read = function (file) { return fs.readFileSync(path.join(dir, file)); };
var TOKEN = 'node012';
var SECRET = 'Bearer N012-SECRET';
var tls = { key: read('leaf.key'), cert: read('leaf.pem') };
var results = [];
var seen = [];

function route(name) {
    return function (req, res) {
        var u = require('url').parse(req.url, true);
        seen.push({ upstream: name, path: u.pathname, auth: req.headers.authorization || null });
        if (u.pathname === '/echo') {
            var body = JSON.stringify({ upstream: name, auth: req.headers.authorization || null });
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
            return res.end(body);
        }
        if (u.pathname === '/redirect') {
            res.writeHead(302, { Location: u.query.to });
            return res.end();
        }
        if (u.pathname === '/bytes') {
            var buf = new Buffer(u.query.hex, 'hex');
            res.writeHead(200, { 'Content-Type': u.query.type || 'text/html', 'Content-Length': buf.length });
            return res.end(buf);
        }
        if (u.pathname === '/short') {
            // Content-Length 2000, 1000 bytes, then a clean close (FIN) of the connection.
            res.writeHead(200, { 'Content-Type': u.query.type, 'Content-Length': 2000 });
            res.write(new Buffer(1000).fill(0x20));
            return setTimeout(function () { res.socket.end(); }, 50);
        }
        if (u.pathname === '/stall') {
            res.writeHead(200, { 'Content-Type': u.query.type, 'Content-Length': 2000 });
            return res.write(new Buffer(1000).fill(0x20));
        }
        res.writeHead(404);
        res.end();
    };
}

function listen(server, host, cb) {
    server.listen(0, host, function () { cb(server.address().port); });
}

var A, B, proxy, port;

function request(target, opts, cb) {
    opts = opts || {};
    var req = http.request({ hostname: '127.0.0.1', port: port, method: opts.method || 'GET', agent: false,
        path: opts.path || '/proxy?t=' + TOKEN + '&url=' + encodeURIComponent(target),
        headers: (function () { var h = { Host: '127.0.0.1:' + port }; for (var k in (opts.headers || {})) h[k] = opts.headers[k]; return h; })() }, function (res) {
        var chunks = [];
        var done = false;
        var finish = function (broken) {
            if (done) return;
            done = true;
            var body = Buffer.concat(chunks);
            cb({ status: res.statusCode, headers: res.headers, body: body.toString('binary'), length: body.length,
                broken: broken || (res.headers['content-length'] !== undefined && body.length !== Number(res.headers['content-length'])) });
        };
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { finish(false); });
        res.on('aborted', function () { finish(true); });
        res.on('error', function () { finish(true); });
        res.on('close', function () { finish(true); });
    });
    req.on('error', function (e) { cb({ status: 0, error: e.code || String(e), broken: true, body: '' }); });
    req.end();
}

var cases = [];
function check(name, target, opts, verify) { cases.push({ name: name, target: target, opts: opts, verify: verify }); }
function bytes(hex, type) { return A + '/bytes?type=' + encodeURIComponent(type || 'text/html') + '&hex=' + hex; }
function pad(hex) { while (hex.length < 128) hex += '20'; return hex; }
function redirect(from, to) { return from + '/redirect?to=' + encodeURIComponent(to); }

function defineCases() {
    check('corpo curto (FIN antes do Content-Length) numa imagem → 504, nunca 200', function () { return A + '/short?type=image/jpeg'; }, {},
        function (r) { return [r.status === 504 && proxy.stats.truncated > 0, 'http=' + r.status + ' truncated=' + proxy.stats.truncated]; });
    check('corpo curto num corpo repassado (JSON) → conexão cortada', function () { return A + '/short?type=application/json'; }, {},
        function (r) { return [r.broken === true, 'http=' + r.status + ' bytes=' + r.length + ' cortado=' + r.broken]; });
    check('timeout no meio de uma imagem → 504', function () { return A + '/stall?type=image/jpeg'; }, {},
        function (r) { return [r.status === 504, 'http=' + r.status + ' ' + r.body]; });
    check('timeout no meio de um corpo repassado → conexão cortada', function () { return A + '/stall?type=application/json'; }, {},
        function (r) { return [r.broken === true, 'http=' + r.status + ' bytes=' + r.length + ' cortado=' + r.broken]; });
    check('A → B → A: a credencial não volta a A', function () { return redirect(A, redirect(B, A + '/echo')); }, { headers: { Authorization: SECRET } },
        function (r) { return [r.status === 200 && r.body.indexOf(SECRET) === -1 && r.body.indexOf('"upstream":"A"') !== -1, 'http=' + r.status + ' ' + r.body]; });
    check('controle: A → A mantém a credencial', function () { return redirect(A, A + '/echo'); }, { headers: { Authorization: SECRET } },
        function (r) { return [r.status === 200 && r.body.indexOf(SECRET) !== -1, 'http=' + r.status]; });
    [['AAC ADTS', 'fff15080021ffc'], ['MP3 sem ID3', 'fffb9064'], ['MPEG-PS', '000001ba44000400'], ['MOV com átomo wide', '0000000877696465000000306d646174']].forEach(function (c) {
        check('assinatura: ' + c[0] + ' como text/html → 403', function () { return bytes(pad(c[1])); }, {},
            function (r) { return [r.status === 403 && /media container/.test(r.body), 'http=' + r.status + ' ' + r.body.slice(0, 80)]; });
    });
    check('controle: JPEG (FF D8) passa', function () { return bytes(pad('ffd8ffe000104a46'), 'image/jpeg'); }, {},
        function (r) { return [r.status === 200 && r.length === 64, 'http=' + r.status + ' bytes=' + r.length]; });
    check('token velho → 401 com X-Proxy-Error: bad-token', function () { return A + '/echo'; }, { path: '/proxy?t=old&url=x' },
        function (r) { return [r.status === 401 && r.headers['x-proxy-error'] === 'bad-token', 'http=' + r.status + ' ' + r.headers['x-proxy-error']]; });
    check('emissor do upstream exposto (F37 Test CA)', function () { return A + '/echo'; }, {},
        function (r) { return [r.headers['x-proxy-issuer-o'] === 'F37 Test CA', 'issuer=' + r.headers['x-proxy-issuer-o']]; });
}

function run(i) {
    if (i >= cases.length) {
        var failed = results.filter(function (r) { return !r.ok; }).length;
        console.log((results.length - failed) + '/' + results.length + ' PASS (node ' + process.version + ', OpenSSL ' + process.versions.openssl + ')');
        process.exit(failed ? 1 : 0);
    }
    var c = cases[i];
    request(c.target(), c.opts, function (r) {
        var out;
        try { out = c.verify(r); } catch (e) { out = [false, 'exceção: ' + e.message]; }
        results.push({ name: c.name, ok: out[0] });
        console.log((out[0] ? 'PASS' : 'FAIL') + '  ' + c.name + '  ' + out[1]);
        run(i + 1);
    });
}

listen(https.createServer(tls, route('A')), '127.0.0.1', function (pa) {
    A = 'https://127.0.0.1:' + pa;
    listen(https.createServer(tls, route('B')), '127.0.0.1', function (pb) {
        B = 'https://localhost:' + pb;
        proxy = createProxy({ token: TOKEN, agent: new https.Agent({ ca: [read('ca.pem')], keepAlive: true, maxSockets: 6 }), timeoutMs: 600 });
        proxy.listen(0, 1, function (err, p) {
            if (err) { console.log('FAIL  listen ' + err); process.exit(1); }
            port = p;
            defineCases();
            run(0);
        });
    });
});
