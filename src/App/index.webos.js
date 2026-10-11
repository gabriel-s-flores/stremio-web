// Copyright (C) 2017-2026 Smart code 203358507

// webOS TV 4.x build only (resolved instead of index.js by webos/webpack/app.js): the App plus the
// Back key dispatcher of webos/back (F3.2) and the app lifecycle of webos/lifecycle (F3.3), inside
// the same router, the remote shortcut of the diagnostics screen (F3.6), the QR code dialog of the
// external links and Enter on the text fields for the system keyboard (F3.4), and the remote
// navigation that is not one screen's: the focus of the overlays, the context menu triggers and the
// side navigation bar (webos/lib/navigation, F4.4).

const React = require('react');
const { BackNavigation } = require('../../webos/back');
const { LifecycleHandler } = require('../../webos/lifecycle');
const DiagnosticsShortcut = require('../../webos/lib/diagnostics/ShortcutHandler');
const { ExternalLinks } = require('../../webos/external-links');
require('../../webos/keyboard');
const RemoteNavigation = require('../../webos/lib/navigation/RemoteNavigation');
const App = require('./App');

const WebOSApp = () => (
    <React.Fragment>
        <App />
        <BackNavigation />
        <RemoteNavigation />
        <LifecycleHandler />
        <DiagnosticsShortcut />
        <ExternalLinks />
    </React.Fragment>
);

module.exports = WebOSApp;
