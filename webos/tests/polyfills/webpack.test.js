const path = require('path');
const polyfills = require('../../webpack/polyfills');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PAGE = path.join(ROOT, 'webos', 'polyfills', 'index.js');
const WORKER = path.join(ROOT, 'webos', 'polyfills', 'worker.js');

describe('webos/webpack/polyfills', () => {
    test('prefixes the polyfills to the page and worker entries', () => {
        const config = polyfills({ entry: { main: './src/index.js', worker: '/core/worker.js' } });
        expect(config.entry).toEqual({
            main: [PAGE, './src/index.js'],
            worker: [WORKER, '/core/worker.js'],
        });
    });

    test('keeps what other modules already put in the entries, after the polyfills', () => {
        const config = polyfills({ entry: { main: ['./a.js', './src/index.js'], worker: ['/core/worker.js'] } });
        expect(config.entry.main).toEqual([PAGE, './a.js', './src/index.js']);
        expect(config.entry.worker).toEqual([WORKER, '/core/worker.js']);
    });

    test('does not add other entries', () => {
        const config = polyfills({ entry: { main: 'm.js', worker: 'w.js' } });
        expect(Object.keys(config.entry)).toEqual(['main', 'worker']);
    });

    test('the polyfill entries exist', () => {
        expect(() => require.resolve(PAGE)).not.toThrow();
        expect(() => require.resolve(WORKER)).not.toThrow();
    });
});
