// Stub for @sentry/browser in the webOS build (F1.5): Sentry is off on the TV, so a
// SENTRY_DSN in the environment can never pull the SDK or open a connection to it.

module.exports = {
    init: function() {},
};
