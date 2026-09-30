// Dedicated package fixture: real stremio-video and native vendor, no core/Player.
const Video = require('@stremio/stremio-video');
const { toVideoPlatform, getVideoPlatformError } = require('../src/common/Platform/videoPlatform');
window.__t33Fixture = { results: [] };
window.__t33Run = function(server) {
    const platform = toVideoPlatform('webos');
    const result = { mode: 'packaged-fixture', platform: platform, bridgeBeforeLoad: typeof window.webOS.service.request === 'function', startedAt: new Date().toISOString(), errors: [] };
    window.__t33Fixture.results.push(result);
    const error = getVideoPlatformError(platform, window);
    if (error) { result.errors.push(error); return; }
    if (window.__t33Video) window.__t33Video.destroy();
    const video = window.__t33Video = new Video();
    video.on('implementationChanged', function(manifest) {
        result.manifest = manifest.name;
        result.implementationAt = new Date().toISOString();
        document.getElementById('result').textContent = JSON.stringify(result, null, 2);
    });
    video.on('error', function(error) { result.errors.push({ code: error.code, critical: error.critical, message: error.message }); });
    video.dispatch({ type: 'command', commandName: 'load', commandArgs: {
        platform: platform, stream: { url: 'http://10.0.2.2:8093/t33-test.mp4' }, autoplay: true,
        streamingServerURL: server ? 'http://10.0.2.2:8093' : undefined
    } }, { containerElement: document.getElementById('video') });
};
