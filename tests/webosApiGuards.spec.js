const writeTextToClipboard = require('../src/common/writeTextToClipboard');
const safeOpenExternal = require('../src/common/Platform/safeOpenExternal');

const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');

const setNavigator = (value) => {
    Object.defineProperty(global, 'navigator', {
        configurable: true,
        value,
    });
};

afterEach(() => {
    if (originalNavigator) {
        Object.defineProperty(global, 'navigator', originalNavigator);
    } else {
        delete global.navigator;
    }
});

describe('Clipboard API guard', () => {
    test('rejects when the Clipboard API is unavailable', async () => {
        setNavigator({});

        await expect(writeTextToClipboard('https://example.com')).rejects.toThrow('unavailable');
    });

    test('rejects when writeText is not exposed', async () => {
        setNavigator({ clipboard: {} });

        await expect(writeTextToClipboard('https://example.com')).rejects.toThrow('unavailable');
    });

    test('rejects when the writeText getter fails', async () => {
        setNavigator({
            get clipboard() {
                return {
                    get writeText() {
                        throw new Error('writeText blocked');
                    }
                };
            }
        });

        await expect(writeTextToClipboard('https://example.com')).rejects.toThrow('writeText blocked');
    });

    test('resolves after writeText succeeds', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        setNavigator({ clipboard: { writeText } });

        await expect(writeTextToClipboard('https://example.com')).resolves.toBeUndefined();
        expect(writeText).toHaveBeenCalledWith('https://example.com');
    });

    test('normalizes synchronous and asynchronous failures as rejections', async () => {
        const synchronousFailure = jest.fn(() => {
            throw new Error('sync failure');
        });
        setNavigator({ clipboard: { writeText: synchronousFailure } });
        await expect(writeTextToClipboard('sync')).rejects.toThrow('sync failure');

        const asynchronousFailure = jest.fn().mockRejectedValue(new Error('async failure'));
        setNavigator({ clipboard: { writeText: asynchronousFailure } });
        await expect(writeTextToClipboard('async')).rejects.toThrow('async failure');
    });
});

describe('external URL guard', () => {
    const whitelistedHosts = ['stremio.com'];

    test('opens whitelisted URLs in a new window', () => {
        const open = jest.fn();

        expect(safeOpenExternal('https://www.stremio.com/settings', whitelistedHosts, { open })).toBe(true);
        expect(open).toHaveBeenCalledWith('https://www.stremio.com/settings', '_blank');
    });

    test('routes untrusted URLs through the warning page', () => {
        const open = jest.fn();
        const url = 'https://untrusted.example/video?id=1';

        expect(safeOpenExternal(url, whitelistedHosts, { open })).toBe(true);
        expect(open).toHaveBeenCalledWith(
            `https://www.stremio.com/warning#${encodeURIComponent(url)}`,
            '_blank'
        );
    });

    test('does not throw when window.open is unavailable or fails', () => {
        expect(safeOpenExternal('https://www.stremio.com', whitelistedHosts, null)).toBe(false);

        const open = jest.fn(() => {
            throw new Error('blocked');
        });
        expect(() => safeOpenExternal('https://www.stremio.com', whitelistedHosts, { open })).not.toThrow();
        expect(safeOpenExternal('https://www.stremio.com', whitelistedHosts, { open })).toBe(false);
    });

    test('rejects malformed URLs without throwing', () => {
        expect(() => safeOpenExternal('not a URL', whitelistedHosts, { open: jest.fn() })).not.toThrow();
        expect(safeOpenExternal('not a URL', whitelistedHosts, { open: jest.fn() })).toBe(false);
    });
});
