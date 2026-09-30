// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { default: ExternalLink } = require('stremio/components/ExternalLink');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { default: useRouteFocused } = require('stremio/common/useRouteFocused');
const { useCore } = require('stremio/core');
const { Button } = require('stremio/components');
const { default: TextInput } = require('stremio/components/TextInput');
const useToast = require('stremio/common/Toast/useToast');
const { writeTextToClipboard, copyTextBySelection } = require('stremio/common/clipboard');
const styles = require('./styles');

const SharePrompt = ({ className, url }) => {
    const { t } = useTranslation();
    const core = useCore();
    const toast = useToast();
    const inputRef = React.useRef(null);
    const routeFocused = useRouteFocused();
    const selectInputContent = React.useCallback(() => {
        if (inputRef.current !== null) {
            try {
                inputRef.current.select();
            } catch (_) {
                // Selection is best effort.
            }
        }
    }, []);
    const copyToClipboard = React.useCallback(() => {
        if (inputRef.current === null || typeof url !== 'string') {
            return;
        }
        Promise.resolve()
            .then(() => writeTextToClipboard(url))
            .then(
                () => {
                    toast.show({
                        type: 'success',
                        title: 'Copied to clipboard',
                        timeout: 3000,
                    });
                },
                () => {
                    const selected = copyTextBySelection(inputRef.current);
                    toast.show({
                        type: selected ? 'success' : 'error',
                        title: selected
                            ? 'Copied to clipboard'
                            : t('CLIPBOARD_COPY_MANUAL', { defaultValue: 'Automatic copy failed. Select the link to copy it manually.' }),
                        timeout: 3000,
                    });
                }
            )
            .catch(() => {
                const selected = copyTextBySelection(inputRef.current);
                toast.show({
                    type: selected ? 'success' : 'error',
                    title: selected
                        ? 'Copied to clipboard'
                        : t('CLIPBOARD_COPY_MANUAL', { defaultValue: 'Automatic copy failed. Select the link to copy it manually.' }),
                    timeout: 3000,
                });
            });
    }, [url, t, toast]);
    React.useEffect(() => {
        if (routeFocused && inputRef.current !== null) {
            try {
                inputRef.current.select();
            } catch (_) {
                // Selection is best effort.
            }
        }
    }, [routeFocused]);
    React.useEffect(() => {
        core.transport.analytics({
            event: 'Share',
            args: {
                url: url
            }
        });
    }, [url]);
    return (
        <div className={classnames(className, styles['share-prompt-container'])}>
            <div className={styles['buttons-container']}>
                <ExternalLink className={classnames(styles['button-container'], styles['facebook-button'])} title={'Facebook'} href={`https://www.facebook.com/sharer/sharer.php?u=${url}`} target={'_blank'}>
                    <Icon className={styles['icon']} name={'facebook'} />
                </ExternalLink>
                <ExternalLink className={classnames(styles['button-container'], styles['x-button'])} title={'X (Twitter)'} href={`https://twitter.com/intent/tweet?text=${url}`} target={'_blank'}>
                    <Icon className={styles['icon']} name={'x'} />
                </ExternalLink>
                <ExternalLink className={classnames(styles['button-container'], styles['reddit-button'])} title={'Reddit'} href={`https://www.reddit.com/submit?url=${url}`} target={'_blank'}>
                    <Icon className={styles['icon']} name={'reddit'} />
                </ExternalLink>
            </div>
            <div className={styles['url-container']}>
                <TextInput
                    ref={inputRef}
                    className={styles['url-text-input']}
                    type={'text'}
                    readOnly={true}
                    defaultValue={url}
                    onClick={selectInputContent}
                    tabIndex={-1}
                />
                <Button className={styles['copy-button']} title={t('CTX_COPY_TO_CLIPBOARD')} onClick={copyToClipboard}>
                    <Icon className={styles['icon']} name={'link'} />
                    <div className={styles['label']}>{ t('COPY') }</div>
                </Button>
            </div>
        </div>
    );
};

SharePrompt.propTypes = {
    className: PropTypes.string,
    url: PropTypes.string
};

module.exports = SharePrompt;
