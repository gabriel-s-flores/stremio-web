// The WebOsVideo the webOS build gives stremio-video (webos/webpack/player.js): the upstream one,
// with the pipeline guard of the stream switches (webos/lib/player/withPipelineGuard.js, F5.6) and
// the tracks of the header probe (withC8Tracks.js).

const WebOsVideo = require('@stremio/stremio-video/src/WebOsVideo/WebOsVideo');
const withC8Tracks = require('./withC8Tracks');
const { probeCache } = require('./probe-cache');
const { withPipelineGuard, pipelineGuardEnabled } = require('../player/withPipelineGuard');

const storage = typeof window !== 'undefined' ? window.localStorage : null;
const Video = pipelineGuardEnabled(storage) ? withPipelineGuard(WebOsVideo, { log: console }) : WebOsVideo;

module.exports = withC8Tracks(Video, { probeCache, log: console });
