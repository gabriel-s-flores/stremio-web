// Isolated hosted debug app. The server stays alive until this process is stopped.
// node tools/t41-prepare.mjs [emulator] [port]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const port = Number(process.argv[3] || 8141);
const root = path.resolve('build');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-t41-'));
const app = path.join(staging, 'app');
fs.mkdirSync(app);
fs.copyFileSync('webos/hello/hosted/icon.png', path.join(app, 'icon.png'));
fs.writeFileSync(path.join(app, 'appinfo.json'), JSON.stringify({ id: 'com.stremio.webos.t41', version: '1.0.0', vendor: 'Stremio', type: 'web', main: 'index.html', title: 'T4.1 Navigation', resolution: '1920x1080', icon: 'icon.png' }));
fs.writeFileSync(path.join(app, 'index.html'), `<!doctype html><script>location.replace('http://10.0.2.2:${port}/')</script>`);
const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
    const target = file === root ? path.join(root, 'index.html') : file;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml' })[path.extname(target)] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
const bin = path.join(process.env.APPDATA, 'npm/node_modules/@webos-tools/cli/bin');
const cli = (name, args) => execFileSync(process.execPath, [path.join(bin, name + '.js'), ...args], { stdio: 'pipe', timeout: 60000 });
try {
    cli('ares-package', [app, '-o', staging]);
    const ipk = fs.readdirSync(staging).find(file => file.endsWith('.ipk'));
    cli('ares-install', ['-d', process.argv[2] || 'emulator', path.join(staging, ipk)]);
    cli('ares-launch', ['-d', process.argv[2] || 'emulator', 'com.stremio.webos.t41']);
    console.log(`T4.1 hosted debug app ready on port ${port}; run ares-inspect -d emulator com.stremio.webos.t41`);
} catch (error) { server.close(); throw error; }
