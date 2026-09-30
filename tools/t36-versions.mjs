import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { generateSW } = createRequire(require.resolve('workbox-webpack-plugin'))('workbox-build');
const source = path.resolve(process.argv[2] || JSON.parse(fs.readFileSync('tests/webos/t36-hosted-snapshot.json')).snapshot);
if (!fs.existsSync(path.join(source, 'service-worker.js'))) throw Error('Hosted snapshot required');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-t36-versions-'));
const versions = [];
for (const version of ['v1','v2']) {
    const dir = path.join(root, version);
    fs.cpSync(source, dir, { recursive: true });
    const commit = fs.readdirSync(dir).find(f => /^[a-f0-9]{40}$/.test(f));
    const main = path.join(dir, commit, 'scripts/main.js');
    fs.appendFileSync(main, '\n;window.__t36Version=' + JSON.stringify(version) + ';\n');
    await generateSW({ globDirectory: dir, globPatterns: ['**/*.{js,css,html,json,wasm,png,jpg,jpeg,svg,webp,ico,ttf,woff2}'], globIgnores: ['service-worker.js','workbox-*.js'], swDest: path.join(dir,'service-worker.js'), maximumFileSizeToCacheInBytes: 20000000, clientsClaim: true, skipWaiting: false });
    versions.push({ version, directory: dir, mainSha256: crypto.createHash('sha256').update(fs.readFileSync(main)).digest('hex'), serviceWorkerSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'service-worker.js'))).digest('hex') });
}
fs.writeFileSync('tests/webos/t36-versions.json', JSON.stringify({ versions, runtimeValidated: false }, null, 2));
console.log(JSON.stringify({ root, versions }));
