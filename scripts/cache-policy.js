const path = require('path');

const INDEX_CACHE_CONTROL = 'public, max-age=7200';
const ROOT_ASSET_CACHE_CONTROL = 'public, max-age=7200';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=2629744, immutable';
const SERVICE_WORKER_CACHE_CONTROL = 'no-cache, max-age=0, must-revalidate';

const getCacheControl = (buildDirectory, filePath) => {
    const relativePath = path.relative(buildDirectory, filePath).split(path.sep).join('/');

    if (relativePath === 'index.html') return INDEX_CACHE_CONTROL;
    if (relativePath === 'service-worker.js') return SERVICE_WORKER_CACHE_CONTROL;
    if (/^[a-f0-9]{40}\//i.test(relativePath)) return IMMUTABLE_CACHE_CONTROL;
    return ROOT_ASSET_CACHE_CONTROL;
};

module.exports = {
    getCacheControl
};
