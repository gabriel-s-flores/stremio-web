/**
 * @jest-environment jsdom
 */
const { install } = require('../../polyfills/clipboard');

// A window-like object over jsdom's document, with a navigator the test can leave bare.
const setup = ({ navigator = {}, execCommand = jest.fn(() => true) } = {}) => {
    document.execCommand = execCommand;
    return { global: { navigator, document }, navigator, execCommand };
};

afterEach(() => {
    document.body.innerHTML = '';
    delete document.execCommand;
});

describe('navigator.clipboard polyfill', () => {
    test('installs only when missing', () => {
        const native = { writeText: () => {} };
        const { global, navigator } = setup({ navigator: { clipboard: native } });
        install(global);
        expect(navigator.clipboard).toBe(native);
        const bare = setup();
        install(bare.global);
        expect(typeof bare.navigator.clipboard.writeText).toBe('function');
        expect(typeof bare.navigator.clipboard.readText).toBe('function');
    });

    test('writeText copies the text through a hidden textarea and cleans up', async () => {
        let copied = null;
        const { global, navigator } = setup({
            execCommand: jest.fn(() => {
                copied = document.querySelector('textarea').value;
                return true;
            }),
        });
        install(global);
        await expect(navigator.clipboard.writeText('https://example.com/a?b=c')).resolves.toBeUndefined();
        expect(copied).toBe('https://example.com/a?b=c');
        expect(document.querySelector('textarea')).toBeNull();
    });

    test('writeText gives the focus back to what had it', async () => {
        const button = document.createElement('button');
        document.body.appendChild(button);
        button.focus();
        const { global, navigator } = setup();
        install(global);
        await navigator.clipboard.writeText('x');
        expect(document.activeElement).toBe(button);
    });

    test('writeText rejects when the copy did not happen, so the caller shows its error', async () => {
        const failing = setup({ execCommand: jest.fn(() => false) });
        install(failing.global);
        await expect(failing.navigator.clipboard.writeText('x')).rejects.toMatchObject({ name: 'NotAllowedError' });
        const throwing = setup({ execCommand: jest.fn(() => { throw new Error('denied'); }) });
        install(throwing.global);
        await expect(throwing.navigator.clipboard.writeText('x')).rejects.toMatchObject({ name: 'NotAllowedError' });
        expect(document.querySelector('textarea')).toBeNull();
    });

    test('readText rejects: there is nothing to read from on the TV', async () => {
        const { global, navigator } = setup();
        install(global);
        await expect(navigator.clipboard.readText()).rejects.toMatchObject({ name: 'NotAllowedError' });
    });

    test('does nothing without a navigator or a document', () => {
        expect(() => install({})).not.toThrow();
        expect(() => install({ navigator: {} })).not.toThrow();
    });
});
