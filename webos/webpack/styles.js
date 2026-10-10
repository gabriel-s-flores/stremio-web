// webOS-only styles (owner: F1.6).
//
// Appends webos/styles/app.less to the page entry, after the app, so its rules come after the app
// styles in main.css. Contract: only appends to whatever main already is (polyfills.js prefixes).
// The desktop build never loads it.

const path = require('path');
const { ROOT } = require('./utils');

const STYLES = path.join(ROOT, 'webos', 'styles', 'app.less');

module.exports = (config) => {
    config.entry.main = [...[].concat(config.entry.main), STYLES];
    return config;
};
