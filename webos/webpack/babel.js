// Transpilation for Chromium 53 (owner: F1.2).
//
// Extension point (helpers in ./utils): change the babel-loader rule of the base config, e.g.
//   const rule = findRule(config, 'file.js');
//   findLoader(rule, 'babel-loader').options = { presets: [['@babel/preset-env', { targets: 'chrome 53', ... }]] };
// and add babel-loader after ts-loader in findRule(config, 'file.ts'), plus a rule that
// transpiles node_modules. Today it is a no-op: the base Babel/ts-loader setup is used as is.

module.exports = (config) => {
    return config;
};
