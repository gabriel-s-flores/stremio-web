// Back key on webOS TV 4.x (owner: F3.2). API and layers: webos/back/README.md.

const { BACK_KEY_CODE, PRIORITY } = require('./dispatcher');
const backDispatcher = require('./backDispatcher');
const useBackHandler = require('./useBackHandler');
const BackNavigation = require('./BackNavigation');

module.exports = {
    BACK_KEY_CODE,
    PRIORITY,
    backDispatcher,
    useBackHandler,
    BackNavigation,
};
