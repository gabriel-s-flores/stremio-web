import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const hash = path => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const hosted = read('tests/webos/t33-runtime-hosted.json');
const packaged = read('tests/webos/t33-runtime-packaged.json');
const checks = read('tests/webos/t33-checks.json');
assert(checks.checks.length === 12 && checks.checks.every(check => check.exitCode === 0));
assert.equal(hosted.before.platformName, 'webos');
assert(hosted.before.bridge && !hosted.before.shellActive);
assert(hosted.results[0].realPlayerRoute);
assert(hosted.results[0].events[0].manifest.includes('WebOsVideo'));
assert(hosted.results[0].video.currentTime > 0 && hosted.results[0].video.error === null);
assert(packaged.results.length === 2 && packaged.results.every(result => result.manifest.includes('WebOsVideo') && result.bridgeBeforeLoad));
const mainPath = 'build/' + hosted.before.scripts.find(src => src.endsWith('/main.js'));
const bundle = fs.readFileSync(mainPath, 'utf8');
assert(bundle.includes('webOS video bridge unavailable'));
assert(bundle.includes('recordPlayerImplementation'));
const paths = ['src/common/Platform/videoPlatform.js', 'src/routes/Player/Player.js', 'src/routes/Player/useVideo.js', 'tests/videoPlatform.spec.js',
    'node_modules/@stremio/stremio-video/package.json', 'node_modules/@stremio/stremio-video/src/StremioVideo/selectVideoImplementation.js',
    'node_modules/@stremio/stremio-video/src/WebOsVideo/WebOsVideo.js', 'node_modules/@stremio/stremio-video/src/tracksData.js', mainPath];
const report = {
    date: new Date().toISOString(), commit: hosted.commit, dirtyCheckout: true,
    bridgeSelectionPassed: true, hostedPlaybackObserved: true, packagedFullAppValidated: false,
    streamingServerPlaybackValidated: false,
    errorAttribution: {
        hosted: ['Service Worker registration catch', 'Google Cast init-error catch', 'Published tracksData.js fetches loopback port 11470; catches failure and calls cb(false)'],
        navigation: 'Existing useMediaSession.ts cleanup calls setActionHandler without a mediaSession guard',
        packagedFixture: 'HTTP media fixture does not implement streaming-server probe/hash APIs; 404s are not full streaming-server validation'
    },
    limitations: ['Full packaged app WASM file:// bootstrap remains outside scope', 'Physical TV not tested', 'No real remote streaming server configured; selector branch proven with HTTP fixture only'],
    hashes: Object.fromEntries(paths.map(path => [path, hash(path)]))
};
fs.writeFileSync('tests/webos/t33-summary.json', JSON.stringify(report, null, 2));
console.log('T3.3 selection, hosted playback, checks and bundle markers verified. Limitations recorded.');
