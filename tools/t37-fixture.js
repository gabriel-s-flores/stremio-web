// Test entry only: never included by the production webpack configuration.
const adapter = require('../src/webos/diagnostics/observability');
window.__t37Fixture = {
    snapshot: adapter.getSnapshot,
    emit: () => {
        adapter.capture(new TypeError('T37 synthetic account=secret cookie=secret Authorization=secret https://addon.invalid/?token=secret'));
        return adapter.flush(4000);
    },
};
