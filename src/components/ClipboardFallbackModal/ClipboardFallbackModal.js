// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const ModalDialog = require('stremio/components/ModalDialog');
const { default: TextInput } = require('stremio/components/TextInput');
const { ModalsContainerProvider } = require('stremio/router/ModalsContainerContext');
const { writeTextToClipboard, copyTextBySelection } = require('stremio/common/clipboard');
const styles = require('./styles');

const isDismissKey = (event) => {
    return event.key === 'Escape'
        || event.key === 'Back'
        || event.key === 'GoBack'
        || event.key === 'XF86Back'
        || event.keyCode === 461
        || event.keyCode === 27;
};

// Reusable read-only fallback shown when the Clipboard API fails.
// The value stays selectable so webOS users can copy it manually with
// the virtual keyboard / magic remote. Never logs the value.
const ClipboardFallbackModal = ({ value, title, onClose }) => {
    const { t } = useTranslation();
    const inputRef = React.useRef(null);
    const [status, setStatus] = React.useState('');
    const onCloseRef = React.useRef(onClose);
    onCloseRef.current = onClose;

    const selectAll = React.useCallback(() => {
        const input = inputRef.current;
        if (input) {
            try {
                input.focus();
            } catch (_) {
                // Focus failure must not block selection.
            }
            try {
                input.select();
            } catch (_) {
                // Selection failure is reported via manual instructions.
            }
            try {
                if (typeof input.setSelectionRange === 'function' && typeof input.value === 'string') {
                    input.setSelectionRange(0, input.value.length);
                }
            } catch (_) {
                // Best effort only.
            }
        }
    }, []);

    React.useEffect(() => {
        const previous = document.activeElement;
        selectAll();
        const onKeyDown = (event) => {
            if (isDismissKey(event)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (typeof onCloseRef.current === 'function') {
                    onCloseRef.current();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            if (previous && previous.isConnected && typeof previous.focus === 'function') {
                try {
                    previous.focus();
                } catch (_) {
                    // Focus restoration is best effort.
                }
            }
        };
    }, [selectAll]);

    const retryCopy = React.useCallback(() => {
        const attempt = async () => {
            try {
                await writeTextToClipboard(value);
                setStatus(t('CLIPBOARD_COPIED', { defaultValue: 'Copied.' }));
                return;
            } catch (_) {
                // Fall through to selection copy; never log the value.
            }
            const selected = copyTextBySelection(inputRef.current);
            if (selected) {
                setStatus(t('CLIPBOARD_COPIED', { defaultValue: 'Copied.' }));
            } else {
                setStatus(t('CLIPBOARD_COPY_MANUAL', { defaultValue: 'Automatic copy failed. Select the text below to copy it manually.' }));
            }
        };
        attempt().catch(() => {
            setStatus(t('CLIPBOARD_COPY_MANUAL', { defaultValue: 'Automatic copy failed. Select the text below to copy it manually.' }));
        });
    }, [value, t]);

    return (
        <ModalsContainerProvider>
            <ModalDialog
                className={styles['clipboard-fallback']}
                title={title || t('CLIPBOARD_COPY_FALLBACK_TITLE', { defaultValue: 'Unable to copy automatically' })}
                autoFocus={true}
                onCloseRequest={() => {
                    if (typeof onClose === 'function') {
                        onClose();
                    }
                }}
                buttons={[
                    { label: t('CTX_COPY_TO_CLIPBOARD'), props: { onClick: retryCopy } },
                    { label: t('BUTTON_CLOSE'), props: { onClick: onClose } }
                ]}
            >
                <TextInput
                    ref={inputRef}
                    className={styles['value']}
                    aria-label={t('LINK', { defaultValue: 'Link' })}
                    value={value}
                    readOnly={true}
                    onFocus={selectAll}
                    onClick={selectAll}
                    onSubmit={selectAll}
                    data-test={'clipboard-fallback-input'}
                />
                <div role={'status'} data-test={'clipboard-fallback-status'}>{status || t('CLIPBOARD_COPY_MANUAL', { defaultValue: 'Automatic copy failed. Select the text below to copy it manually.' })}</div>
            </ModalDialog>
        </ModalsContainerProvider>
    );
};

ClipboardFallbackModal.propTypes = {
    value: PropTypes.string.isRequired,
    title: PropTypes.string,
    onClose: PropTypes.func
};

module.exports = ClipboardFallbackModal;
