const path = require('path');
const fs = require('fs');
const webpack = require('webpack');
const makeConfig = require('../webpack.config');
const [output, withDsn, sinkOrigin] = process.argv.slice(2);
if (!output || !['on', 'off'].includes(withDsn)) throw Error('Usage: node tools/t37-build-fixture.cjs OUTPUT on|off LOCAL_SINK_ORIGIN');
if (withDsn === 'on' && !/^http:\/\/(?:127\.0\.0\.1|10\.0\.2\.2):\d+$/.test(sinkOrigin)) throw Error('Synthetic local sink required');
const dsn = withDsn === 'on' ? sinkOrigin.replace('http://', 'http://synthetic@') + '/37' : '';
// Explicit empty DSN prevents inheriting environment configuration.
process.env.SENTRY_DSN = dsn;
const config = makeConfig({ WEBOS: '1', WEBOS_DEBUG: '1', SERVICE_WORKER_DISABLED: 'true', SENTRY_DSN: dsn }, { mode: 'production' });
config.output.path = path.resolve(output);
config.output.clean = false;
if (fs.existsSync(config.output.path)) throw Error('Fixture output must be a new directory');
config.entry.main.push('./tools/t37-fixture.js');
config.plugins = config.plugins.filter(p => p.constructor.name !== 'ProgressPlugin');
webpack(config, (error, stats) => {
    if (error || stats.hasErrors()) { console.error('Fixture build failed'); process.exitCode = 1; }
    else console.log('Fixture build passed');
});
