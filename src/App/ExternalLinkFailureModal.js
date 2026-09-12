const React = require('react');
const { useTranslation } = require('react-i18next');
const ModalDialog = require('stremio/components/ModalDialog');
const { default: TextInput } = require('stremio/components/TextInput');
const { usePlatform } = require('stremio/common/Platform');
const writeTextToClipboard = require('stremio/common/writeTextToClipboard');
const { copyTextBySelection } = require('stremio/common/clipboard');
const { ModalsContainerProvider } = require('stremio/router/ModalsContainerContext');
const styles = require('./externalLinkFailure.less');

const ExternalLinkFailureModal = () => {
    const { t } = useTranslation();
    const { externalLinkFailure: url, dismissExternalLinkFailure: dismiss } = usePlatform();
    const [copyStatus, setCopyStatus] = React.useState('');
    const inputRef = React.useRef(null);
    React.useEffect(() => { setCopyStatus(''); }, [url]);
    React.useEffect(() => {
        if (!url) return;
        const previous = document.activeElement;
        const onKeyDown = (event) => {
            if (event.key === 'Escape' || event.key === 'Back' || event.key === 'GoBack' || event.key === 'XF86Back' || event.keyCode === 461 || event.keyCode === 27) {
                event.preventDefault();
                event.stopImmediatePropagation();
                dismiss();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            try {
                if (previous && previous.isConnected) previous.focus();
            } catch (_) {
                // Best effort only.
            }
        };
    }, [url, dismiss]);
    if (url === null) return null;
    const copy = () => {
        writeTextToClipboard(url).then(
            () => setCopyStatus(t('EXTERNAL_LINK_COPIED', { defaultValue: 'Link copied.' })),
            () => {
                const selected = copyTextBySelection(inputRef.current);
                setCopyStatus(
                    selected
                        ? t('EXTERNAL_LINK_COPIED', { defaultValue: 'Link copied.' })
                        : t('EXTERNAL_LINK_COPY_FAILED', { defaultValue: 'Unable to copy. Select the link below to copy it manually.' })
                );
            }
        ).catch(() => {
            const selected = copyTextBySelection(inputRef.current);
            setCopyStatus(
                selected
                    ? t('EXTERNAL_LINK_COPIED', { defaultValue: 'Link copied.' })
                    : t('EXTERNAL_LINK_COPY_FAILED', { defaultValue: 'Unable to copy. Select the link below to copy it manually.' })
            );
        });
    };
    return (
        <ModalsContainerProvider>
            <ModalDialog
                className={styles['external-link-failure']}
                title={t('EXTERNAL_LINK_FAILED', { defaultValue: 'Unable to open the browser' })}
                autoFocus={true}
                onCloseRequest={dismiss}
                buttons={[
                    { label: t('COPY_LINK', { defaultValue: 'Copy link' }), props: { onClick: copy } },
                    { label: t('BUTTON_CLOSE'), props: { onClick: dismiss } }
                ]}
            >
                <TextInput
                    ref={inputRef}
                    className={styles['url']}
                    aria-label={t('LINK', { defaultValue: 'Link' })}
                    value={url}
                    readOnly={true}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    onSubmit={(event) => event.currentTarget.select()}
                />
                <div role={'status'}>{copyStatus}</div>
            </ModalDialog>
        </ModalsContainerProvider>
    );
};

module.exports = ExternalLinkFailureModal;
