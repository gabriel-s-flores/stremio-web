// webOS TV 4.x build only (resolved instead of useStreamingServer.js by webos/webpack/app.js, F6.1).
// There is no streaming server (plan P3): every screen sees the model as absent, so the Board
// warning, the server settings, torrent statistics, casting and playback devices stay out, and the
// UI never subscribes to the core's streaming_server model.
// Same shape as the model (src/core/types/models/StremingServer.d.ts), every field empty;
// webos/tests/no-server/no-server.test.js checks the keys.

const NO_STREAMING_SERVER = Object.freeze({
    baseUrl: null,
    remoteUrl: null,
    selected: null,
    settings: null,
    settingsOptions: Object.freeze([]),
    cacheRootUpdate: null,
    torrent: null,
    statistics: null,
    playbackDevices: null,
    casting: null,
    networkInfo: null,
    deviceInfo: null,
});

const useStreamingServer = () => NO_STREAMING_SERVER;

module.exports = useStreamingServer;
