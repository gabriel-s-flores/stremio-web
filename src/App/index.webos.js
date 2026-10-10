// Copyright (C) 2017-2026 Smart code 203358507

// webOS TV 4.x build only (resolved instead of index.js by webos/webpack/app.js): the App plus the
// Back key dispatcher of webos/back (F3.2) and the app lifecycle of webos/lifecycle (F3.3), inside
// the same router, and the remote shortcut of the diagnostics screen (F3.6).

const React = require('react');
const { BackNavigation } = require('../../webos/back');
const { LifecycleHandler } = require('../../webos/lifecycle');
const DiagnosticsShortcut = require('../../webos/lib/diagnostics/ShortcutHandler');
const App = require('./App');

const WebOSApp = () => (
    <React.Fragment>
        <App />
        <BackNavigation />
        <LifecycleHandler />
        <DiagnosticsShortcut />
    </React.Fragment>
);

module.exports = WebOSApp;
