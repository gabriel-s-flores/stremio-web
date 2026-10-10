// src/common/interfaceScale.webos.ts is a copy of interfaceScale.ts with one change, resolved only by
// the webOS build. This keeps the copy in step with the upstream file.
const fs = require('fs');
const path = require('path');

const COMMON = path.resolve(__dirname, '..', '..', '..', 'src', 'common');
const read = (name) => fs.readFileSync(path.join(COMMON, name), 'utf8');

const UPSTREAM_CHECK = '        if (sheet.href && new URL(sheet.href).origin === location.origin) {\n';
const WEBOS_CHECK = '        if (sheet.href && new URL(sheet.href).origin === new URL(location.href).origin) {\n';

describe('src/common/interfaceScale.webos.ts', () => {
    test('differs from interfaceScale.ts only in the same-origin check', () => {
        const upstream = read('interfaceScale.ts');
        const webos = read('interfaceScale.webos.ts');
        expect(upstream).toContain(UPSTREAM_CHECK);
        // The fix itself: without it core-js gives main.css the origin "null" and no media query is rescaled.
        expect(webos).toContain(WEBOS_CHECK);
        expect(webos).not.toContain(UPSTREAM_CHECK);
        const body = webos
            .replace(/^(\/\/ .*\n)+\n/, '')
            .replace(/( {8}\/\/ .*\n)+(?= {8}if \(sheet\.href)/, '')
            .replace(WEBOS_CHECK, UPSTREAM_CHECK);
        expect(body).toBe(upstream);
    });
});
