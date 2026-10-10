const fs = require('fs');
const path = require('path');
const styles = require('../../webpack/styles');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const STYLES = path.join(ROOT, 'webos', 'styles', 'app.less');

describe('webos/webpack/styles', () => {
    test('appends the webOS styles to the page entry, after the app', () => {
        const config = styles({ entry: { main: './src/index.js', worker: '/core/worker.js' } });
        expect(config.entry).toEqual({ main: ['./src/index.js', STYLES], worker: '/core/worker.js' });
    });

    test('keeps the polyfills and the app before the styles', () => {
        const config = styles({ entry: { main: ['/polyfills.js', './src/index.js'], worker: 'w.js' } });
        expect(config.entry.main).toEqual(['/polyfills.js', './src/index.js', STYLES]);
    });

    test('is part of the webOS build', () => {
        const webpackConfig = fs.readFileSync(path.join(ROOT, 'webos', 'webpack', 'webpack.config.js'), 'utf8');
        expect(webpackConfig).toContain("require('./styles')");
        expect(fs.existsSync(STYLES)).toBe(true);
    });
});
