// Stage and install isolated apps; no appinfo.json is added to the repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const origin = process.argv[2] || 'http://10.0.2.2:8094';
const device = process.argv[3] || 'emulator';
const url = new URL(origin);
if (url.origin !== origin || !/^http:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(origin)) throw Error('Expected a LAN HTTP origin without path');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-t35-'));
const bin = path.join(process.env.APPDATA, 'npm/node_modules/@webos-tools/cli/bin');
const cli = (name, args) => execFileSync(process.execPath, [path.join(bin, name + '.js'), ...args], { stdio: 'pipe', timeout: 120000 });
const apps = [];
for (const mode of ['hosted', 'packaged']) {
    const dir = path.join(staging, mode);
    fs.mkdirSync(dir);
    if (mode === 'packaged') fs.cpSync('build', dir, { recursive: true });
    else fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><script>location.replace(' + JSON.stringify(origin + '/?t35=storage') + ');</script>');
    fs.copyFileSync('webos/hello/hosted/icon.png', path.join(dir, 'icon.png'));
    const id = 'com.stremio.webos.t35.' + mode;
    fs.writeFileSync(path.join(dir, 'appinfo.json'), JSON.stringify({ id, version: '1.0.0', vendor: 'Stremio webOS port', type: 'web', main: 'index.html', title: 'T3.5 Storage ' + mode, resolution: '1920x1080', icon: 'icon.png' }, null, 2));
    cli('ares-package', [dir, '-o', staging]);
    const ipk = fs.readdirSync(staging).find(file => file.startsWith(id + '_') && file.endsWith('.ipk'));
    if (!ipk) throw Error('Package missing');
    cli('ares-install', ['-d', device, path.join(staging, ipk)]);
    apps.push({ mode, id });
}
console.log(JSON.stringify({ staging, origin, apps }, null, 2));
