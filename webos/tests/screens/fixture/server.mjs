#!/usr/bin/env node
// Fixture addon of the visual regression (F2.7): a Stremio addon with fixed catalogs, details, streams
// and SVG images (data.js), so the captures do not depend on Cinemeta or on the posters of the day.
//
//   node webos/tests/screens/fixture/server.mjs [--port N] [--host 10.0.2.2] [--info <file.json>]
//
// --host is how the client reaches this machine (10.0.2.2 from the emulator, 127.0.0.1 from a desktop
// browser); it goes into the image and stream URLs. Prints (and writes to --info) { manifestUrl, port }
// when it is ready. /status/<code>/<name> answers that HTTP status, like webos/tools/media-server.mjs
// (a debrid link that does not play: the error screen of the Player, F6.3).
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { route } = require('./data.js');

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : fallback;
};
const freePort = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(() => resolve(port));
    });
});

const host = option('host', '10.0.2.2');
const port = Number(option('port', 0)) || await freePort();
const infoFile = option('info', null);
const base = `http://${host}:${port}`;

http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    const log = (status) => console.log(`${req.method} ${pathname} -> ${status}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return log(204);
    }
    const failing = /^\/status\/(\d{3})(\/|$)/.exec(pathname);
    if (failing) {
        res.writeHead(Number(failing[1]), { 'Content-Type': 'text/plain' });
        res.end(`simulated ${failing[1]}`);
        return log(failing[1]);
    }
    const found = route(base, pathname);
    if (!found) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return log(404);
    }
    res.writeHead(200, {
        'Content-Type': found.type === 'svg' ? 'image/svg+xml' : 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=3600',
    });
    res.end(found.type === 'svg' ? found.body : JSON.stringify(found.body));
    return log(200);
}).listen(port, '0.0.0.0', () => {
    const info = { manifestUrl: `${base}/manifest.json`, port };
    console.log(JSON.stringify(info));
    if (infoFile) fs.writeFileSync(infoFile, JSON.stringify(info));
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
