// Stub for hls.js in the webOS build (F1.5). The TV plays the debrid link natively through
// <video src>, so stremio-video must see HLS as unsupported: `Hls.isSupported()` is false and
// the `new Hls(...)` branch in HTMLVideo is never taken.

function Hls() {
    throw new Error('hls.js is not available in the webOS build');
}

Hls.isSupported = function() {
    return false;
};

Hls.Events = {};
Hls.ErrorTypes = {};
Hls.ErrorDetails = {};

module.exports = Hls;
module.exports.default = Hls;
