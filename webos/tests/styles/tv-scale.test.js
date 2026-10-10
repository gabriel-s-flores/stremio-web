// The TV scale and the overscan margins of the webOS build (F2.6) are written in three places that
// must agree: the zoom (src/common/interfaceScale.webos.ts), the margins (webos/styles/app.less) and
// the reference min()/max() are resolved for (webos/webpack/postcss-math-functions.js).
const fs = require('fs');
const path = require('path');
const { TV } = require('../../webpack/postcss-math-functions');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('TV scale (F2.6)', () => {
    test('the zoom of interfaceScale.webos.ts is the scale min()/max() are resolved for', () => {
        const match = /^const TV_SCALE = ([\d.]+);$/m.exec(read('src/common/interfaceScale.webos.ts'));
        expect(match).not.toBeNull();
        expect(Number(match[1])).toBe(TV.scale);
    });

    test('the overscan margins of app.less are the ones min()/max() are resolved for', () => {
        const less = read('webos/styles/app.less');
        const inset = (side) => {
            const match = new RegExp(`--safe-area-inset-${side}: calc\\((\\d+)px / var\\(--interface-scale\\)\\);`).exec(less);
            expect(match).not.toBeNull();
            return Number(match[1]);
        };
        expect([inset('top'), inset('bottom')]).toEqual([TV.overscan.y, TV.overscan.y]);
        expect([inset('left'), inset('right')]).toEqual([TV.overscan.x, TV.overscan.x]);
    });

    // src/App/styles.less sizes the root font by media queries on the width, and the interface scale
    // multiplies their px: at the TV scale, the page is TV.width / TV.scale wide for them.
    test('1rem is the root font-size src/App/styles.less gives the page at the TV scale', () => {
        const sizes = {};
        read('src/common/screen-sizes.less').replace(/^@([\w-]+): (\d+)px;$/gm, (_, name, px) => {
            sizes[name] = Number(px);
        });
        const width = TV.width / TV.scale;
        let rem = null;
        // In source order, the last matching rule wins.
        read('src/App/styles.less').replace(
            /@media only screen and \((min|max)-width: @([\w-]+)\) \{\s*html \{\s*font-size: (\d+)px;/g,
            (_, bound, name, px) => {
                const limit = sizes[name];
                if (bound === 'max' ? width <= limit : width >= limit) rem = Number(px);
            }
        );
        expect(rem).toBe(TV.rem);
    });
});
