const writeTextToClipboard = require('../src/common/writeTextToClipboard');
const { writeTextToClipboard: seamWrite, readTextFromClipboard, copyTextBySelection } = require('../src/common/clipboard');
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

    test('single seam preserves the write contract', async () => {
        expect(seamWrite).toBe(writeTextToClipboard);
        const writeText = jest.fn().mockResolvedValue('ignored-value');
        setNavigator({ clipboard: { writeText } });

        await expect(seamWrite('https://example.com')).resolves.toBeUndefined();
        expect(writeText).toHaveBeenCalledWith('https://example.com');
    });

    test('rejects when navigator itself is unavailable', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
        try {
            delete global.navigator;
            await expect(writeTextToClipboard('https://example.com')).rejects.toThrow('unavailable');
            await expect(readTextFromClipboard()).rejects.toThrow('unavailable');
        } finally {
            if (descriptor) {
                Object.defineProperty(global, 'navigator', descriptor);
            }
        }
    });
});

describe('Clipboard read guard (T3.9)', () => {
    test('rejects when the Clipboard API is unavailable', async () => {
        setNavigator({});

        await expect(readTextFromClipboard()).rejects.toThrow('unavailable');
    });

    test('rejects when readText is not exposed', async () => {
        setNavigator({ clipboard: {} });

        await expect(readTextFromClipboard()).rejects.toThrow('unavailable');
    });

    test('rejects when the clipboard getter fails', async () => {
        setNavigator({
            get clipboard() {
                throw new Error('clipboard blocked');
            }
        });

        await expect(readTextFromClipboard()).rejects.toThrow('clipboard blocked');
    });

    test('rejects when the readText getter fails', async () => {
        setNavigator({
            get clipboard() {
                return {
                    get readText() {
                        throw new Error('readText blocked');
                    }
                };
            }
        });

        await expect(readTextFromClipboard()).rejects.toThrow('readText blocked');
    });

    test('resolves clipboard text when readText succeeds', async () => {
        const readText = jest.fn().mockResolvedValue('https://example.com/video');
        setNavigator({ clipboard: { readText } });

        await expect(readTextFromClipboard()).resolves.toBe('https://example.com/video');
    });

    test('normalizes synchronous and asynchronous read failures', async () => {
        const synchronousFailure = jest.fn(() => {
            throw new Error('sync read failure');
        });
        setNavigator({ clipboard: { readText: synchronousFailure } });
        await expect(readTextFromClipboard()).rejects.toThrow('sync read failure');

        const asynchronousFailure = jest.fn().mockRejectedValue(new Error('async read failure'));
        setNavigator({ clipboard: { readText: asynchronousFailure } });
        await expect(readTextFromClipboard()).rejects.toThrow('async read failure');
    });

    test('rejects invalid read results', async () => {
        for (const invalid of [null, undefined, 42, {}, ['https://example.com']]) {
            const readText = jest.fn().mockResolvedValue(invalid);
            setNavigator({ clipboard: { readText } });
            await expect(readTextFromClipboard()).rejects.toThrow('invalid');
        }
    });
});

describe('Selection copy guard (T3.9)', () => {
    const originalDocument = Object.getOwnPropertyDescriptor(global, 'document');

    const makeInput = (overrides = {}) => ({
        value: 'https://example.com/copy-me',
        focus: jest.fn(),
        select: jest.fn(),
        setSelectionRange: jest.fn(),
        ...overrides,
    });

    const setExecCommand = (impl) => {
        Object.defineProperty(global, 'document', {
            configurable: true,
            value: { execCommand: impl },
        });
    };

    afterEach(() => {
        if (originalDocument) {
            Object.defineProperty(global, 'document', originalDocument);
        } else {
            delete global.document;
        }
    });

    test('returns true when execCommand approves the copy', () => {
        const input = makeInput();
        const execCommand = jest.fn().mockReturnValue(true);
        setExecCommand(execCommand);

        expect(copyTextBySelection(input)).toBe(true);
        expect(input.select).toHaveBeenCalled();
        expect(execCommand).toHaveBeenCalledWith('copy');
    });

    test('returns false when execCommand refuses the copy', () => {
        const input = makeInput();
        setExecCommand(jest.fn().mockReturnValue(false));

        expect(copyTextBySelection(input)).toBe(false);
    });

    test('returns false when execCommand is missing or throws', () => {
        const input = makeInput();
        Object.defineProperty(global, 'document', {
            configurable: true,
            value: {},
        });
        expect(copyTextBySelection(input)).toBe(false);

        setExecCommand(jest.fn(() => {
            throw new Error('denied');
        }));
        expect(copyTextBySelection(makeInput())).toBe(false);
    });

    test('returns false without a selectable field', () => {
        const execCommand = jest.fn().mockReturnValue(true);
        setExecCommand(execCommand);

        expect(copyTextBySelection(null)).toBe(false);
        expect(copyTextBySelection({})).toBe(false);
        expect(copyTextBySelection(makeInput({ select: null }))).toBe(false);
        expect(execCommand).not.toHaveBeenCalled();
    });

    test('never throws when selection helpers fail', () => {
        setExecCommand(jest.fn().mockReturnValue(true));
        const failingSelect = makeInput({
            select: jest.fn(() => {
                throw new Error('select blocked');
            }),
        });

        expect(() => copyTextBySelection(failingSelect)).not.toThrow();
        expect(copyTextBySelection(failingSelect)).toBe(false);
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
