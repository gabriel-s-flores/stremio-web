// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { default: ExternalLink } = require('stremio/components/ExternalLink');
const { useTranslation } = require('react-i18next');
const PropTypes = require('prop-types');
const classNames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const FocusLock = require('react-focus-lock').default;
const { Button } = require('stremio/components');
const { usePlatform } = require('stremio/common');
const { getTVPlayerErrorKey } = require('../tvPlaybackPolicy');
const styles = require('./styles');

const Error = React.forwardRef(({ className, code, message, stream, onRetry, onChooseStream }, ref) => {
    const { t } = useTranslation();
    const platform = usePlatform();
    const isTV = platform.name === 'webos';
    const ErrorScope = isTV ? FocusLock : 'div';
    const displayMessage = isTV && getTVPlayerErrorKey(code) ? t(getTVPlayerErrorKey(code)) : message;

    const [playlist, fileName] = React.useMemo(() => {
        return [
            stream?.deepLinks?.externalPlayer?.playlist,
            stream?.deepLinks?.externalPlayer?.fileName,
        ];
    }, [stream]);

    return (
        <ErrorScope ref={ref} className={classNames(className, styles['error'])} {...(isTV ? { returnFocus: true, autoFocus: true } : {})}>
            <div className={styles['error-label']} title={displayMessage}>{displayMessage}</div>
            {isTV && <>
                <Button className={styles['playlist-button']} onClick={onRetry}><div className={styles['label']}>{t('RELOAD')}</div></Button>
                <Button className={styles['playlist-button']} onClick={onChooseStream}><div className={styles['label']}>{t('TV_PLAYER_OTHER_STREAM')}</div></Button>
            </>}
            {
                !isTV && code === 2 ?
                    <div className={styles['error-sub']} title={t('EXTERNAL_PLAYER_HINT')}>{t('EXTERNAL_PLAYER_HINT')}</div>
                    :
                    null
            }
            {
                !isTV && playlist && fileName ?
                    <ExternalLink
                        className={styles['playlist-button']}
                        title={t('PLAYER_OPEN_IN_EXTERNAL')}
                        href={playlist}
                        download={fileName}
                        target={'_blank'}
                    >
                        <Icon className={styles['icon']} name={'ic_downloads'} />
                        <div className={styles['label']}>{t('PLAYER_OPEN_IN_EXTERNAL')}</div>
                    </ExternalLink>
                    :
                    null
            }
        </ErrorScope>
    );
});

Error.propTypes = {
    className: PropTypes.string,
    code: PropTypes.number,
    message: PropTypes.string,
    stream: PropTypes.object,
    onRetry: PropTypes.func,
    onChooseStream: PropTypes.func,
};

module.exports = Error;
