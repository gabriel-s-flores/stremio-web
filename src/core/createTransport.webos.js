// webOS TV 4.x build only (resolved instead of createTransport.ts by webos/webpack/app.js).
//
// The same transport (createTransport.diagnostics.ts: upstream plus the boot marks and the core loader
// status of the diagnostics screen, F3.6), with the localStorage mirror of webos/persistence/mirror.js
// (F3.5) around the core init: the core keeps everything in localStorage, which uninstalling the app (and, per LG,
// even updating it) wipes, so a copy is kept in IndexedDB and put back before the core reads it.
// - The mirror starts when this module loads (CoreProvider creates the transport at import time),
//   before the first render; init waits for it, at most 3 s counted from init, and never fails
//   because of it. When localStorage already has the core's state (or is linked to the copy) it
//   resolves at once, without opening IndexedDB.
// - After init succeeds the mirror confirms a restore and starts copying writes, in batches and
//   only some seconds later, out of the boot path. If init fails right after a restore, the copy
//   is dropped so the same bad state is not restored again.
// - Error.tsx's "Clear data" (localStorage.clear() + reload()) goes through the wrapped clear().
// Diagnostics (F3.6): window.__stremioPersist.status() has the boot reason and the last batch.
// F7.2: getState calls for the same model that pile up before the worker answers share one answer
// (webos/lib/core-calls): at boot the core serialized the same "ctx" for each of its subscribers.
// F8.7: the Ctx pulls of App.js (boot and every window focus) go through webos/lib/boot-pulls: none of the
// API pulls for a guest, and PullNotifications only when the app is idle, at most every 6 h.

const createTransport = require('./createTransport.diagnostics.ts').default;
const { createMirror } = require('../../webos/persistence/mirror');
const { coalesceGetState } = require('../../webos/lib/core-calls');
const bootPulls = require('../../webos/lib/boot-pulls');
const appinfo = require('../../webos/app/appinfo.json');

// PalmSystem.identifier is the running app's id (webOSTV.js fetchAppId() splits it the same way).
const appId = () => {
    const identifier = window.PalmSystem && window.PalmSystem.identifier;
    return (typeof identifier === 'string' && identifier.split(' ')[0]) || appinfo.id;
};

// ?resetMirror in the URL or { "resetMirror": true } in the launch params drops the copy, for when
// the app cannot even reach the diagnostics screen.
const resetRequested = () => {
    if (/[?&]resetMirror\b/.test(window.location.search)) return true;
    try {
        const params = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || '{}');
        return !!(params && params.resetMirror);
    } catch (_e) {
        return false;
    }
};

const mirror = createMirror({ appId: appId(), reset: resetRequested() });
mirror.start();

window.__stremioPersist = {
    status: mirror.getStatus,
    inspect: mirror.inspect,
    flush: mirror.flush,
    wipe: mirror.wipe,
};

const createWebosTransport = () => {
    const transport = bootPulls.wrap(coalesceGetState(createTransport()));

    const init = (args) => mirror.ready()
        .then((result) => {
            if (!/^(localStorage-ok|nothing-to-restore)$/.test(result.reason)) {
                // One string: the Chromium 53 console (Console.messageAdded) keeps only the first argument.
                console.warn(`[persist] boot: ${JSON.stringify(result)}`);
            }
            return transport.init(args);
        })
        .then((value) => {
            mirror.initSucceeded();
            return value;
        }, (error) => {
            mirror.initFailed();
            throw error;
        });

    return { ...transport, init };
};

module.exports = createWebosTransport;
