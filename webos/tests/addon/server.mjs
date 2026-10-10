#!/usr/bin/env node
// Local test addon (F6.2; reused by F6.4): a Stremio addon with static `stream` answers (any movie
// or series id starting with "tt") whose URLs point at webos/tools/media-server.mjs, started here
// on a media root with the kit media, the F0.10 headers and the rebuilt probe fixtures (media.js).
//
//   node webos/tests/addon/server.mjs [--port N] [--media-port N] [--host 10.0.2.2] [--dir <media root>] [--info <file.json>]
//
// Ports default to free ones. --host is how the client reaches this machine (10.0.2.2 from the
// emulator, 127.0.0.1 from a desktop browser). When ready, prints and writes (--info) a JSON with
// manifestUrl, mediaUrl and the ports. Stops the media server on SIGINT/SIGTERM.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { STREAMS, MANIFEST, toStreams } = require('./catalog.js');
const { prepareMedia } = require('./media.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

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

const waitForPort = (port) => new Promise((resolve, reject) => {
    const started = Date.now();
    const attempt = () => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
            socket.destroy();
            resolve();
        });
        socket.once('error', () => {
            socket.destroy();
            if (Date.now() - started > 10000) reject(new Error(`media server did not open port ${port}`));
            else setTimeout(attempt, 100);
        });
    };
    attempt();
});

const host = option('host', '10.0.2.2');
const port = Number(option('port', 0)) || await freePort();
const mediaPort = Number(option('media-port', 0)) || await freePort();
const dir = path.resolve(option('dir', fs.mkdtempSync(path.join(os.tmpdir(), 'webos-test-addon-'))));
const infoFile = option('info', null);

const missing = prepareMedia(dir, STREAMS.filter((entry) => entry.media).map((entry) => entry.media));
if (missing.length > 0) {
    console.warn(`aviso: mídias ausentes (rode webos/tools/gen-media.sh com GOP=24): ${missing.join(', ')}`);
}

const media = spawn(process.execPath, [path.join(ROOT, 'webos', 'tools', 'media-server.mjs'), dir, String(mediaPort)], {
    stdio: ['ignore', 'inherit', 'inherit'],
});
const stop = () => {
    media.kill('SIGTERM');
    process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
media.on('exit', (code) => {
    console.error(`media-server saiu (código ${code})`);
    process.exit(1);
});
await waitForPort(mediaPort);

const mediaUrl = `http://${host}:${mediaPort}`;
const manifestUrl = `http://${host}:${port}/manifest.json`;

const send = (res, status, body) => {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const log = (status) => process.stdout.write(`${new Date().toISOString()} addon ${req.method} ${url.pathname} -> ${status}\n`);
    if (req.method === 'OPTIONS') {
        send(res, 204, {});
        return log(204);
    }
    if (url.pathname === '/manifest.json') {
        send(res, 200, MANIFEST);
        return log(200);
    }
    const stream = /^\/stream\/(movie|series)\/(tt[^/]+)\.json$/.exec(url.pathname);
    if (stream) {
        send(res, 200, { streams: toStreams(mediaUrl), cacheMaxAge: 0 });
        return log(200);
    }
    send(res, 404, { err: 'not found' });
    return log(404);
}).listen(port, '127.0.0.1', () => {
    const info = { manifestUrl, mediaUrl, port, mediaPort, dir, streams: STREAMS.length };
    if (infoFile) fs.writeFileSync(infoFile, JSON.stringify(info, null, 4));
    process.stdout.write(`${JSON.stringify(info)}\n`);
});
