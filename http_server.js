#!/usr/bin/env node

// Copyright (C) 2017-2023 Smart code 203358507

const HTTP_PORT = Number.parseInt(process.env.PORT || '8080', 10);

if (!Number.isInteger(HTTP_PORT) || HTTP_PORT < 0 || HTTP_PORT > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const express = require('express');
const path = require('path');
const { getCacheControl } = require('./scripts/cache-policy');

const build_path = path.resolve(__dirname, 'build');

const app = express().use(express.static(build_path, {
    setHeaders: (res, filePath) => {
        res.set('cache-control', getCacheControl(build_path, filePath));
        res.set('x-content-type-options', 'nosniff');
    }
})).all('*', (_req, res) => {
    // TODO: better 404 page
    res.status(404).send('<h1>404! Page not found</h1>');
});

if (require.main === module) {
    app.listen(HTTP_PORT, () => console.info(`Server listening on port: ${HTTP_PORT}`));
}

module.exports = {
    app,
    build_path,
    getCacheControl: (filePath) => getCacheControl(build_path, filePath)
};
