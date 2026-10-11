// The WebOsVideo the webOS build gives stremio-video (webos/webpack/player.js): the upstream one,
// with the pipeline guard of the stream switches (webos/lib/player/withPipelineGuard.js, F5.6) and
// the tracks of the header probe (withC8Tracks.js). The guard's localStorage keys are read once,
// here, and shown on the diagnostics screen (F3.6).

const WebOsVideo = require('@stremio/stremio-video/src/WebOsVideo/WebOsVideo');
const withC8Tracks = require('./withC8Tracks');
const { probeCache } = require('./probe-cache');
const { withPipelineGuard, readGuardSettings, GUARD_KEY, EXTRA_LOAD_KEY, WATCHDOG_KEY } = require('../player/withPipelineGuard');
const { registerSection } = require('../diagnostics/registry');

const storage = typeof window !== 'undefined' ? window.localStorage : null;
const settings = readGuardSettings(storage);
const Video = settings.enabled ?
    withPipelineGuard(WebOsVideo, { log: console, dropExtraLoad: settings.dropExtraLoad, watchdog: settings.watchdog })
    :
    WebOsVideo;

registerSection('pipelineGuard', 'Player pipeline guard (F5.6)', () => ({
    guard: settings.enabled ? 'on' : 'off (' + GUARD_KEY + ')',
    dropExtraLoad: settings.enabled && settings.dropExtraLoad ? 'on' : 'off (' + EXTRA_LOAD_KEY + ' = keep)',
    startWatchdog: settings.enabled && settings.watchdog ? 'on' : 'off (' + WATCHDOG_KEY + ' = off)',
}));

module.exports = withC8Tracks(Video, { probeCache, log: console });
