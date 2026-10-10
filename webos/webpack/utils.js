// Helpers shared by the webOS webpack modules. They locate parts of the base config
// (webpack.config.js at the repo root) so each module can change them without copying it.

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// Rules whose `test` matches a sample file name, e.g. findRules(config, 'file.less').
const findRules = (config, fileName) => {
    return config.module.rules.filter((rule) => rule.test instanceof RegExp && rule.test.test(fileName));
};

// The first rule that matches the sample file name; throws if the base config changed.
const findRule = (config, fileName) => {
    const [rule] = findRules(config, fileName);
    if (!rule) {
        throw new Error(`webos/webpack: no rule matches ${fileName}`);
    }
    return rule;
};

// The `use` entry of a rule for a loader name, e.g. findLoader(rule, 'babel-loader').
const findLoader = (rule, loaderName) => {
    const entry = (rule.use || []).find((use) => {
        const loader = typeof use === 'string' ? use : use.loader;
        return loader === loaderName || loader === require.resolve(loaderName);
    });
    if (!entry) {
        throw new Error(`webos/webpack: ${loaderName} not found in rule ${rule.test}`);
    }
    return entry;
};

// Plugins are matched by constructor name (e.g. 'GenerateSW', 'HtmlWebpackPlugin').
const findPlugin = (config, name) => {
    return config.plugins.find((plugin) => plugin.constructor.name === name);
};

const replacePlugin = (config, name, plugin) => {
    const index = config.plugins.findIndex((current) => current.constructor.name === name);
    if (index === -1) {
        throw new Error(`webos/webpack: plugin ${name} not found`);
    }
    config.plugins[index] = plugin;
};

const removePlugin = (config, name) => {
    config.plugins = config.plugins.filter((plugin) => plugin.constructor.name !== name);
};

module.exports = {
    ROOT,
    findRules,
    findRule,
    findLoader,
    findPlugin,
    replacePlugin,
    removePlugin,
};
