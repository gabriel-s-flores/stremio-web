// webOS TV 4.x build only (resolved instead of index.js by webos/webpack/app.js): the upstream screen
// with the remote navigation of webos/lib/navigation/board.js (F4.1a): initial focus, focus restored on
// Back, focus kept while the content loads, and the arrows of its lists.

const withScreenNavigation = require('../../../webos/lib/navigation/f4.1a-screen');
const { boardScreen } = require('../../../webos/lib/navigation/board');
const Board = require('./Board');

module.exports = withScreenNavigation(Board, boardScreen);
