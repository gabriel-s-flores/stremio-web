import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const desktop = process.argv[2] === 'desktop';
const hash = path => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const html = fs.readFileSync('build/index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match => match[1]);
const vendor = scripts.indexOf('webos/webOSTV.js');
if (desktop) {
    assert.equal(vendor, -1);
    assert.equal(fs.existsSync('build/webos/webOSTV.js'), false);
} else {
    assert(vendor >= 0);
    for (const name of ['main', 'worker']) {
        assert(scripts.findIndex(src => src.endsWith(`/${name}.js`)) > vendor, `${name} must follow vendor`);
    }
    assert.equal(hash('build/webos/webOSTV.js'), hash('webos/lib/webOSTVjs-1.2.10/webOSTV.js'));
}
const hashes = Object.fromEntries(['webos/lib', 'webos/hello/site', 'webos/hello/packaged'].flatMap(root => ['webOSTV.js', 'LICENSE-2.0.txt'].map(file => {
    const path = `${root}/webOSTVjs-1.2.10/${file}`;
    return [path, hash(path)];
})));
for (const file of ['webOSTV.js', 'LICENSE-2.0.txt']) {
    assert.equal(hashes[`webos/lib/webOSTVjs-1.2.10/${file}`], hashes[`webos/hello/site/webOSTVjs-1.2.10/${file}`]);
    assert.equal(hashes[`webos/lib/webOSTVjs-1.2.10/${file}`], hashes[`webos/hello/packaged/webOSTVjs-1.2.10/${file}`]);
}
console.log(JSON.stringify({ desktop, passed: true, scripts, hashes, main: hash('build/' + scripts.find(src => src.endsWith('/main.js'))) }, null, 2));
