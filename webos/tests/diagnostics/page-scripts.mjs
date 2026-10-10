#!/usr/bin/env node
// F3.6: the .js files the app page has loaded so far (Page.getResourceTree), one name per line.
// webpack removes a chunk's <script> tag once it ran, so the DOM cannot tell; the resource tree can.
//   node page-scripts.mjs <cdp-port>
const port = Number(process.argv[2] || process.env.CDP_PORT || 9998);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = targets.find((t) => (t.url || '').includes('io.github.gabrielsflores.stremio') && t.webSocketDebuggerUrl);
if (!target) throw new Error('the app page is not open');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
});
const result = await new Promise((resolve, reject) => {
    ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === 1) (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result));
    });
    ws.send(JSON.stringify({ id: 1, method: 'Page.getResourceTree' }));
});
ws.close();
const names = (result.frameTree.resources || [])
    .filter((resource) => /\.js(\?|$)/.test(resource.url))
    .map((resource) => resource.url.split('/').pop());
console.log(JSON.stringify(names));
