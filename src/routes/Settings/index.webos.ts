// webOS TV 4.x build only (resolved instead of index.ts by webos/webpack/app.js): the upstream screen
// with the remote navigation of webos/lib/navigation/screens.js: initial focus, focus restored on
// Back, focus kept while the content loads, and the arrows of its scrolling lists.

import Settings from './Settings';

const withScreenNavigation = require('../../../webos/lib/navigation/withScreenNavigation');
const { settingsScreen } = require('../../../webos/lib/navigation/screens');

export default withScreenNavigation(Settings, settingsScreen);
