// src/components/ColorInput/ColorInput.webos.tsx (F4.1b): the upstream file with the button color
// as rgba() (webos/lib/color/hex-alpha.js), for Chromium 53, which drops #RRGGBBAA.
const fs = require('fs');
const path = require('path');
const { cssColor } = require('../../lib/color/hex-alpha');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('cssColor', () => {
    test('#RRGGBBAA and #RGBA become rgba()', () => {
        expect(cssColor('#FFFFFFFF')).toBe('rgba(255, 255, 255, 1)');
        expect(cssColor('#00000000')).toBe('rgba(0, 0, 0, 0)');
        expect(cssColor('#FF000080')).toBe('rgba(255, 0, 0, 0.502)');
        expect(cssColor('#f0a8')).toBe('rgba(255, 0, 170, 0.533)');
    });

    test('other values are left as they are', () => {
        ['#000000', '#fff', 'red', 'rgba(1, 2, 3, 0.5)', '', '#GGGGGGGG'].forEach((value) => expect(cssColor(value)).toBe(value));
        expect(cssColor(undefined)).toBe(undefined);
    });
});

describe('ColorInput.webos.tsx', () => {
    test('differs from ColorInput.tsx only in the button color', () => {
        const upstream = read('src/components/ColorInput/ColorInput.tsx');
        const webos = read('src/components/ColorInput/ColorInput.webos.tsx')
            .replace(/^(\/\/ .*\n)+\n/, '')
            .replace("// webOS: #RRGGBBAA as rgba().\nimport { cssColor } from '../../../webos/lib/color/hex-alpha';\n", '')
            .replace('        // webOS: #RRGGBBAA as rgba().\n        backgroundColor: cssColor(value)\n', '        backgroundColor: value\n');
        expect(webos).toBe(upstream);
    });
});
