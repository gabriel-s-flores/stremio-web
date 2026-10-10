// Stub for workbox-window in the webOS build (F1.5). The app runs from file:// with the
// service worker off (SERVICE_WORKER_DISABLED), so useServiceWorkerUpdater never reaches
// `new Workbox(...)`; the import stays only because the hook is still bundled.

function Workbox() {
    throw new Error('workbox-window is not available in the webOS build');
}

module.exports = { Workbox: Workbox };
