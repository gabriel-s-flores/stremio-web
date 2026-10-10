// Style sheet overrides for the webOS build (owner: F2.3).
//
// The components import their styles with the extension (`import styles from './Table.less'`), so
// the `.webos.*` entry added to resolve.extensions by ./app does not reach them. This swaps such an
// import for `Table.webos.less` when that file sits next to the original. The override starts with
// `@import (multiple) './Table.less';`, which less-loader resolves by itself (the file as named), so
// it takes the upstream rules and adds the webOS ones after them; the CSS modules classes stay the
// same and the upstream file is never edited. Only relative requests and the `stremio/` alias are
// looked at, and a request that already names a `.webos.less` is left alone.

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const { ROOT } = require('./utils');

const STREMIO_ALIAS = 'stremio/';
const OVERRIDE_EXTENSION = '.webos.less';

// Path of the override of a `.less` request, or null when there is none.
const findOverride = (request, context) => {
    if (!/\.less$/.test(request) || request.endsWith(OVERRIDE_EXTENSION) || request.includes('!')) {
        return null;
    }
    let file;
    if (request.startsWith('.')) {
        file = path.resolve(context, request);
    } else if (request.startsWith(STREMIO_ALIAS)) {
        file = path.join(ROOT, 'src', request.slice(STREMIO_ALIAS.length));
    } else {
        return null;
    }
    const override = file.replace(/\.less$/, OVERRIDE_EXTENSION);
    return fs.existsSync(override) ? override : null;
};

module.exports = (config) => {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/\.less$/, (resource) => {
        const override = findOverride(resource.request, resource.context);
        if (override) {
            resource.request = override;
        }
    }));
    return config;
};

module.exports.findOverride = findOverride;
