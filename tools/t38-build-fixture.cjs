const path = require('path');
const fs = require('fs');
const webpack = require('webpack');
const makeConfig = require('../webpack.config');
const output = process.argv[2];
if (!output || fs.existsSync(output)) throw Error('Provide a new fixture directory');
process.env.SENTRY_DSN = '';
const config = makeConfig({ WEBOS: '1', WEBOS_DEBUG: '1', SERVICE_WORKER_DISABLED: 'true' }, { mode: 'production' });
config.output.path = path.resolve(output);
config.entry = { main: ['core-js/stable', './tools/t38-fixture.js'] };
config.plugins = config.plugins.filter(p => p.constructor.name !== 'ProgressPlugin');
webpack(config, (error, stats) => {
    if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; }
    else console.log('T3.8 fixture built: ' + output);
});
