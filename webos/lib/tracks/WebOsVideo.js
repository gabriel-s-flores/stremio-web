// The WebOsVideo the webOS build gives stremio-video (webos/webpack/player.js): the upstream one,
// with the pipeline guard of the stream switches (webos/lib/player/withPipelineGuard.js, F5.6), the
// final URL of debrid links (webos/lib/player/withFinalUrl.js, F8.1) and the tracks of the header
// probe (withC8Tracks.js). The localStorage keys are read once, here, and shown on the diagnostics
// screen (F3.6).

const WebOsVideo = require('@stremio/stremio-video/src/WebOsVideo/WebOsVideo');
const withC8Tracks = require('./withC8Tracks');
const { probeCache } = require('./probe-cache');
const { withPipelineGuard, readGuardSettings, GUARD_KEY, EXTRA_LOAD_KEY, WATCHDOG_KEY, QUIET_RELEASE_KEY, HOLD_KEY, DISPLAY_NUDGE_KEY } = require('../player/withPipelineGuard');
const { withFinalUrl, readFinalUrlSetting, FINAL_URL_KEY } = require('../player/withFinalUrl');
const { getFinalUrls } = require('../final-url');
const { registerSection } = require('../diagnostics/registry');

const storage = typeof window !== 'undefined' ? window.localStorage : null;
const settings = readGuardSettings(storage);
const finalUrl = readFinalUrlSetting(storage);
const Guarded = settings.enabled ?
    withPipelineGuard(WebOsVideo, {
        log: console,
        dropExtraLoad: settings.dropExtraLoad,
        watchdog: settings.watchdog,
        releaseSettleMs: settings.quietRelease ? undefined : 0,
        holdInPlace: settings.holdInPlace,
        displayNudge: settings.displayNudge,
    })
    :
    WebOsVideo;
const Video = finalUrl ? withFinalUrl(Guarded, { finalUrls: getFinalUrls(), log: console }) : Guarded;

registerSection('pipelineGuard', 'Player pipeline guard (F5.6)', () => ({
    guard: settings.enabled ? 'on' : 'off (' + GUARD_KEY + ')',
    dropExtraLoad: settings.enabled && settings.dropExtraLoad ? 'on' : 'off (' + EXTRA_LOAD_KEY + ' = keep)',
    startWatchdog: settings.enabled && settings.watchdog ? 'on' : 'off (' + WATCHDOG_KEY + ' = off)',
    quietRelease: settings.enabled && settings.quietRelease ? 'on' : 'off (' + QUIET_RELEASE_KEY + ' = off)',
    holdInPlace: settings.enabled && settings.holdInPlace ? 'on' : 'off (' + HOLD_KEY + ' = off)',
    displayNudge: settings.enabled && settings.displayNudge ? 'on' : 'off (' + DISPLAY_NUDGE_KEY + ' = off)',
}));

registerSection('finalUrl', 'Player final URL (F8.1)', () => ({
    finalUrl: finalUrl ? 'on' : 'off (' + FINAL_URL_KEY + ' = off)',
}));

module.exports = withC8Tracks(Video, { probeCache, log: console });
