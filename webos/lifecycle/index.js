// App lifecycle on webOS TV 4.x (owner: F3.3). Behavior and measurements: webos/lifecycle/README.md.

const createLifecycle = require('./controller');
const LifecycleHandler = require('./LifecycleHandler');
const { resolveDeepLink, parseLaunchParams } = require('./launchParams');

module.exports = {
    createLifecycle,
    LifecycleHandler,
    resolveDeepLink,
    parseLaunchParams,
};
