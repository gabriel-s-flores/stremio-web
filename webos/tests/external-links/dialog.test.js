/**
 * @jest-environment jsdom
 */
// webos/external-links/ExternalLinkDialog.js and index.js, rendered with React in jsdom: the QR code,
// the focus, the keys the dialog keeps from the page, Back through the real dispatcher, and the full
// path from a click on a link.

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;

jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key) => `t:${key}` }),
}));
jest.mock('../../external-links/ExternalLinkDialog.less', () => ({
    'external-link-dialog': 'external-link-dialog',
    container: 'container',
    title: 'title',
    qr: 'qr',
    url: 'url',
    close: 'close',
}), { virtual: true });
// The real dispatcher, on this window (webos/back/backDispatcher.js is the same thing for the app).
jest.mock('../../back/backDispatcher', () => {
    const { createBackDispatcher } = require('../../back/dispatcher');
    const dispatcher = createBackDispatcher();
    dispatcher.install(globalThis);
    return dispatcher;
});

const ExternalLinkDialog = require('../../external-links/ExternalLinkDialog');
const { encode } = require('../../external-links/qr');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const render = (element) => act(() => {
    root.render(element);
});

const press = (keyCode) => {
    const event = new Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { value: keyCode });
    Object.defineProperty(event, 'which', { value: keyCode });
    let reached = false;
    const onPage = () => {
        reached = true;
    };
    // Where the page's own handlers (spatial navigation, shortcuts) listen.
    document.addEventListener('keydown', onPage);
    act(() => {
        document.body.dispatchEvent(event);
    });
    document.removeEventListener('keydown', onPage);
    return { reachedPage: reached, defaultPrevented: event.defaultPrevented };
};

const pressBack = () => press(461);

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
});

const dialog = () => document.querySelector('.external-link-dialog');

describe('ExternalLinkDialog', () => {
    test('renders nothing while there is no link', () => {
        render(React.createElement(ExternalLinkDialog, { url: null, onClose: jest.fn() }));
        expect(dialog()).toBeNull();
    });

    test('shows the title, the QR code of the link, the link and Close, in a portal on the body', () => {
        const url = 'https://www.stremio.com/warning#https%3A%2F%2Fexample.com%2Fconfigure';
        render(React.createElement(ExternalLinkDialog, { url, onClose: jest.fn() }));
        expect(container.querySelector('.external-link-dialog')).toBeNull();
        expect(dialog().parentNode).toBe(document.body);
        expect(dialog().getAttribute('role')).toBe('dialog');
        expect(dialog().querySelector('.title').textContent).toBe('t:LOGIN_SCAN_QR_CODE');
        expect(dialog().querySelector('.url').textContent).toBe(url);
        expect(dialog().querySelector('button.close').textContent).toBe('t:BUTTON_CLOSE');

        const svg = dialog().querySelector('svg.qr');
        const qr = encode(url);
        expect(svg.getAttribute('viewBox')).toBe(`0 0 ${qr.size + 8} ${qr.size + 8}`);
        expect(svg.querySelector('rect').getAttribute('fill')).toBe('#ffffff');
        const path = svg.querySelector('path');
        expect(path.getAttribute('fill')).toBe('#000000');
        expect(path.getAttribute('transform')).toBe('translate(4 4)');
        // The darkest modules are there: the first row of the top-left finder is a run of 7.
        expect(path.getAttribute('d').indexOf('M0 0h7v1h-7z')).toBe(0);
    });

    test('too long for a QR code: still shows the link and Close', () => {
        render(React.createElement(ExternalLinkDialog, { url: `https://example.com/${'a'.repeat(3000)}`, onClose: jest.fn() }));
        expect(dialog().querySelector('svg')).toBeNull();
        expect(dialog().querySelector('button.close')).not.toBeNull();
    });

    test('the focus goes to Close and the arrows and other keys do not reach the page', () => {
        render(React.createElement(ExternalLinkDialog, { url: 'https://example.com/', onClose: jest.fn() }));
        const close = dialog().querySelector('button.close');
        expect(document.activeElement).toBe(close);
        [37, 38, 39, 40, 49, 403].forEach((keyCode) => {
            expect(press(keyCode)).toEqual({ reachedPage: false, defaultPrevented: true });
            expect(document.activeElement).toBe(close);
        });
    });

    test('keeps the focus on Close even if something else took it', () => {
        render(React.createElement(ExternalLinkDialog, { url: 'https://example.com/', onClose: jest.fn() }));
        const other = document.createElement('button');
        document.body.appendChild(other);
        other.focus();
        press(40);
        expect(document.activeElement).toBe(dialog().querySelector('button.close'));
    });

    test('OK (Enter) presses Close', () => {
        const onClose = jest.fn();
        render(React.createElement(ExternalLinkDialog, { url: 'https://example.com/', onClose }));
        press(13);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('Back closes it, through the dispatcher, and the key goes no further', () => {
        const onClose = jest.fn();
        render(React.createElement(ExternalLinkDialog, { url: 'https://example.com/', onClose }));
        expect(pressBack()).toEqual({ reachedPage: false, defaultPrevented: true });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('Back is not taken once the dialog is closed', () => {
        const onClose = jest.fn();
        render(React.createElement(ExternalLinkDialog, { url: 'https://example.com/', onClose }));
        render(React.createElement(ExternalLinkDialog, { url: null, onClose }));
        pressBack();
        expect(onClose).not.toHaveBeenCalled();
    });

    test('a click on the backdrop closes it, a click inside does not', () => {
        const onClose = jest.fn();
        render(React.createElement(ExternalLinkDialog, { url: 'https://example.com/', onClose }));
        act(() => {
            dialog().querySelector('.container').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(onClose).not.toHaveBeenCalled();
        act(() => {
            dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('closing gives the focus back to the link that had it', () => {
        const link = document.createElement('a');
        link.setAttribute('href', 'https://example.com/');
        link.setAttribute('tabindex', '0');
        document.body.appendChild(link);
        link.focus();
        render(React.createElement(ExternalLinkDialog, { url: 'https://example.com/', onClose: jest.fn() }));
        expect(document.activeElement).not.toBe(link);
        render(React.createElement(ExternalLinkDialog, { url: null, onClose: jest.fn() }));
        expect(document.activeElement).toBe(link);
    });

    test('the keys reach the page again after it closes', () => {
        render(React.createElement(ExternalLinkDialog, { url: 'https://example.com/', onClose: jest.fn() }));
        render(React.createElement(ExternalLinkDialog, { url: null, onClose: jest.fn() }));
        expect(press(40).reachedPage).toBe(true);
    });
});

describe('ExternalLinks (index.js)', () => {
    test('a click on a web link opens the dialog, Back closes it, a second link replaces the first', () => {
        const { ExternalLinks, externalLinks } = require('../../external-links');
        render(React.createElement(ExternalLinks));
        expect(dialog()).toBeNull();

        const anchor = document.createElement('a');
        anchor.setAttribute('href', 'https://www.stremio.com/privacy');
        anchor.setAttribute('target', '_blank');
        document.body.appendChild(anchor);
        act(() => {
            anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(dialog().querySelector('.url').textContent).toBe('https://www.stremio.com/privacy');

        act(() => {
            window.open('https://www.stremio.com/tos', '_blank');
        });
        expect(document.querySelectorAll('.external-link-dialog')).toHaveLength(1);
        expect(dialog().querySelector('.url').textContent).toBe('https://www.stremio.com/tos');

        pressBack();
        expect(dialog()).toBeNull();
        expect(externalLinks.getState().url).toBeNull();
    });
});
