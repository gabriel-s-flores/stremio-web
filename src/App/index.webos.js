// Copyright (C) 2017-2026 Smart code 203358507

// webOS TV 4.x build only (resolved instead of index.js by webos/webpack/app.js): the App plus the
// Back key dispatcher of webos/back (F3.2), inside the same router.

const React = require('react');
const { BackNavigation } = require('../../webos/back');
const App = require('./App');

const WebOSApp = () => (
    <React.Fragment>
        <App />
        <BackNavigation />
    </React.Fragment>
);

module.exports = WebOSApp;
