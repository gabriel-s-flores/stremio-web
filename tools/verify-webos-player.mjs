import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const directory = path.resolve(process.argv[2] || 'build');
const target = process.argv[3] || 'webos';
assert(['webos', 'desktop'].includes(target), 'target must be webos or desktop');
const webos = target === 'webos';
const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
assert.equal(html.includes('cast_sender.js'), !webos, 'Cast sender policy does not match target');
const mainMaps = fs.readdirSync(directory)
    .map(name => path.join(directory, name, 'scripts/main.js.map'))
    .filter(file => fs.existsSync(file));
assert.equal(mainMaps.length, 1, 'expected one main source map');
const map = JSON.parse(fs.readFileSync(mainMaps[0], 'utf8'));
const implementations = map.sources
    .map((source, index) => source.endsWith('/WebOsVideo/WebOsVideo.js') ? map.sourcesContent[index] : null)
    .filter(Boolean);
assert.equal(implementations.length, 1, 'published WebOsVideo implementation is missing');
const implementation = implementations[0];
assert.equal(implementation.includes('pendingMediaIdTimer'), webos, 'mediaId lifecycle patch does not match target');
if (webos) {
    assert.equal(implementation.split('clearInterval(pendingMediaIdTimer);').length - 1, 2, 'load/unload must cancel the timer');
    assert(implementation.includes('isLoaded = false;'), 'episode loaded state must reset');
    assert(implementation.includes('if (destroyed || !stream) return;'), 'deferred playback must guard teardown');
}
assert.equal(require('@stremio/stremio-video/package.json').version, '0.0.96', 'review lifecycle patch after package upgrades');
console.log(JSON.stringify({ target, castSender: !webos, implementation: 'WebOsVideo', lifecyclePatch: webos, passed: true }));
