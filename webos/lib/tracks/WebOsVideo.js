// The WebOsVideo the webOS build gives stremio-video (webos/webpack/player.js): the upstream one,
// with the tracks of the header probe (withC8Tracks.js).

const WebOsVideo = require('@stremio/stremio-video/src/WebOsVideo/WebOsVideo');
const withC8Tracks = require('./withC8Tracks');
const { probeCache } = require('./probe-cache');

module.exports = withC8Tracks(WebOsVideo, { probeCache, log: console });
