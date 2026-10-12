#!/usr/bin/env node
// Servidor de mídia para testes no emulador: arquivos estáticos com Range (seek),
// CORS aberto e uma rota que imita links de debrid (302 para o arquivo).
//   node media-server.mjs [pasta] [porta]      (padrão: ~/webos-tv-sdk/media-tests/files, 8099)
//   No emulador: http://10.0.2.2:8099/<arquivo>  ou  http://10.0.2.2:8099/redirect/<arquivo>
//   Links de debrid com problema (F6.3): /status/<código>/<arquivo> responde com esse HTTP (403, 410, 404,
//   429, 503…); /drop/<arquivo> derruba a conexão (erro de rede). Ambos podem vir depois de /redirect/,
//   como num link que redireciona para um servidor que falha: /redirect/status/403/<arquivo>.
//   Resolvedor lento (F8.1): /slow/<ms>/<resto> responde <resto> depois de <ms> (/slow/3000/redirect/<arquivo>:
//   o 302 chega em 3 s); /hang/<resto> nunca responde; /rate/<kbit/s>/<resto> manda o arquivo de <resto> a essa
//   taxa (os dados chegam, devagar: um início de vários minutos sem evento de mídia, como o MP4 de 75 GB na TV).
//   MEDIA_RATE_MBPS=<n>: as respostas com arquivo dividem uma banda de n Mbit/s (o Wi-Fi da TV), para medir
//   se leituras concorrentes (o probe e o pipeline) atrasam o início.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || path.join(process.env.HOME, 'webos-tv-sdk/media-tests/files'));
const port = Number(process.argv[3] || 8099);
const TYPES = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.ts': 'video/mp2t', '.m3u8': 'application/vnd.apple.mpegurl',
    '.vtt': 'text/vtt', '.srt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json' };

// Banda limitada: cada pedaço de arquivo espera a vez num "fio" de `rate` bytes/ms. O fio compartilhado
// (MEDIA_RATE_MBPS) vale para todas as respostas; /rate/ dá um fio só da resposta.
const shared = { rate: Number(process.env.MEDIA_RATE_MBPS || 0) * 1e6 / 8 / 1000, freeAt: 0 };
const send = (stream, res, own, log) => {
    const wire = own || shared;
    if (!wire.rate) { stream.pipe(res); return; }
    let sent = 0;
    let ended = false;
    const chunks = [];
    res.on('close', () => {
        stream.destroy();
        if (own) log('closed', `${sent} bytes sent`);
    });
    // Pedaços pequenos, para a taxa ser contínua mesmo a poucos kbit/s; adiantado em até 20 ms.
    const next = () => {
        if (res.destroyed) return;
        const now = Date.now();
        if (wire.freeAt > now + 20) { setTimeout(next, wire.freeAt - now - 20); return; }
        const chunk = chunks.shift();
        if (!chunk) {
            if (ended) res.end(); else stream.resume();
            return;
        }
        wire.freeAt = Math.max(now, wire.freeAt) + chunk.length / wire.rate;
        sent += chunk.length;
        if (res.write(chunk)) next(); else res.once('drain', next);
    };
    stream.on('data', (data) => {
        stream.pause();
        for (let i = 0; i < data.length; i += 4096) chunks.push(data.subarray(i, i + 4096));
        next();
    });
    stream.on('end', () => {
        ended = true;
        if (chunks.length === 0) next();
    });
};

const handle = (req, res, pathname, own) => {
    const log = (status, extra = '') => console.log(`${new Date().toISOString()} ${req.method} ${pathname} ${req.headers.range || ''} -> ${status} ${extra}`);
    const limited = /^\/rate\/(\d+)(\/.*)$/.exec(pathname);
    if (limited) return handle(req, res, limited[2], { rate: Number(limited[1]) * 1000 / 8 / 1000, freeAt: 0 });
    const slow = /^\/slow\/(\d+)(\/.*)$/.exec(pathname);
    if (slow) {
        log('slow', `${slow[1]} ms`);
        setTimeout(() => { if (!res.destroyed) handle(req, res, slow[2], own); }, Number(slow[1]));
        return;
    }
    if (pathname.startsWith('/hang/')) return log('hang');

    if (pathname.startsWith('/redirect/')) {
        const target = '/' + pathname.slice('/redirect/'.length);
        res.writeHead(302, { Location: target });
        res.end();
        return log(302, target);
    }

    const failing = /^\/status\/(\d{3})(\/|$)/.exec(pathname);
    if (failing) {
        res.writeHead(Number(failing[1]), { 'Content-Type': 'text/plain' });
        res.end(`simulated ${failing[1]}`);
        return log(Number(failing[1]), 'simulated');
    }
    if (pathname.startsWith('/drop/')) {
        req.socket.destroy();
        return log('dropped');
    }

    const file = path.join(root, decodeURIComponent(pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end(); return log(404);
    }
    const size = fs.statSync(file).size;
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
        const start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
        const end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return log(416); }
        res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') { res.end(); return log(206); }
        send(fs.createReadStream(file, { start, end }), res, own, log);
        return log(206, `${start}-${end}`);
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
    if (req.method === 'HEAD') { res.end(); return log(200); }
    send(fs.createReadStream(file), res, own, log);
    log(200);
};

http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    if (req.method === 'OPTIONS') {
        res.writeHead(204); res.end();
        return console.log(`${new Date().toISOString()} OPTIONS ${url.pathname}  -> 204 `);
    }
    handle(req, res, url.pathname);
}).listen(port, '127.0.0.1', () => console.log(`servindo ${root} em http://127.0.0.1:${port} (emulador: http://10.0.2.2:${port})`));
