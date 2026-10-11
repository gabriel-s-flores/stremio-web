// webOS TV 4.x build only (resolved instead of index.js by webos/webpack/app.js): the upstream screen
// with the remote navigation of webos/lib/navigation/discover.js: initial focus, focus restored on
// Back, focus kept while the content loads, and the arrows of its lists.

const withScreenNavigation = require('../../../webos/lib/navigation/withScreenNavigation');
const { discoverScreen } = require('../../../webos/lib/navigation/discover');
const Discover = require('./Discover');

module.exports = withScreenNavigation(Discover, discoverScreen);
