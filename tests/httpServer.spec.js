const path = require('path');

const { getCacheControl } = require('../scripts/cache-policy');

const build_path = path.resolve(__dirname, '..', 'build');

const cacheControl = (filePath) => getCacheControl(build_path, filePath);

describe('hosted server cache policy', () => {
    test('keeps the entrypoint revalidating frequently', () => {
        expect(cacheControl(path.join(build_path, 'index.html'))).toBe('public, max-age=7200');
    });

    test('never gives the service worker an immutable cache policy', () => {
        expect(cacheControl(path.join(build_path, 'service-worker.js'))).toBe('no-cache, max-age=0, must-revalidate');
    });

    test('caches commit-scoped assets immutably', () => {
        const commitHash = '0123456789abcdef0123456789abcdef01234567';
        expect(cacheControl(path.join(build_path, commitHash, 'scripts', 'main.js'))).toBe(
            'public, max-age=2629744, immutable'
        );
    });

    test('uses a short cache for unversioned root assets', () => {
        expect(cacheControl(path.join(build_path, 'images', 'logo.png'))).toBe('public, max-age=7200');
    });
});
