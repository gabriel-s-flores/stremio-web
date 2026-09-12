// Copyright (C) 2017-2026 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const { useTranslation } = require('react-i18next');
const ModalDialog = require('stremio/components/ModalDialog');
const { default: TextInput } = require('stremio/components/TextInput');
const { ModalsContainerProvider } = require('stremio/router/ModalsContainerContext');
const styles = require('./styles');

const isDismissKey = (event) => {
    return event.key === 'Escape'
        || event.key === 'Back'
        || event.key === 'GoBack'
        || event.key === 'XF86Back'
        || event.keyCode === 461
        || event.keyCode === 27;
};

// Editable manual fallback for "Play URL / magnet link" on webOS.
// Only closes when onSubmit resolves to true; invalid entries stay open
// with feedback. Never logs the entered value.
const PlayUrlModal = ({ initialValue, onSubmit, onClose }) => {
    const { t } = useTranslation();
    const inputRef = React.useRef(null);
    const [draft, setDraft] = React.useState(typeof initialValue === 'string' ? initialValue : '');
    const [error, setError] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const onCloseRef = React.useRef(onClose);
    onCloseRef.current = onClose;

    React.useEffect(() => {
        const previous = document.activeElement;
        const input = inputRef.current;
        if (input) {
            try {
                input.focus();
                input.select();
            } catch (_) {
                // Best effort only.
            }
        }
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
                    // Best effort only.
                }
            }
        };
    }, []);

    const confirm = React.useCallback(() => {
        if (submitting) {
            return;
        }
        const trimmed = (draft || '').trim();
        if (!trimmed) {
            setError(t('CLIPBOARD_PLAY_EMPTY', { defaultValue: 'Enter an HTTP URL or magnet link.' }));
            return;
        }
        setSubmitting(true);
        setError('');
        Promise.resolve()
            .then(() => onSubmit(trimmed))
            .then((handled) => {
                if (handled) {
                    if (typeof onCloseRef.current === 'function') {
                        onCloseRef.current();
                    }
                } else {
                    setError(t('CLIPBOARD_PLAY_INVALID', { defaultValue: 'This does not look like a valid HTTP URL or magnet link.' }));
                }
            })
            .catch(() => {
                setError(t('CLIPBOARD_PLAY_INVALID', { defaultValue: 'This does not look like a valid HTTP URL or magnet link.' }));
            })
            .finally(() => {
                setSubmitting(false);
            });
    }, [draft, submitting, onSubmit, t]);

    const onChange = React.useCallback((event) => {
        setDraft(event.target.value);
        if (error) {
            setError('');
        }
    }, [error]);

    const onInputKeyDown = React.useCallback((event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            confirm();
        }
    }, [confirm]);

    return (
        <ModalsContainerProvider>
            <ModalDialog
                className={styles['play-url-modal']}
                title={t('PLAY_URL_MAGNET_LINK')}
                autoFocus={true}
                onCloseRequest={() => {
                    if (typeof onClose === 'function') {
                        onClose();
                    }
                }}
                buttons={[
                    { label: t('PLAY_URL_MAGNET_LINK'), props: { onClick: confirm } },
                    { label: t('BUTTON_CLOSE'), props: { onClick: onClose } }
                ]}
            >
                <TextInput
                    ref={inputRef}
                    className={styles['value']}
                    aria-label={t('SEARCH_OR_PASTE_LINK')}
                    placeholder={t('SEARCH_OR_PASTE_LINK')}
                    value={draft}
                    readOnly={false}
                    onChange={onChange}
                    onKeyDown={onInputKeyDown}
                    onSubmit={confirm}
                    data-test={'play-url-input'}
                />
                <div role={'status'} data-test={'play-url-status'}>{error}</div>
            </ModalDialog>
        </ModalsContainerProvider>
    );
};

PlayUrlModal.propTypes = {
    initialValue: PropTypes.string,
    onSubmit: PropTypes.func.isRequired,
    onClose: PropTypes.func
};

module.exports = PlayUrlModal;
