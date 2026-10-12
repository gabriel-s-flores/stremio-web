// The QR code dialog of the external links (owner: F3.4). No JSX: webos/tests/external-links renders
// this file with React in jsdom, and the Jest setup of the repo has no React preset.
//
// Opens with the focus on Close and keeps it there: while the dialog is up it owns the remote, so
// the arrows and the other keys do not reach the page behind (spatial navigation, number-key
// shortcuts). OK presses Close; Back goes through the Back dispatcher (useBackHandler), like the
// other overlays; the backdrop closes it for the Magic Remote pointer. Closing puts the focus back
// on what had it when the link was opened.

const React = require('react');
const { createPortal } = require('react-dom');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const useBackHandler = require('../back/useBackHandler');
const styles = require('./ExternalLinkDialog.less');

const ENTER_KEY_CODE = 13;
// Modules of white around the code, as the standard asks, so that the phone can find its edges.
const QUIET_ZONE = 4;
// From this version the code has so many modules that it is drawn larger (a 20 rem code of version 14 has
// about 4 px per module on the TV; version 40 would have less than 3).
const LARGE_FROM_VERSION = 14;

const h = React.createElement;

// The generator (qr.js) is a lazy chunk: it is not in the boot bundle, and the dialog loads it when
// the first link is opened. Until it arrives, and for a link too long for a code, only the text shows.
const QrCode = ({ url, onLarge }) => {
    const [qr, setQr] = React.useState(null);
    React.useEffect(() => {
        let cancelled = false;
        setQr(null);
        import('./qr').then(({ encode, toPath }) => {
            const encoded = encode(url);
            if (!cancelled && encoded !== null) {
                setQr({ size: encoded.size, version: encoded.version, path: toPath(encoded) });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [url]);
    const large = qr !== null && qr.version >= LARGE_FROM_VERSION;
    // The dialog lays out differently around a large code (see ExternalLinkDialog.less).
    React.useEffect(() => {
        onLarge(large);
        return () => onLarge(false);
    }, [large, onLarge]);
    if (qr === null) {
        return null;
    }
    const side = qr.size + QUIET_ZONE * 2;
    return h('svg', {
        className: classnames(styles['qr'], { [styles['large']]: large }),
        viewBox: `0 0 ${side} ${side}`,
        shapeRendering: 'crispEdges',
        role: 'img',
        'aria-label': url,
    },
    h('rect', { width: side, height: side, fill: '#ffffff' }),
    h('path', { transform: `translate(${QUIET_ZONE} ${QUIET_ZONE})`, d: qr.path, fill: '#000000' }));
};

const ExternalLinkDialog = ({ url, onClose }) => {
    const { t } = useTranslation();
    const closeRef = React.useRef(null);
    const open = typeof url === 'string';
    const [large, setLarge] = React.useState(false);

    useBackHandler(() => {
        onClose();
        return true;
    }, { enabled: open, name: 'external-link' });

    React.useEffect(() => {
        if (!open) {
            return undefined;
        }
        const previous = document.activeElement;
        closeRef.current.focus();
        const onKeyDown = (event) => {
            if (event.keyCode === ENTER_KEY_CODE) {
                closeRef.current.click();
            } else if (document.activeElement !== closeRef.current) {
                closeRef.current.focus();
            }
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            if (previous && previous !== document.body && document.body.contains(previous) && typeof previous.focus === 'function') {
                previous.focus();
            }
        };
    }, [open]);

    if (!open) {
        return null;
    }

    return createPortal(
        h('div', {
            className: styles['external-link-dialog'],
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'webos-external-link-title',
            onClick: (event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            },
        },
        h('div', { className: classnames(styles['container'], { [styles['wide']]: large }) },
            h('div', { id: 'webos-external-link-title', className: styles['title'] }, t('LOGIN_SCAN_QR_CODE')),
            // Below a small code, one column; beside a large one (too tall for the screen otherwise), two.
            h('div', { className: styles['content'] },
                h(QrCode, { url, onLarge: setLarge }),
                h('div', { className: styles['side'] },
                    h('div', { className: styles['url'] }, url),
                    h('button', { ref: closeRef, type: 'button', className: styles['close'], onClick: onClose }, t('BUTTON_CLOSE')))))),
        document.body
    );
};

module.exports = ExternalLinkDialog;
