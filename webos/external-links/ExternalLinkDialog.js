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
const { useTranslation } = require('react-i18next');
const useBackHandler = require('../back/useBackHandler');
const { encode, toPath } = require('./qr');
const styles = require('./ExternalLinkDialog.less');

const ENTER_KEY_CODE = 13;
// Modules of white around the code, as the standard asks, so that the phone can find its edges.
const QUIET_ZONE = 4;

const h = React.createElement;

const QrCode = ({ url }) => {
    // Built once per link; encode() is the only heavy part and it only runs when a link is opened.
    const qr = React.useMemo(() => encode(url), [url]);
    if (qr === null) {
        return null;
    }
    const side = qr.size + QUIET_ZONE * 2;
    return h('svg', {
        className: styles['qr'],
        viewBox: `0 0 ${side} ${side}`,
        shapeRendering: 'crispEdges',
        role: 'img',
        'aria-label': url,
    },
    h('rect', { width: side, height: side, fill: '#ffffff' }),
    h('path', { transform: `translate(${QUIET_ZONE} ${QUIET_ZONE})`, d: toPath(qr), fill: '#000000' }));
};

const ExternalLinkDialog = ({ url, onClose }) => {
    const { t } = useTranslation();
    const closeRef = React.useRef(null);
    const open = typeof url === 'string';

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
        h('div', { className: styles['container'] },
            h('div', { id: 'webos-external-link-title', className: styles['title'] }, t('LOGIN_SCAN_QR_CODE')),
            h(QrCode, { url }),
            h('div', { className: styles['url'] }, url),
            h('button', { ref: closeRef, type: 'button', className: styles['close'], onClick: onClose }, t('BUTTON_CLOSE')))),
        document.body
    );
};

module.exports = ExternalLinkDialog;
