#!/usr/bin/env node
// Checks of the tlsproxy service packaged in the IPK (webos/tlsproxy/service/), run by
// `ares.sh package` before packaging and by pnpm test (webos/tests/tlsproxy/service-files.test.js):
// - every .js parses as ES5: the service runs as is on the Node v0.12.2 of webOS TV 4.x, without
//   Babel;
// - ca.js is the one gen-ca.js generates from webos/tlsproxy/certs/;
// - the service id starts with the app id (ares-package and the Luna bus require it) and is the
//   same in services.json, package.json and service.js.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_DIR = path.join(ROOT, 'webos', 'tlsproxy', 'service');
const APPINFO = path.join(ROOT, 'webos', 'app', 'appinfo.json');
// acorn comes with es-check (a devDependency), which uses it for the same kind of check.
const acorn = require(require.resolve('acorn', { paths: [require.resolve('es-check')] }));
const genCa = require('../tlsproxy/gen-ca');

const checkService = () => {
    const errors = [];
    const files = fs.readdirSync(SERVICE_DIR).filter((file) => file.endsWith('.js'));
    files.forEach((file) => {
        try {
            acorn.parse(fs.readFileSync(path.join(SERVICE_DIR, file), 'utf8'), { ecmaVersion: 5, sourceType: 'script' });
        } catch (error) {
            errors.push(`${file} is not ES5: ${error.message}`);
        }
    });

    if (fs.readFileSync(genCa.CA_FILE, 'utf8') !== genCa.render()) {
        errors.push('ca.js does not match webos/tlsproxy/certs/, run node webos/tlsproxy/gen-ca.js');
    }

    const appId = JSON.parse(fs.readFileSync(APPINFO, 'utf8')).id;
    const services = JSON.parse(fs.readFileSync(path.join(SERVICE_DIR, 'services.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(SERVICE_DIR, 'package.json'), 'utf8'));
    const source = fs.readFileSync(path.join(SERVICE_DIR, 'service.js'), 'utf8');
    const id = services.id;
    if (!id || !id.startsWith(`${appId}.`)) errors.push(`service id ${id} does not start with the app id ${appId}`);
    if (services.services.length !== 1 || services.services[0].name !== id) errors.push('services.json must declare one service named after its id');
    if (pkg.name !== id) errors.push(`package.json name ${pkg.name} differs from the service id ${id}`);
    if (!source.includes(`var SERVICE_ID = '${id}';`)) errors.push(`service.js SERVICE_ID differs from the service id ${id}`);

    return { files, id, errors };
};

if (require.main === module) {
    const { files, id, errors } = checkService();
    if (errors.length) {
        errors.forEach((error) => console.error(`error: ${error}`));
        process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`tlsproxy service ${id}: ${files.length} files ES5, ca.js up to date`);
}

module.exports = { checkService, SERVICE_DIR };
