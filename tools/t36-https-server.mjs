import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const selfsigned = createRequire(require.resolve('webpack-dev-server'))('selfsigned');
const [rootArg, portArg = '8443', certPath, keyPath] = process.argv.slice(2);
if (!rootArg) throw Error('Usage: node tools/t36-https-server.mjs snapshotDirectory port [trustedCertificate privateKey]');
const root = path.resolve(rootArg);
const pem = certPath ? { cert: fs.readFileSync(certPath), private: fs.readFileSync(keyPath) } : await selfsigned.generate([{ name: 'commonName', value: '10.0.2.2' }], { algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '10.0.2.2' }] }] });
const types = { '.js': 'application/javascript', '.html': 'text/html', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json' };
https.createServer({ cert: pem.cert, key: pem.private }, (req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'https://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
}).listen(Number(portArg), '0.0.0.0', () => console.log(JSON.stringify({ port: Number(portArg), trustedCertificateProvided: !!certPath })));
