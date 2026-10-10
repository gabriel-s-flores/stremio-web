// webOS TV 4.x build: the root webpack.config.js with webOS changes applied on top.
//   pnpm webos:build  ->  build-webos/
// Each module below owns one subject and receives/returns the config, so tasks editing
// different subjects do not touch the same file. The root config is never modified.

const baseConfig = require('../../webpack.config.js');

const steps = [
    require('./app'),
    require('./babel'),
    // core before polyfills: core replaces the worker entry path, polyfills then prefixes it.
    require('./core'),
    require('./polyfills'),
    require('./trim'),
    require('./postcss'),
    require('./styles'),
];

module.exports = (env, argv) => {
    return steps.reduce((config, step) => step(config, { env, argv }), baseConfig(env, argv));
};
