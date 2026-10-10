// Serviço JS do app no webOS TV 4.x (Node v0.12.2, só ES5): proxy HTTPS local para hosts com
// certificado Let's Encrypt, que o Chromium 53 da TV recusa (net::ERR_INSECURE_RESPONSE).
// O proxy em si está em proxy.js; aqui ficam a confiança (raízes ISRG) e os métodos Luna.
//
// O app chama luna://<id>/start com subscribe:true e recebe { port, token }. A assinatura mantém o
// serviço vivo: o webos-service segura uma atividade por assinatura e só encerra o processo ocioso
// (5 s) depois que ela é cancelada, o que acontece quando o app fecha. A porta é a 47443 ou, se
// ocupada, a próxima livre. O token é aleatório por processo; a Luna só aceita chamadas do próprio
// app (o id do serviço começa pelo do app). Se o processo morrer, a assinatura do app não é
// avisada: o app percebe pelo proxy que não responde e chama `start` de novo.
'use strict';

var https = require('https');
var tls = require('tls');
var crypto = require('crypto');
var Service = require('webos-service');
var ISRG_ROOTS = require('./ca');
var createProxy = require('./proxy').createProxy;

var SERVICE_ID = 'io.github.gabrielsflores.stremio.tlsproxy';
var FIRST_PORT = 47443;
var PORT_ATTEMPTS = 10;

var service = new Service(SERVICE_ID);
var token = crypto.randomBytes(16).toString('hex');
var logLines = [];
var subscribers = {};
var listening = false;
var listenError = null;
var starting = false;
var waiting = [];

// O console do serviço não chega a /var/log/messages no emulador; as últimas linhas ficam em
// memória e saem pelo método Luna `status` (restrito ao próprio app).
function log(msg) {
    var line = new Date().toISOString() + ' [tlsproxy] ' + msg;
    logLines.push(line);
    if (logLines.length > 100) logLines.shift();
    console.log(line);
}

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

var proxy = createProxy({ token: token, agent: new https.Agent(agentOptions), log: log });

function startReply() {
    if (listenError) return { returnValue: false, errorCode: -1, errorText: 'listen failed: ' + listenError };
    return { returnValue: true, port: proxy.port(), token: token, strategy: trust.strategy, node: process.version };
}

function ensureServer(callback) {
    if (listening || listenError) { callback(); return; }
    waiting.push(callback);
    if (starting) return;
    starting = true;
    proxy.listen(FIRST_PORT, PORT_ATTEMPTS, function (err, port) {
        starting = false;
        if (err) {
            listenError = err.code || String(err);
            log('listen error: ' + listenError);
        } else {
            listening = true;
            log('listening on 127.0.0.1:' + port + ' (' + trust.strategy + ', ' + process.version + ', OpenSSL ' + process.versions.openssl + ')');
        }
        var callbacks = waiting;
        waiting = [];
        callbacks.forEach(function (cb) { cb(); });
    });
}

service.register('start', function (message) {
    if (message.isSubscription) subscribers[message.uniqueToken] = message;
    ensureServer(function () {
        message.respond(startReply());
    });
}, function (message) {
    delete subscribers[message.uniqueToken];
});

// Diagnóstico completo (inclui o log e o pid) só pela Luna, que o sistema restringe ao próprio app.
service.register('status', function (message) {
    var s = proxy.status();
    s.listening = listening;
    s.listenError = listenError;
    s.strategy = trust.strategy;
    s.node = process.version;
    s.openssl = process.versions.openssl;
    s.subscribers = Object.keys(subscribers).length;
    s.pid = process.pid;
    s.log = logLines;
    s.returnValue = true;
    message.respond(s);
});
