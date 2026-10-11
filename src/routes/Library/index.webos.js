// webOS TV 4.x build only (resolved instead of index.js by webos/webpack/app.js): the upstream screen
// with the remote navigation of webos/lib/navigation/screens.js: initial focus, focus restored on
// Back, focus kept while the content loads, and the arrows of its scrolling lists.

const withScreenNavigation = require('../../../webos/lib/navigation/withScreenNavigation');
const { libraryScreen } = require('../../../webos/lib/navigation/screens');
const Library = require('./Library');

module.exports = withScreenNavigation(Library, libraryScreen);
