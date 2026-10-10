// Player tracks (F5.4): inside stremio-video, WebOsVideo becomes the one decorated with the header
// probe tracks (webos/lib/tracks/WebOsVideo.js) and tracksData.js stops asking the streaming
// server. Only requests made from stremio-video's own folders are replaced.

const path = require('path');
const webpack = require('webpack');
const { ROOT } = require('./utils');

const STREMIO_VIDEO_SRC = path.join(path.dirname(require.resolve('@stremio/stremio-video/package.json', { paths: [ROOT] })), 'src');
const TRACKS_DIR = path.join(ROOT, 'webos', 'lib', 'tracks');

const REPLACEMENTS = [
    // selectVideoImplementation.js
    { request: /^\.\.\/WebOsVideo$/, context: path.join(STREMIO_VIDEO_SRC, 'StremioVideo'), file: 'WebOsVideo.js' },
    // WebOsVideo.js
    { request: /^\.\.\/tracksData$/, context: path.join(STREMIO_VIDEO_SRC, 'WebOsVideo'), file: 'tracksData.js' },
];

module.exports = (config) => {
    REPLACEMENTS.forEach(({ request, context, file }) => {
        config.plugins.push(new webpack.NormalModuleReplacementPlugin(request, (resource) => {
            if (resource.context === context) resource.request = path.join(TRACKS_DIR, file);
        }));
    });

    return config;
};
