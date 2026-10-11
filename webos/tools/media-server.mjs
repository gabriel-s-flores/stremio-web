#!/usr/bin/env node
// Servidor de mídia para testes no emulador: arquivos estáticos com Range (seek),
// CORS aberto e uma rota que imita links de debrid (302 para o arquivo).
//   node media-server.mjs [pasta] [porta]      (padrão: ~/webos-tv-sdk/media-tests/files, 8099)
//   No emulador: http://10.0.2.2:8099/<arquivo>  ou  http://10.0.2.2:8099/redirect/<arquivo>
//   Links de debrid com problema (F6.3): /status/<código>/<arquivo> responde com esse HTTP (403, 410, 404,
//   429, 503…); /drop/<arquivo> derruba a conexão (erro de rede). Ambos podem vir depois de /redirect/,
//   como num link que redireciona para um servidor que falha: /redirect/status/403/<arquivo>.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || path.join(process.env.HOME, 'webos-tv-sdk/media-tests/files'));
const port = Number(process.argv[3] || 8099);
const TYPES = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.ts': 'video/mp2t', '.m3u8': 'application/vnd.apple.mpegurl',
    '.vtt': 'text/vtt', '.srt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json' };

http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const log = (status, extra = '') => console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${req.headers.range || ''} -> ${status} ${extra}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return log(204); }

    if (url.pathname.startsWith('/redirect/')) {
        const target = '/' + url.pathname.slice('/redirect/'.length);
        res.writeHead(302, { Location: target });
        res.end();
        return log(302, target);
    }

    const failing = /^\/status\/(\d{3})(\/|$)/.exec(url.pathname);
    if (failing) {
        res.writeHead(Number(failing[1]), { 'Content-Type': 'text/plain' });
        res.end(`simulated ${failing[1]}`);
        return log(Number(failing[1]), 'simulated');
    }
    if (url.pathname.startsWith('/drop/')) {
        req.socket.destroy();
        return log('dropped');
    }

    const file = path.join(root, decodeURIComponent(url.pathname));
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
        fs.createReadStream(file, { start, end }).pipe(res);
        return log(206, `${start}-${end}`);
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
    if (req.method === 'HEAD') { res.end(); return log(200); }
    fs.createReadStream(file).pipe(res);
    log(200);
}).listen(port, '127.0.0.1', () => console.log(`servindo ${root} em http://127.0.0.1:${port} (emulador: http://10.0.2.2:${port})`));
