// webOS TV 4.x build: the root webpack.config.js with webOS changes applied on top.
//   pnpm webos:build  ->  build-webos/
// Each module below owns one subject and receives/returns the config, so tasks editing
// different subjects do not touch the same file. The root config is never modified.

const baseConfig = require('../../webpack.config.js');

const steps = [
    require('./app'),
    require('./babel'),
    require('./polyfills'),
    require('./core'),
    require('./trim'),
    require('./postcss'),
];

module.exports = (env, argv) => {
    return steps.reduce((config, step) => step(config, { env, argv }), baseConfig(env, argv));
};
