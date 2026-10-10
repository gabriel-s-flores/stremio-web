// Replaces stremio-video's src/tracksData.js in the webOS build (webos/webpack/player.js). The
// upstream one asks the streaming server (http://127.0.0.1:11470/tracks/…), which does not exist
// here (P3); withC8Tracks.js lists the tracks from the header probe instead. No tracks, no request.

module.exports = function(_url, cb) {
    cb(false);
};
