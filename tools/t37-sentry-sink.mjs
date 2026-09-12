import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const { sanitize } = createRequire(import.meta.url)('../src/webos/diagnostics/observability');

export function startSink({ port, host = '127.0.0.1', origin, release, dist, mode, tls, reject = false }) {
    const summary = { requests: 0, events: 0, rejected: 0, privacyPassed: true, identityPassed: true, nullOrigin: false, hashes: [] };
    const handler = (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/api/37/envelope/' || !['POST', 'OPTIONS'].includes(req.method)) { res.writeHead(404); res.end(); return; }
        summary.requests++;
        if (req.headers.origin !== origin) { summary.rejected++; res.writeHead(403); res.end(); return; }
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'content-type');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        summary.nullOrigin ||= req.headers.origin === 'null';
        let size = 0, body = '';
        req.on('data', chunk => { size += chunk.length; if (size > 65536) req.destroy(); else body += chunk; });
        req.on('end', () => {
            try {
                const lines = body.trim().split('\n');
                if (lines.length !== 3) throw Error();
                const [header, item, event] = lines.map(line => JSON.parse(line));
                const identity = { platform: 'webos', release, dist, webos_debug: true, mode };
                const clean = JSON.parse(JSON.stringify(sanitize(event, identity)));
                const privacy = Object.keys(header).every(k => k === 'event_id') && item.type === 'event'
                    && JSON.stringify(clean) === JSON.stringify(event)
                    && !req.headers.cookie && !req.headers.authorization && !req.headers.referer;
                summary.privacyPassed &&= !!privacy;
                summary.identityPassed &&= event.tags?.platform === 'webos' && event.release === release && event.dist === dist && event.tags?.mode === mode;
                summary.events++;
                summary.hashes.push(createHash('sha256').update(body).digest('hex'));
                res.writeHead(reject ? 503 : 200); res.end('{}');
            } catch { summary.privacyPassed = false; summary.rejected++; res.writeHead(400); res.end(); }
        });
    };
    const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
    return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve({ summary, close: () => new Promise(resolve => server.close(resolve)) })); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.includes('--help')) console.log('node tools/t37-sentry-sink.mjs PORT HOST ORIGIN RELEASE DIST MODE OUTPUT [CERT KEY]\nOnly /api/37/envelope/ POST/OPTIONS; output contains booleans/counts/hashes.');
    else {
        const [port, host, origin, release, dist, mode, output, cert, key] = process.argv.slice(2);
        if (!output) throw Error('Missing arguments; see --help');
        const sink = await startSink({ port: Number(port), host, origin, release, dist, mode, tls: cert && key ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) } : undefined });
        process.on('SIGINT', async () => { await sink.close(); fs.writeFileSync(output, JSON.stringify(sink.summary, null, 2)); });
        console.log('Synthetic sink ready');
    }
}
